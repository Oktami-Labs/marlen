import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCard } from "@marlen/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let turnRecorder: typeof import("../../src/agent/turnRecorder.js");
let dbModule: typeof import("../../src/db/index.js");
type AgentSession = import("../../src/agent/sessionCache.js").AgentSession;

const silentLog = { info: () => {}, warn: () => {} };

function fakeSession(runTurn: AgentSession["runTurn"], onClose?: () => void): AgentSession {
  return {
    agent: null as never,
    toolset: {
      tools: [],
      readTools: [],
      close: async () => {
        onClose?.();
      },
    },
    inFlight: 0,
    retired: false,
    lastUsed: Date.now(),
    runTurn,
  };
}

const unusedSessions = {
  pooled: async (): Promise<AgentSession> => {
    throw new Error("pooled session not expected in this test");
  },
  ephemeral: async (): Promise<AgentSession> => {
    throw new Error("ephemeral session not expected in this test");
  },
};

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "marlen-turn-"));
  process.env.DATABASE_PATH = join(dir, "test.db");
  turnRecorder = await import("../../src/agent/turnRecorder.js");
  dbModule = await import("../../src/db/index.js");
});

afterAll(() => {
  turnRecorder._setSessionsForTest(null);
});

describe("an agent turn", () => {
  it("persists a completed turn: conversation, raw user row, assistant row with cards and tool activity", async () => {
    const card = {
      kind: "email_draft",
      account: { accountId: "acc-1", name: "kadim@example.com", app: "gmail", appName: "Gmail" },
      draft: {
        draftId: "d-1",
        subject: "Re: Besichtigung",
        to: ["anna@example.com"],
        body: "Gerne, passt Donnerstag?",
      },
    } as AgentCard;

    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      pooled: async () =>
        fakeSession(async (prompt, handlers) => {
          // The prompt that reaches the model is the decorated turn prompt:
          // raw text still present, plus the bracketed per-turn notes.
          expect(prompt).toContain("draft me a reply to Anna");
          expect(prompt).toContain("[Current date and time:");
          handlers?.onToolStart?.("call-1", "create_draft", "Create email draft", {
            to: ["anna@example.com"],
          });
          handlers?.onCard?.("call-1", card);
          handlers?.onToolEnd?.("call-1", "create_draft", false, {
            content: [{ type: "text", text: "Draft created (draft id d-1)." }],
          });
          handlers?.onTextDelta?.("Done — the ");
          return "Done — the draft is ready.";
        }),
    });

    const deltas: string[] = [];
    const turn = turnRecorder.beginTurn("conv-1");
    const { text, cards } = await turn.run({
      prompt: "draft me a reply to Anna",
      session: "pooled",
      conversation: { type: "chat", title: "draft me a reply to Anna" },
      handlers: { onTextDelta: (delta) => deltas.push(delta) },
      log: silentLog,
    });

    // The transcript preserves exactly what the model streamed and returned.
    expect(deltas.join("")).toBe("Done — the ");
    expect(text).toBe("Done — the draft is ready.");
    expect(cards).toEqual([{ toolCallId: "call-1", card }]);

    const { db, schema } = dbModule;
    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, "conv-1"));
    expect(conversation?.type).toBe("chat");
    expect(conversation?.title).toBe("draft me a reply to Anna");

    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, "conv-1"));
    const user = rows.find((row) => row.role === "user");
    const assistant = rows.find((row) => row.role === "assistant");
    // The persisted user row keeps the RAW prompt; decoration is model-only.
    expect(user?.content).toBe("draft me a reply to Anna");
    expect(assistant?.content).toBe("Done — the draft is ready.");
    expect(JSON.parse(assistant?.cards ?? "[]")).toEqual([{ toolCallId: "call-1", card }]);
    // The turn's tool activity persists with the row: the UI's activity view
    // and the model-history rebuild both read it.
    expect(JSON.parse(assistant?.toolCalls ?? "[]")).toMatchObject([
      {
        id: "call-1",
        name: "create_draft",
        done: true,
        isError: false,
        parameters: { to: ["anna@example.com"] },
      },
    ]);
  });

  it("rebuilds the model transcript with tool activity and replays compaction", async () => {
    const { db, schema } = dbModule;
    const conversationId = "conv-rebuild";
    const at = (offsetMs: number) => new Date(1_700_000_000_000 + offsetMs).toISOString();
    await db.insert(schema.messages).values([
      { id: "m1", conversationId, role: "user", content: "find the invoice", createdAt: at(0) },
      {
        id: "m2",
        conversationId,
        role: "assistant",
        content: "Searching. Found it.",
        toolCalls: JSON.stringify([
          {
            id: "t1",
            name: "search_email",
            isError: false,
            done: true,
            parameters: { q: "invoice" },
            result: { content: [{ type: "text", text: "1 thread found." }] },
            contentOffset: 0,
            batch: 0,
          },
          {
            id: "t2",
            name: "read_thread",
            isError: false,
            done: true,
            parameters: { threadId: "thread-1" },
            result: { content: [{ type: "text", text: "Invoice 42." }] },
            contentOffset: 10,
            batch: 1,
          },
        ]),
        createdAt: at(1000),
      },
    ]);

    const history = await import("../../src/agent/history.js");
    const first = await history.loadHistory(conversationId);
    expect(first.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(first[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "toolCall", id: "t1", name: "search_email" }],
    });
    expect(first[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "t1",
      content: [{ type: "text", text: "1 thread found." }],
    });
    expect(first[3]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "Searching." },
        { type: "toolCall", id: "t2", name: "read_thread" },
      ],
    });
    expect(first[4]).toMatchObject({
      role: "toolResult",
      toolCallId: "t2",
      content: [{ type: "text", text: "Invoice 42." }],
    });

    // A compaction row replays as the live session experienced it: the rows
    // its summary covers drop, the kept-verbatim tail stays in full.
    await db.insert(schema.messages).values([
      {
        id: "m3",
        conversationId,
        role: "compaction",
        content: "[Summary] The invoice was found.",
        compactionCutoff: Date.parse(at(1000)),
        createdAt: at(2000),
      },
      { id: "m4", conversationId, role: "user", content: "thanks", createdAt: at(3000) },
    ]);
    const rebuilt = await history.loadHistory(conversationId);
    expect(rebuilt[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "[Summary] The invoice was found." }],
    });
    expect(rebuilt.map((m) => m.role)).toEqual([
      "assistant",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
      "user",
    ]);
  });

  it("refuses a second concurrent turn for the same conversation", async () => {
    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      pooled: async () => fakeSession(async () => "ok"),
    });

    const turn = turnRecorder.beginTurn("conv-overlap");
    expect(() => turnRecorder.beginTurn("conv-overlap")).toThrow(turnRecorder.TurnInFlightError);

    // Completing the turn releases the guard for the conversation's next send.
    await turn.run({
      prompt: "hello",
      session: "pooled",
      conversation: { type: "chat", title: "hello" },
      log: silentLog,
    });
    turnRecorder.beginTurn("conv-overlap");
  });

  it("caps a failed ephemeral run with a failure row and closes its toolset", async () => {
    let closed = false;
    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      ephemeral: async () =>
        fakeSession(
          async () => {
            throw new Error("model exploded");
          },
          () => {
            closed = true;
          },
        ),
    });

    const turn = turnRecorder.beginTurn("run-1");
    await expect(
      turn.run({
        prompt: "Scheduled automation …",
        session: "ephemeral",
        conversation: { type: "automation", title: "Run: Morning briefing" },
        log: silentLog,
      }),
    ).rejects.toThrow("model exploded");

    // An ephemeral session belongs to its run alone; the run must close it.
    expect(closed).toBe(true);

    const { db, schema } = dbModule;
    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, "run-1"));
    const assistant = rows.find((row) => row.role === "assistant");
    expect(assistant?.content).toContain("This turn failed: model exploded");
  });

  it("asks a run that worked in silence for its report and records that as the reply", async () => {
    const prompts: string[] = [];
    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      ephemeral: async () =>
        fakeSession(async (prompt, handlers) => {
          prompts.push(prompt);
          if (prompts.length === 1) {
            // Work, then end the turn with nothing said after the tool call.
            handlers?.onTextDelta?.("Checking the inbox.");
            handlers?.onToolStart?.("call-1", "list_emails", "List emails", {});
            handlers?.onToolEnd?.("call-1", "list_emails", false, {
              content: [{ type: "text", text: "No new mail." }],
            });
            return "Checking the inbox.";
          }
          handlers?.onTextDelta?.("Nothing new since the last run.");
          return "Nothing new since the last run.";
        }),
    });

    const turn = turnRecorder.beginTurn("run-silent");
    const result = await turn.run({
      prompt: "Scheduled automation …",
      session: "ephemeral",
      conversation: { type: "automation", title: "Run: Mail sweep" },
      requireReport: true,
      log: silentLog,
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("report");
    expect(result.text).toBe("Checking the inbox.\n\nNothing new since the last run.");

    // The report is the turn's reply on the transcript; the reminder is not.
    const { db, schema } = dbModule;
    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, "run-silent"));
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[1]?.content).toBe("Checking the inbox.\n\nNothing new since the last run.");
  });

  it("leaves a run that reported alone", async () => {
    let calls = 0;
    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      ephemeral: async () =>
        fakeSession(async (_prompt, handlers) => {
          calls++;
          handlers?.onToolStart?.("call-1", "list_emails", "List emails", {});
          handlers?.onToolEnd?.("call-1", "list_emails", false, {
            content: [{ type: "text", text: "No new mail." }],
          });
          handlers?.onTextDelta?.("Nothing new.");
          return "Nothing new.";
        }),
    });

    const turn = turnRecorder.beginTurn("run-reported");
    const result = await turn.run({
      prompt: "Scheduled automation …",
      session: "ephemeral",
      conversation: { type: "automation", title: "Run: Mail sweep" },
      requireReport: true,
      log: silentLog,
    });
    expect(calls).toBe(1);
    expect(result.text).toBe("Nothing new.");
  });

  it("tells the user a new chat won't help when the request's fixed part is what overflows", async () => {
    const run = await import("../../src/agent/run.js");
    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      pooled: async () =>
        fakeSession(async () => {
          // What run.ts throws once a forced compaction reports it had nothing
          // left to shrink: the prompt and tool definitions alone don't fit.
          throw new run.ContextOverflowError(
            "Codex error: Your input exceeds the context window of this model.",
            true,
          );
        }),
    });

    const turn = turnRecorder.beginTurn("overflow-1");
    await expect(
      turn.run({
        prompt: "kannst du befehle annehmen?",
        session: "pooled",
        conversation: { type: "chat", title: "kannst du befehle annehmen?" },
        log: silentLog,
      }),
    ).rejects.toThrow("exceeds the context window");

    const { db, schema } = dbModule;
    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, "overflow-1"));
    const assistant = rows.find((row) => row.role === "assistant");
    // The advice has to name a lever that exists. "Start a new chat" is the one
    // answer that is always wrong here, and it is what a user tries first.
    expect(assistant?.content).toContain("A new chat will fail the same way");
    expect(assistant?.content).not.toContain("This turn failed:");
  });

  it("stops a running turn and keeps what it had already said", async () => {
    let streaming: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      streaming = resolve;
    });
    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      pooled: async () =>
        fakeSession(async (_prompt, handlers, signal) => {
          handlers?.onTextDelta?.("Checking your inbox");
          streaming();
          // Runs until the stop aborts it, like a real turn mid-tool-call.
          return await new Promise<string>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }),
    });

    const turn = turnRecorder.beginTurn("conv-stop");
    const running = turn.run({
      prompt: "what came in?",
      session: "pooled",
      conversation: { type: "chat", title: "what came in?" },
      log: silentLog,
    });

    await started;
    expect(turnRecorder.stopTurn("conv-stop")).toBe(true);
    await expect(running).rejects.toThrow(turnRecorder.TurnStoppedError);

    // Nothing is running any more, so a second stop finds no turn.
    expect(turnRecorder.stopTurn("conv-stop")).toBe(false);

    const { db, schema } = dbModule;
    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, "conv-stop"));
    const assistant = rows.find((row) => row.role === "assistant");
    expect(assistant?.content).toContain("Checking your inbox");
    expect(assistant?.content).toContain("Stopped");
  });

  it("caps a rate-limited turn with a plain-language row, not the raw provider error", async () => {
    turnRecorder._setSessionsForTest({
      ...unusedSessions,
      pooled: async () =>
        fakeSession(async () => {
          throw new Error(
            '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}',
          );
        }),
    });

    const turn = turnRecorder.beginTurn("conv-rate-limit");
    await expect(
      turn.run({
        prompt: "hello",
        session: "pooled",
        conversation: { type: "chat", title: "hello" },
        log: silentLog,
      }),
    ).rejects.toThrow("rate_limit_error");

    const { db, schema } = dbModule;
    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, "conv-rate-limit"));
    const assistant = rows.find((row) => row.role === "assistant");
    expect(assistant?.content).toContain("rate limit");
    expect(assistant?.content).not.toContain("rate_limit_error");
  });
});
