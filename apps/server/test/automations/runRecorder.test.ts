import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let dbModule: typeof import("../../src/db/index.js");
let runRecorder: typeof import("../../src/services/automations/runRecorder.js");
const prompts: string[] = [];
const conversationIds: string[] = [];

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-runrecorder-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  dbModule = await import("../../src/db/index.js");
  runRecorder = await import("../../src/services/automations/runRecorder.js");
  const { registerTurnRunner } = await import("../../src/services/automations/turnRunner.js");
  registerTurnRunner(async ({ prompt, conversationId }) => {
    prompts.push(prompt);
    conversationIds.push(conversationId);
    return { text: "done", cardsJson: null };
  });

  await dbModule.db.insert(dbModule.schema.automations).values({
    id: "auto-1",
    name: "Mail sweep",
    instruction: "Check emails from the past 24 hours.",
    schedule: "0 6 * * *",
    createdAt: new Date().toISOString(),
  });
});

describe("automation run prompt context", () => {
  it("anchors runs to the previous success and flags catch-up gaps", async () => {
    const first = await runRecorder.executeAutomationRun("auto-1");
    expect(first.succeeded).toBe(true);
    expect(prompts[0]).toContain("no previous successful run");
    expect(prompts[0]).toContain("Check emails from the past 24 hours.");

    const [recorded] = await dbModule.db.select().from(dbModule.schema.automationRuns);
    const catchUp = await runRecorder.executeAutomationRun("auto-1", {
      trigger: { kind: "catchUp", dueAt: "2026-07-18T06:00:00.000Z" },
    });
    expect(catchUp.succeeded).toBe(true);
    expect(prompts[1]).toContain(`previous successful run finished at ${recorded?.finishedAt}`);
    expect(prompts[1]).toContain("catch-up run");
    expect(prompts[1]).toContain("2026-07-18T06:00:00.000Z");
    expect(prompts[1]).toContain("keep its normal time window");
    expect(conversationIds.slice(0, 2)).toEqual(["automation:auto-1", "automation:auto-1"]);

    // The trigger also outlives the prompt: it is the run row's durable record
    // of why it fired, which is what lets the UI mark a run as caught up.
    const rows = await dbModule.db.select().from(dbModule.schema.automationRuns);
    expect(rows.every((row) => row.conversationId === "automation:auto-1")).toBe(true);
    const triggers = rows.map((row) => row.trigger);
    expect(triggers).toContain(
      JSON.stringify({ kind: "catchUp", dueAt: "2026-07-18T06:00:00.000Z" }),
    );
    expect(triggers).toContain(null);
  });

  it("hands a chained run the todo that fired it", async () => {
    const run = await runRecorder.executeAutomationRun("auto-1", {
      trigger: {
        kind: "todo",
        todoId: "todo-9",
        title: "Erreicht: Unterlagen an Familie Berger",
        body: "Exposé Seestraße 4 fehlt noch.\nRückruf ab 16 Uhr.",
      },
    });
    expect(run.succeeded).toBe(true);
    const prompt = prompts.at(-1) ?? "";
    expect(prompt).toContain('completed the linked todo "Erreicht: Unterlagen an Familie Berger"');
    expect(prompt).toContain("todo-9");
    // The body carries what the title leaves out, so the run has to see it.
    expect(prompt).toContain("Exposé Seestraße 4 fehlt noch.\nRückruf ab 16 Uhr.");
  });

  it("carries unresolved briefing work across runs until its draft is decided", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    await dbModule.db.insert(dbModule.schema.automationThreadStates).values({
      automationId: "auto-1",
      accountId: "account-1",
      threadId: "thread-open",
      messageId: "message-1",
      itemJson: JSON.stringify({
        threadId: "thread-open",
        accountId: "account-1",
        sender: "Anna",
        subject: "Contract question",
        gist: "contract: payment term still open → reply",
        priority: "reply",
      }),
      disposition: "open",
      lastReportedAt: at,
      updatedAt: at,
    });

    expect((await runRecorder.executeAutomationRun("auto-1")).succeeded).toBe(true);
    expect(prompts.at(-1)).toContain("Durable unresolved work from earlier runs");
    expect(prompts.at(-1)).toContain("thread-open");

    await dbModule.db.insert(dbModule.schema.draftProposals).values({
      id: "decided-draft",
      accountId: "account-1",
      threadId: "thread-open",
      status: "discarded",
      createdAt: at,
      updatedAt: "2026-09-01T09:00:00.000Z",
    });
    expect((await runRecorder.executeAutomationRun("auto-1")).succeeded).toBe(true);
    expect(prompts.at(-1)).not.toContain("thread-open");

    const [state] = await dbModule.db.select().from(dbModule.schema.automationThreadStates);
    expect(state?.disposition).toBe("handled");

    // The same thread can receive new mail later. The historical draft
    // decision must not suppress that newer message on this or any later run.
    await dbModule.db.update(dbModule.schema.automationThreadStates).set({
      messageId: "message-2",
      itemJson: JSON.stringify({
        threadId: "thread-open",
        accountId: "account-1",
        sender: "Anna",
        subject: "A new contract question",
        gist: "contract: delivery date changed → reply",
        priority: "reply",
      }),
      disposition: "open",
      handledAt: null,
      lastReportedAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    });
    expect((await runRecorder.executeAutomationRun("auto-1")).succeeded).toBe(true);
    expect(prompts.at(-1)).toContain("A new contract question");
    expect((await runRecorder.executeAutomationRun("auto-1")).succeeded).toBe(true);
    expect(prompts.at(-1)).toContain("A new contract question");
  });
});
