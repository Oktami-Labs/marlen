import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, Conversation, ConversationListResponse } from "@marlen/shared";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
let database: typeof import("../../src/db/index.js");
let turnRecorder: typeof import("../../src/agent/turnRecorder.js");
type AgentSession = import("../../src/agent/sessionCache.js").AgentSession;

function fakeSession(runTurn: AgentSession["runTurn"]): AgentSession {
  return {
    agent: null as never,
    toolset: { tools: [], readTools: [], close: async () => {} },
    inFlight: 0,
    retired: false,
    lastUsed: Date.now(),
    runTurn,
  };
}

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-chat-route-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  database = await import("../../src/db/index.js");
  turnRecorder = await import("../../src/agent/turnRecorder.js");
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  turnRecorder?._setSessionsForTest(null);
  await app?.close();
});

describe("conversation routes", () => {
  it("filters history by type and identifies chats by their latest activity", async () => {
    await database.db.insert(database.schema.conversations).values([
      {
        id: "activity-old-conversation",
        title: "Activity ranking old",
        type: "chat",
        createdAt: "2026-08-01T10:00:00.000Z",
      },
      {
        id: "activity-new-conversation",
        title: "Activity ranking new",
        type: "chat",
        createdAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "activity-automation",
        title: "Activity ranking automation",
        type: "automation",
        createdAt: "2026-09-02T11:00:00.000Z",
      },
    ]);
    await database.db.insert(database.schema.messages).values([
      {
        id: "activity-old-message",
        conversationId: "activity-old-conversation",
        role: "user",
        content: "Continued today\nwith the termination clause",
        createdAt: "2026-09-02T10:00:00.000Z",
      },
      {
        id: "activity-new-message",
        conversationId: "activity-new-conversation",
        role: "user",
        content: "Started yesterday",
        createdAt: "2026-09-01T10:01:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/conversations?type=chat&q=Activity%20ranking",
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<ConversationListResponse>();
    expect(result.total).toBe(2);
    expect(result.items.map(({ id }) => id)).toEqual([
      "activity-old-conversation",
      "activity-new-conversation",
    ]);
    expect(result.items[0]).toMatchObject({
      preview: "Continued today with the termination clause",
      updatedAt: "2026-09-02T10:00:00.000Z",
    });

    const automations = await app.inject({
      method: "GET",
      url: "/api/conversations?type=automation&q=Activity%20ranking",
    });
    expect(automations.statusCode).toBe(200);
    expect(automations.json<ConversationListResponse>()).toMatchObject({
      total: 1,
      items: [{ id: "activity-automation", type: "automation", preview: null }],
    });
  });

  it("loads one conversation by id and returns the standard missing-row error", async () => {
    const conversation: Conversation = {
      id: "focused-conversation",
      title: "Mailbox review",
      type: "chat",
      createdAt: "2026-08-31T10:00:00.000Z",
      focusAccountId: "account-1",
      focusThreadId: "thread-1",
      focusThreadSubject: "Quarterly report",
    };
    await database.db.insert(database.schema.conversations).values(conversation);

    const found = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json<Conversation>()).toEqual({ ...conversation, running: false });

    const missing = await app.inject({
      method: "GET",
      url: "/api/conversations/missing",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: string }>()).toMatchObject({ error: "not found" });
  });

  it("sends pasted documents and images to the model and keeps them with the message", async () => {
    const conversationId = "chat-with-attachments";
    const document = Buffer.from("Quarterly revenue: 42", "utf8");
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    let modelPrompt = "";
    let modelImages: Parameters<AgentSession["runTurn"]>[4];

    await database.db.insert(database.schema.conversations).values({
      id: conversationId,
      title: "Quarterly review",
      type: "chat",
      createdAt: "2026-09-02T12:00:00.000Z",
    });
    turnRecorder._setSessionsForTest({
      pooled: async () =>
        fakeSession(async (prompt, handlers, _signal, _log, images) => {
          modelPrompt = prompt;
          modelImages = images;
          handlers?.onTextDelta?.("Revenue is 42.");
          return "Revenue is 42.";
        }),
      ephemeral: async () => {
        throw new Error("ephemeral session not expected in this test");
      },
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/chat",
        payload: {
          conversationId,
          message: "Summarize these files.",
          attachments: [
            {
              id: "quarterly-document",
              name: "quarterly.txt",
              mimeType: "text/plain",
              size: document.length,
              kind: "document",
              data: document.toString("base64"),
            },
            {
              id: "quarterly-chart",
              name: "chart.png",
              mimeType: "image/png",
              size: image.length,
              kind: "image",
              data: image.toString("base64"),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"type":"done","text":"Revenue is 42."');
      expect(modelPrompt).toContain("Summarize these files.");
      expect(modelPrompt).toContain("Quarterly revenue: 42");
      expect(modelImages).toEqual([
        { type: "image", data: image.toString("base64"), mimeType: "image/png" },
      ]);

      const messagesResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversationId}/messages`,
      });
      expect(messagesResponse.statusCode).toBe(200);
      const messages = messagesResponse.json<ChatMessage[]>();
      expect(messages[0]).toMatchObject({
        role: "user",
        content: "Summarize these files.",
        attachments: [
          {
            id: "quarterly-document",
            name: "quarterly.txt",
            mimeType: "text/plain; charset=utf-8",
            size: document.length,
            kind: "document",
          },
          {
            id: "quarterly-chart",
            name: "chart.png",
            mimeType: "image/png",
            size: image.length,
            kind: "image",
          },
        ],
      });

      const storedDocument = await app.inject({
        method: "GET",
        url: "/api/chat/attachments/quarterly-document",
      });
      expect(storedDocument.statusCode).toBe(200);
      expect(storedDocument.rawPayload).toEqual(document);
    } finally {
      turnRecorder._setSessionsForTest(null);
    }
  });
});

describe("attachment migration", () => {
  it("adds durable message order when the attachment table lacks position", async () => {
    const { SCHEMA_STEPS } = await import("../../src/db/schemaSteps.js");
    const repairIndex = SCHEMA_STEPS.findIndex((step) =>
      step.includes("chat_attachments_before_position"),
    );
    const repairStep = SCHEMA_STEPS[repairIndex] ?? "";
    expect(repairStep).not.toBe("");

    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE chat_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        data BLOB NOT NULL,
        extracted_text TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_chat_attachments_conversation
        ON chat_attachments(conversation_id);
    `);
    const insert = raw.prepare(`
      INSERT INTO chat_attachments (
        id, message_id, conversation_id, name, mime_type, kind,
        size, data, extracted_text, created_at
      ) VALUES (?, 'message-1', 'conversation-1', ?, 'text/plain', 'document', ?, ?, ?, ?)
    `);
    insert.run("attachment-1", "first.txt", 5, Buffer.from("first"), "first", "2026-09-02");
    insert.run("attachment-2", "second.txt", 6, Buffer.from("second"), "second", "2026-09-02");

    raw.exec(repairStep);

    expect(
      raw
        .prepare(
          "SELECT id, position, CAST(data AS TEXT) AS data FROM chat_attachments ORDER BY position",
        )
        .all(),
    ).toEqual([
      { id: "attachment-1", position: 0, data: "first" },
      { id: "attachment-2", position: 1, data: "second" },
    ]);
    expect(
      raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_chat_attachments_message_position'",
        )
        .get(),
    ).toEqual({ name: "idx_chat_attachments_message_position" });
    raw.close();
  });
});
