import type { MissedAutomation, RunTrigger } from "@marlen/shared";
import { desc, eq } from "drizzle-orm";
import cron, { type ScheduledTask } from "node-cron";
import { moduleLogger } from "../../core/logger.js";
import { KeyedJobs } from "../../core/utils/jobs.js";
import { db, schema } from "../../db/index.js";
import { getTimezoneSetting } from "../../db/settings.js";
import {
  type AutomationRunResult,
  executeAutomationRun,
  sweepOrphanedRuns,
} from "./runRecorder.js";

const log = moduleLogger("scheduler");

const tasks = new Map<string, ScheduledTask>();

const runJobs = new KeyedJobs();

let schedulerStarted = false;

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

export function getNextRunAt(automationId: string): string | null {
  const next = tasks.get(automationId)?.getNextRun();
  return next ? next.toISOString() : null;
}

/** Covers monthly schedules without replaying older slots. */
const CATCHUP_LOOKBACK_MS = 40 * 24 * 60 * 60 * 1000;

/** Find the latest matching minute in the lookback window using node-cron's timezone logic. */
export function previousCronRun(
  expression: string,
  timezone: string | undefined,
  notAfter: Date,
): Date | null {
  const task = cron.createTask(expression, () => {}, timezone ? { timezone } : undefined);
  try {
    const probe = new Date(notAfter);
    probe.setSeconds(0, 0);
    const floor = notAfter.getTime() - CATCHUP_LOOKBACK_MS;
    for (let t = probe.getTime(); t >= floor; t -= 60_000) {
      if (task.match(new Date(t))) return new Date(t);
    }
    return null;
  } finally {
    void task.destroy();
  }
}

/** Treat a fixed day and month as one-off because cron has no year field. */
function isOneOffSchedule(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dom, month, dow] = parts;
  return dom !== "*" && month !== "*" && dow === "*";
}

const pendingRuns = new Map<string, (RunTrigger | null)[]>();

async function runGuarded(
  automationId: string,
  opts: { manual?: boolean; trigger?: RunTrigger },
): Promise<void> {
  const result = await runJobs.join(automationId, () => executeAutomationRun(automationId, opts));
  await retireIfOneOff(automationId, result);
}

/** Todo completion may explicitly run a paused automation. */
function optsFor(trigger: RunTrigger | null): { manual?: boolean; trigger?: RunTrigger } {
  return { trigger: trigger ?? undefined, manual: trigger?.kind === "todo" };
}

export async function runAutomation(
  automationId: string,
  opts: { manual?: boolean; trigger?: RunTrigger } = {},
): Promise<void> {
  if (runJobs.isRunning(automationId)) {
    log.warn(
      { automationId },
      "skipping run — previous run of this automation is still in progress",
    );
    return;
  }
  await runGuarded(automationId, opts);
  for (;;) {
    const trigger = pendingRuns.get(automationId)?.shift();
    if (trigger === undefined) {
      pendingRuns.delete(automationId);
      break;
    }
    await runGuarded(automationId, optsFor(trigger));
  }
}

export function isRunInFlight(automationId: string): boolean {
  return runJobs.isRunning(automationId);
}

/** Queue todo triggers individually and coalesce other follow-ups by kind. */
export async function requestRun(automationId: string, trigger?: RunTrigger): Promise<void> {
  const queued = trigger ?? null;
  if (runJobs.isRunning(automationId)) {
    const queue = pendingRuns.get(automationId) ?? [];
    const sameKind = (t: RunTrigger | null) => (t?.kind ?? null) === (queued?.kind ?? null);
    if (queued?.kind === "todo" || !queue.some(sameKind)) queue.push(queued);
    pendingRuns.set(automationId, queue);
    return;
  }
  await runAutomation(automationId, optsFor(queued));
}

/** Find each enabled automation's latest scheduled but uncovered slot. */
export async function findMissedAutomations(now: Date = new Date()): Promise<MissedAutomation[]> {
  const timezone = (await getTimezoneSetting()) ?? undefined;
  const automations = await db.select().from(schema.automations);
  const missed: MissedAutomation[] = [];
  for (const automation of automations) {
    if (!automation.enabled || !isValidCron(automation.schedule)) continue;
    const due = previousCronRun(automation.schedule, timezone, now);
    if (!due || due.getTime() < new Date(automation.createdAt).getTime()) continue;

    const [last] = await db
      .select({
        startedAt: schema.automationRuns.startedAt,
        status: schema.automationRuns.status,
      })
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.automationId, automation.id))
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(1);
    const covered =
      last && new Date(last.startedAt).getTime() >= due.getTime() && last.status !== "error";
    if (covered) continue;

    missed.push({ id: automation.id, name: automation.name, dueAt: due.toISOString() });
  }
  return missed;
}

export async function runMissedAutomations(): Promise<MissedAutomation[]> {
  const missed = await findMissedAutomations();
  for (const item of missed) {
    log.info({ automationId: item.id, dueAt: item.dueAt }, "catching up missed automation run");
    runAutomation(item.id, { trigger: { kind: "catchUp", dueAt: item.dueAt } }).catch(
      (error: unknown) => log.error({ err: error, automationId: item.id }, "catch-up run failed"),
    );
  }
  return missed;
}

async function retireIfOneOff(automationId: string, result: AutomationRunResult): Promise<void> {
  if (!result.started || !result.schedule || !isOneOffSchedule(result.schedule)) return;
  if (result.succeeded) {
    await db
      .update(schema.automations)
      .set({ enabled: false })
      .where(eq(schema.automations.id, automationId));
    unschedule(automationId);
    return;
  }
  log.warn(
    { automationId },
    "one-off automation run failed — not retiring it so it stays scheduled for a retry",
  );
}

async function schedule(automation: { id: string; schedule: string }): Promise<void> {
  const timezone = (await getTimezoneSetting()) ?? undefined;
  const stale = tasks.get(automation.id);
  if (stale) void stale.destroy();
  const task = cron.schedule(
    automation.schedule,
    () => {
      runAutomation(automation.id).catch((error: unknown) =>
        log.error({ err: error, automationId: automation.id }, "scheduled automation failed"),
      );
    },
    timezone ? { timezone } : undefined,
  );
  tasks.set(automation.id, task);
}

export function unschedule(automationId: string): void {
  const task = tasks.get(automationId);
  if (task) {
    void task.destroy();
    tasks.delete(automationId);
  }
}

const scheduleJobs = new KeyedJobs();

async function applySchedule(automationId: string): Promise<void> {
  unschedule(automationId);
  const [automation] = await db
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.id, automationId));
  if (automation?.enabled && isValidCron(automation.schedule)) {
    await schedule(automation);
  }
}

export async function refreshSchedule(automationId: string): Promise<void> {
  return scheduleJobs.enqueue(automationId, () => applySchedule(automationId));
}

export async function rescheduleAll(): Promise<void> {
  if (!schedulerStarted) return;
  const all = await db.select().from(schema.automations);
  for (const automation of all) {
    await scheduleJobs.enqueue(automation.id, () => applySchedule(automation.id));
  }
}

export async function startScheduler(): Promise<void> {
  await sweepOrphanedRuns();

  const all = await db.select().from(schema.automations);
  for (const automation of all) {
    if (automation.enabled && isValidCron(automation.schedule)) {
      await schedule(automation);
    }
  }
  schedulerStarted = true;
  log.info({ count: tasks.size }, "automations scheduled");

  void runMissedAutomations().catch((error: unknown) =>
    log.error({ err: error }, "boot catch-up failed"),
  );
}

export function stopScheduler(): void {
  schedulerStarted = false;
  for (const task of tasks.values()) void task.destroy();
  tasks.clear();
}
