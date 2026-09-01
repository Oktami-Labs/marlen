import { randomUUID } from "node:crypto";
import type { MessageCard, RunTrigger } from "@marlen/shared";
import { and, desc, eq } from "drizzle-orm";
import { env } from "../../core/env.js";
import { emitRunNotification, emitServerEvent } from "../../core/events.js";
import { moduleLogger } from "../../core/logger.js";
import { errorMessage } from "../../core/utils/util.js";
import { db, schema } from "../../db/index.js";
import { automationThreadContext } from "./threadState.js";
import { getTurnRunner } from "./turnRunner.js";

const log = moduleLogger("runRecorder");

const DEFAULT_TIMEOUT_MS =
  Number.isFinite(env.automationRunTimeoutMs) && env.automationRunTimeoutMs > 0
    ? env.automationRunTimeoutMs
    : 600_000;

const NOTIFICATION_SUMMARY_CHARS = 140;

function notificationSummary(result: string): string {
  const firstLine = result.split("\n", 1)[0] ?? "";
  return firstLine.slice(0, NOTIFICATION_SUMMARY_CHARS);
}

const APPROVAL_CARD_KINDS = new Set(["email_draft", "message_draft"]);

function leftApprovals(cardsJson: string | null): boolean {
  if (!cardsJson) return false;
  const cards = JSON.parse(cardsJson) as MessageCard[];
  return cards.some((entry) => APPROVAL_CARD_KINDS.has(entry.card.kind));
}

export interface AutomationRunResult {
  started: boolean;
  succeeded: boolean;
  schedule?: string;
}

export async function executeAutomationRun(
  automationId: string,
  opts: { manual?: boolean; timeoutMs?: number; trigger?: RunTrigger } = {},
): Promise<AutomationRunResult> {
  const [automation] = await db
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.id, automationId));
  // Recheck scheduled work; manual runs may execute while paused.
  if (!automation || (!automation.enabled && !opts.manual)) {
    log.warn(
      { automationId, found: Boolean(automation) },
      "skipping run — automation is missing or disabled",
    );
    return { started: false, succeeded: false };
  }

  const runId = randomUUID();
  const conversationId = `automation:${automationId}`;
  const runLog = log.child({ runId, automationId, automation: automation.name });
  const startedAt = Date.now();
  runLog.info("automation run started");

  await db.insert(schema.automationRuns).values({
    id: runId,
    automationId,
    conversationId,
    status: "running",
    result: "",
    trigger: opts.trigger ? JSON.stringify(opts.trigger) : null,
    startedAt: new Date().toISOString(),
  });
  emitServerEvent("runs");

  const timeoutMs =
    opts.timeoutMs !== undefined && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  let succeeded = false;
  try {
    const [lastSuccess] = await db
      .select({ finishedAt: schema.automationRuns.finishedAt })
      .from(schema.automationRuns)
      .where(
        and(
          eq(schema.automationRuns.automationId, automationId),
          eq(schema.automationRuns.status, "success"),
        ),
      )
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(1);
    const context = [
      lastSuccess?.finishedAt
        ? `The previous successful run finished at ${lastSuccess.finishedAt}.`
        : "This automation has no previous successful run.",
    ];
    const trigger = opts.trigger;
    if (trigger?.kind === "catchUp") {
      context.push(
        `This is a catch-up run for the scheduled slot due at ${trigger.dueAt}. Execute the ` +
          `instruction once, as if it ran at that slot, and keep its normal time window; do not ` +
          `turn one catch-up into an unbounded historical sweep.`,
      );
    } else if (trigger?.kind === "todo") {
      context.push(
        `This run fired because the user completed the linked todo "${trigger.title}" (todo id ${trigger.todoId}). Whoever or whatever that todo names is the subject of this run.`,
      );
    } else if (trigger?.kind === "mail") {
      context.push(
        `This run was triggered by new inbound mail in: ${trigger.accountNames.join(", ")}. Start from that mailbox's newest messages instead of sweeping every account.`,
      );
    }
    const durableThreadContext = await automationThreadContext(automationId);
    const todoNotes =
      trigger?.kind === "todo" && trigger.body
        ? `\n\nNotes from the completed todo "${trigger.title}":\n${trigger.body}`
        : "";
    const instructionMessage =
      `Scheduled automation "${automation.name}". ${context.join(" ")}` +
      `${durableThreadContext} Execute this instruction now and report the outcome:\n\n` +
      `${automation.instruction}${todoNotes}`;

    const { text, cardsJson } = await getTurnRunner()({
      runId,
      conversationId,
      prompt: instructionMessage,
      title: `Run: ${automation.name}`,
      signal,
      log: runLog,
    });

    await db
      .update(schema.automationRuns)
      .set({
        status: "success",
        result: text,
        cards: cardsJson,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(schema.automationRuns.id, runId));
    emitServerEvent("runs");
    // Approval work always notifies, independent of completion preferences.
    if (automation.notifyOnCompletion || leftApprovals(cardsJson)) {
      emitRunNotification({
        runId,
        automationId,
        automationName: automation.name,
        status: "success",
        summary: notificationSummary(text),
      });
    }
    runLog.info({ durationMs: Date.now() - startedAt }, "automation run finished");
    succeeded = true;
  } catch (error) {
    const timedOut = signal.aborted;
    const message = timedOut
      ? `Run stopped after exceeding the ${Math.round(timeoutMs / 1000)}s time limit.`
      : errorMessage(error);
    runLog.error(
      { err: error, timedOut, durationMs: Date.now() - startedAt },
      "automation run failed",
    );
    await db
      .update(schema.automationRuns)
      .set({
        status: "error",
        result: message,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(schema.automationRuns.id, runId));
    emitServerEvent("runs");
    emitRunNotification({
      runId,
      automationId,
      automationName: automation.name,
      status: "error",
      summary: notificationSummary(message),
    });
  }

  return { started: true, succeeded, schedule: automation.schedule };
}

export async function sweepOrphanedRuns(): Promise<void> {
  const orphaned = await db
    .update(schema.automationRuns)
    .set({
      status: "error",
      result: "Interrupted by a server restart before the run could finish.",
      finishedAt: new Date().toISOString(),
    })
    .where(eq(schema.automationRuns.status, "running"))
    .returning({ id: schema.automationRuns.id });
  if (orphaned.length > 0) {
    log.warn({ count: orphaned.length }, "orphaned in-flight automation runs marked as error");
  }
}
