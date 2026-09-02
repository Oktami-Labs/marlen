import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCard, ReportItem, ReportSection } from "@marlen/shared";
import Database from "better-sqlite3";
import { desc } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

type ReportCard = Extract<AgentCard, { kind: "report" }>;

let dbModule: typeof import("../../src/db/index.js");
let runRecorder: typeof import("../../src/services/automations/runRecorder.js");
let reportState: typeof import("../../src/services/automations/reportState.js");
let nextSections: ReportSection[] = [];

function mail(threadId: string, messageId: string, extra: Partial<ReportItem> = {}): ReportItem {
  return {
    key: `email:account-1\n${threadId}`,
    ref: { kind: "email", accountId: "account-1", threadId, messageId, sender: "Anna" },
    title: `Subject ${threadId}`,
    gist: `gist ${threadId}`,
    needsUser: true,
    ...extra,
  };
}

const LEAD: ReportItem = {
  key: "title:Firma Nord",
  ref: { kind: "none" },
  title: "Firma Nord",
  gist: "viewing requested → call back",
  needsUser: true,
};

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-report-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  dbModule = await import("../../src/db/index.js");
  runRecorder = await import("../../src/services/automations/runRecorder.js");
  reportState = await import("../../src/services/automations/reportState.js");
  const { registerTurnRunner } = await import("../../src/services/automations/turnRunner.js");
  // The scripted turn publishes its report the way publish_report does: through the reconciler.
  registerTurnRunner(async ({ runId }) => {
    const card = await reportState.reconcileReportCard(runId, {
      kind: "report",
      sections: nextSections,
    });
    return { text: "done", cardsJson: JSON.stringify([{ toolCallId: "report", card }]) };
  });
  await dbModule.db.insert(dbModule.schema.automations).values({
    id: "report-1",
    name: "Morgenbriefing",
    instruction: "Report.",
    schedule: "0 8 * * *",
    createdAt: new Date().toISOString(),
  });
});

async function publish(sections: ReportSection[]): Promise<{ runId: string; card: ReportCard }> {
  // Reports a millisecond apart would share timestamps and blur "since the previous report".
  await new Promise((resolve) => setTimeout(resolve, 5));
  nextSections = sections;
  expect((await runRecorder.executeAutomationRun("report-1")).succeeded).toBe(true);
  const [run] = await dbModule.db
    .select()
    .from(dbModule.schema.automationRuns)
    .orderBy(desc(dbModule.schema.automationRuns.startedAt))
    .limit(1);
  const [stored] = JSON.parse(run?.cards ?? "[]") as { card: ReportCard }[];
  return { runId: run?.id ?? "", card: stored?.card as ReportCard };
}

const rows = (card: ReportCard) =>
  card.sections.flatMap((section) => section.items.map((item) => ({ section, item })));
const byKey = (card: ReportCard) => new Map(rows(card).map(({ item }) => [item.key, item]));

describe("a report as a living document", () => {
  it("keeps one row per item and marks new, carried, updated and resolved items", async () => {
    const first = await publish([
      { label: "Reply", items: [mail("thread-a", "a1"), mail("thread-a", "a1")] },
      { label: "To do", items: [mail("thread-b", "b1"), LEAD] },
    ]);
    expect(
      rows(first.card).map(({ section, item }) => [section.label, item.key, item.change]),
    ).toEqual([
      ["Reply", "email:account-1\nthread-a", "new"],
      ["To do", "email:account-1\nthread-b", "new"],
      ["To do", "title:Firma Nord", "new"],
    ]);
    const since = first.card.sections[0]?.items[0]?.since;
    expect(since).toBeTruthy();

    // The user closes B in Home; the model repeats A unchanged and finds C.
    expect(await reportState.handleReportItem(first.runId, "email:account-1\nthread-b")).toBe(true);
    const second = await publish([
      { label: "Reply", items: [mail("thread-a", "a1")] },
      { label: "Urgent", items: [mail("thread-c", "c1")] },
    ]);
    const secondItems = byKey(second.card);
    expect(secondItems.get("email:account-1\nthread-a")).toMatchObject({
      change: "carried",
      since,
    });
    expect(secondItems.get("email:account-1\nthread-c")).toMatchObject({ change: "new" });
    expect(secondItems.get("email:account-1\nthread-b")).toMatchObject({ handled: true });
    // The lead the model forgot is carried under the heading it was filed under.
    expect(second.card.sections.map((s) => s.label)).toEqual(["Reply", "Urgent", "To do"]);
    expect(secondItems.get("title:Firma Nord")).toMatchObject({ change: "carried" });

    // New mail in A; the model retires C; B was already shown leaving.
    const third = byKey(
      (
        await publish([
          {
            label: "Urgent",
            items: [mail("thread-a", "a2"), mail("thread-c", "c1", { handled: true })],
          },
          { label: "To do", items: [LEAD] },
        ])
      ).card,
    );
    expect(third.get("email:account-1\nthread-a")).toMatchObject({ change: "updated", since });
    expect(third.get("email:account-1\nthread-c")).toMatchObject({ handled: true });
    expect(third.has("email:account-1\nthread-b")).toBe(false);

    // The model omits everything: the server still carries the open work, and C stays retired.
    const fourth = await publish([]);
    expect(
      rows(fourth.card).map(({ section, item }) => [section.label, item.key, item.change]),
    ).toEqual([
      ["Urgent", "email:account-1\nthread-a", "carried"],
      ["To do", "title:Firma Nord", "carried"],
    ]);
    const states = await dbModule.db.select().from(dbModule.schema.automationReportItems);
    expect(states.map((s) => [s.itemKey, s.disposition]).sort()).toEqual([
      ["email:account-1\nthread-a", "open"],
      ["email:account-1\nthread-b", "handled"],
      ["email:account-1\nthread-c", "handled"],
      ["title:Firma Nord", "open"],
    ]);
  });

  it("does not repeat an unchanged informational row", async () => {
    const fyi = mail("thread-news", "n1", { needsUser: false });
    const first = await publish([{ label: "FYI", collapsed: true, items: [fyi] }]);
    expect(byKey(first.card).has("email:account-1\nthread-news")).toBe(true);
    const second = await publish([{ label: "FYI", collapsed: true, items: [fyi] }]);
    expect(byKey(second.card).has("email:account-1\nthread-news")).toBe(false);
    const third = await publish([
      { label: "FYI", collapsed: true, items: [mail("thread-news", "n2", { needsUser: false })] },
    ]);
    expect(byKey(third.card).has("email:account-1\nthread-news")).toBe(true);
  });
});

describe("report migration", () => {
  it("rewrites stored briefing cards and thread states into report shape", async () => {
    const { SCHEMA_STEPS } = await import("../../src/db/schemaSteps.js");
    const { parseStoredCards } = await import("../../src/agent/cards.js");
    const stepIndex = SCHEMA_STEPS.findIndex((s) =>
      s.includes("CREATE TABLE automation_report_items"),
    );
    const raw = new Database(":memory:");
    for (const step of SCHEMA_STEPS.slice(0, stepIndex)) raw.exec(step);
    raw.prepare("INSERT INTO settings (key, value) VALUES ('app.language', 'de')").run();

    const briefingItem = (threadId: string, priority: string, extra: object = {}) => ({
      threadId,
      accountId: "acc-1",
      messageId: `${threadId}-m1`,
      sender: "Anna",
      subject: `Subject ${threadId}`,
      gist: `gist ${threadId}`,
      priority,
      ...extra,
    });
    const briefing = {
      kind: "briefing",
      headline: "Zwei Dinge",
      scanned: 9,
      items: [
        briefingItem("t-reply", "reply", { draftId: "d-1", change: "carried" }),
        briefingItem("t-urgent", "urgent", { deadline: "Fr 17:00" }),
        briefingItem("t-done", "reply", { handled: true }),
        briefingItem("t-fyi", "fyi"),
      ],
      rollups: [{ label: "Newsletter", items: [briefingItem("t-news", "fyi")] }],
    };
    const cardsJson = JSON.stringify([
      { toolCallId: "c1", card: briefing },
      {
        toolCallId: "c2",
        card: { kind: "chart", chartType: "bar", points: [{ label: "Neu", value: 3 }] },
      },
    ]);
    raw
      .prepare(
        "INSERT INTO automation_runs (id, automation_id, status, result, cards, started_at) VALUES ('run-1', 'auto-1', 'success', 'ok', ?, '2026-09-01T08:00:00.000Z')",
      )
      .run(cardsJson);
    raw
      .prepare(
        "INSERT INTO conversations (id, title, created_at) VALUES ('conv-1', 'Chat', '2026-09-01')",
      )
      .run();
    raw
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, cards, created_at) VALUES ('m-1', 'conv-1', 'assistant', 'Hier dein Briefing', ?, '2026-09-01T08:00:00.000Z')",
      )
      .run(cardsJson);
    raw
      .prepare(
        "INSERT INTO automation_thread_states (automation_id, account_id, thread_id, message_id, item_json, disposition, first_reported_at, last_reported_at, updated_at) VALUES ('auto-1', 'acc-1', 't-reply', 't-reply-m1', ?, 'open', '2026-08-30T08:00:00.000Z', '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z')",
      )
      .run(JSON.stringify(briefingItem("t-reply", "reply", { draftId: "d-1" })));

    raw.exec(SCHEMA_STEPS[stepIndex] as string);

    const states = raw.prepare("SELECT * FROM automation_report_items").all() as {
      item_key: string;
      change_key: string;
      section_label: string;
      item_json: string;
      disposition: string;
      first_reported_at: string;
    }[];
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      item_key: "email:acc-1\nt-reply",
      change_key: "t-reply-m1",
      section_label: "Antwort ausstehend",
      disposition: "open",
      first_reported_at: "2026-08-30T08:00:00.000Z",
    });
    expect(JSON.parse(states[0]?.item_json ?? "")).toMatchObject({
      key: "email:acc-1\nt-reply",
      ref: { kind: "email", accountId: "acc-1", threadId: "t-reply", sender: "Anna" },
      title: "Subject t-reply",
      gist: "gist t-reply",
      draftId: "d-1",
      needsUser: true,
    });
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE name = 'automation_thread_states'").all(),
    ).toEqual([]);

    for (const table of ["automation_runs", "messages"]) {
      const row = raw.prepare(`SELECT cards FROM ${table}`).get() as { cards: string };
      const cards = parseStoredCards(row.cards);
      expect(cards?.map((c) => c.card.kind)).toEqual(["report", "chart"]);
      const report = cards?.[0]?.card;
      if (report?.kind !== "report") throw new Error("expected a report card");
      expect(report).toMatchObject({ headline: "Zwei Dinge", scanned: 9 });
      expect(report.sections.map((s) => [s.label, s.collapsed ?? false, s.items.length])).toEqual([
        ["Dringend", false, 1],
        ["Antwort ausstehend", false, 2],
        ["Zur Kenntnis", true, 1],
        ["Newsletter", true, 1],
      ]);
      const reply = report.sections[1]?.items ?? [];
      expect(reply[0]).toMatchObject({
        key: "email:acc-1\nt-reply",
        title: "Subject t-reply",
        draftId: "d-1",
        needsUser: true,
        change: "carried",
      });
      expect(reply[1]).toMatchObject({ key: "email:acc-1\nt-done", handled: true });
      expect(report.sections[0]?.items[0]).toMatchObject({ deadline: "Fr 17:00", needsUser: true });
      expect(report.sections[3]?.items[0]?.needsUser).toBeUndefined();
    }
  });

  it("files pending automation suggestions as to-dos", async () => {
    const { SCHEMA_STEPS } = await import("../../src/db/schemaSteps.js");
    const stepIndex = SCHEMA_STEPS.findIndex((s) =>
      s.includes("DROP TABLE automation_suggestions"),
    );
    const raw = new Database(":memory:");
    for (const step of SCHEMA_STEPS.slice(0, stepIndex)) raw.exec(step);
    const insert = raw.prepare(
      "INSERT INTO automation_suggestions (id, name, instruction, schedule, rationale, status, created_at) VALUES (?, ?, ?, '0 8 * * 1', ?, ?, '2026-08-30T08:00:00.000Z')",
    );
    insert.run(
      "s-1",
      "Wochenstart",
      "Fasse die Mails der Woche zusammen.",
      "Dreimal gefragt.",
      "pending",
    );
    insert.run("s-2", "Alt", "Egal.", "Verworfen.", "dismissed");

    raw.exec(SCHEMA_STEPS[stepIndex] as string);

    const todos = raw.prepare("SELECT title, body, status, dedupe_key FROM todos").all();
    expect(todos).toEqual([
      {
        title: "Automation vorschlagen: Wochenstart",
        body: "Dreimal gefragt.\n\nZeitplan (Cron): 0 8 * * 1\n\nAnweisung:\nFasse die Mails der Woche zusammen.",
        status: "open",
        dedupe_key: "automation-suggestion:wochenstart",
      },
    ]);
  });
});
