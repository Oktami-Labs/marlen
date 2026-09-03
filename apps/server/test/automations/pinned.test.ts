import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Automation, PinnedRun } from "@marlen/shared";
import { afterAll, beforeAll, expect, it } from "vitest";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
let runRecorder: typeof import("../../src/services/automations/runRecorder.js");
/** What the scripted turn reports on its next run, per run title. */
const results = new Map<string, string>();

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-pinned-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "home");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  runRecorder = await import("../../src/services/automations/runRecorder.js");
  const { registerTurnRunner } = await import("../../src/services/automations/turnRunner.js");
  registerTurnRunner(async ({ title }) => ({
    text: results.get(title) ?? "",
    cardsJson: null,
  }));
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  await app?.close();
});

async function create(name: string, pinned: boolean): Promise<Automation> {
  const res = await app.inject({
    method: "POST",
    url: "/api/automations",
    payload: { name, instruction: `Report on ${name}.`, schedule: "0 8 * * *", pinned },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Automation>();
}

/** Runs the automation through the recorder with a scripted result. */
async function run(automation: Automation, result: string): Promise<void> {
  results.set(`Run: ${automation.name}`, result);
  // Runs a millisecond apart would share a timestamp, blurring "the latest one".
  await new Promise((resolve) => setTimeout(resolve, 5));
  const outcome = await runRecorder.executeAutomationRun(automation.id, { manual: true });
  expect(outcome.succeeded).toBe(true);
}

const band = async (): Promise<PinnedRun[]> => {
  const res = await app.inject({ method: "GET", url: "/api/runs/pinned" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ items: PinnedRun[] }>().items;
};

it("Home's band carries every pinned automation with its own latest result", async () => {
  const briefing = await create("Briefing", true);
  const invoices = await create("Rechnungen", true);
  const newsletters = await create("Newsletter", false);

  await run(briefing, "Erster Bericht");
  await run(invoices, "Zwei Rechnungen offen");
  await run(newsletters, "Nichts aufzuräumen");
  await run(briefing, "Zweiter Bericht");

  // Pinning the second one left the first pinned, and each card reads its own
  // newest result. Newest automation first: they share the list's order.
  expect((await band()).map((item) => [item.automation.name, item.run?.result])).toEqual([
    ["Rechnungen", "Zwei Rechnungen offen"],
    ["Briefing", "Zweiter Bericht"],
  ]);

  // A pinned automation that has produced nothing still gets its card.
  await create("Wochenrückblick", true);
  expect((await band()).map((item) => [item.automation.name, item.run])).toContainEqual([
    "Wochenrückblick",
    null,
  ]);

  // Unpinning takes the card away without touching the others.
  const res = await app.inject({
    method: "PATCH",
    url: `/api/automations/${invoices.id}`,
    payload: { pinned: false },
  });
  expect(res.statusCode, res.body).toBe(200);
  expect((await band()).map((item) => item.automation.name)).toEqual([
    "Wochenrückblick",
    "Briefing",
  ]);
});
