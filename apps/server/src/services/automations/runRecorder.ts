import { randomUUID } from "node:crypto";
import { LANGUAGE_ENGLISH_NAMES, type MessageCard, type RunTrigger } from "@marlen/shared";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { env } from "../../core/env.js";
import { emitRunNotification, emitServerEvent } from "../../core/events.js";
import { moduleLogger } from "../../core/logger.js";
import { errorMessage } from "../../core/utils/util.js";
import { db, schema } from "../../db/index.js";
import { getLanguageSetting } from "../../db/settings.js";
import { automationReportContext } from "./reportState.js";
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

const DRAFT_OUTCOME_LIMIT = 20;

/**
 * Drafts from earlier runs the user sent or discarded since the previous run.
 * Feedback rides the prompt; the model decides what to make of it.
 */
async function draftOutcomeContext(conversationId: string, since: string): Promise<string> {
  const rows = await db
    .select({
      subject: schema.agentDrafts.subject,
      to: schema.agentDrafts.toAddrs,
      status: schema.agentDrafts.status,
    })
    .from(schema.agentDrafts)
    .where(
      and(
        eq(schema.agentDrafts.conversationId, conversationId),
        inArray(schema.agentDrafts.status, ["sent", "discarded"]),
        gt(schema.agentDrafts.updatedAt, since),
      ),
    )
    .orderBy(desc(schema.agentDrafts.updatedAt))
    .limit(DRAFT_OUTCOME_LIMIT);
  if (rows.length === 0) return "";
  const lines = rows.map((row) => {
    const to = (JSON.parse(row.to) as string[]).join(", ");
    return `- ${row.status}: "${row.subject || "(no subject)"}" to ${to || "(no recipients)"}`;
  });
  return (
    "\n\nDrafts from earlier runs the user decided on since the previous run:\n" +
    `${lines.join("\n")}\n` +
    "A discarded draft was not wanted. Weigh that before drafting a similar reply again, and " +
    "note a lasting pattern in the wiki."
  );
}

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
  // The automations list carries each automation's newest run.
  emitServerEvent("runs");
  emitServerEvent("automations");

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
    const language = (await getLanguageSetting()) ?? "de";
    const context = [
      lastSuccess?.finishedAt
        ? `The previous successful run finished at ${lastSuccess.finishedAt}.`
        : "This automation has no previous successful run.",
      `Report in ${LANGUAGE_ENGLISH_NAMES[language]}.`,
    ];
    const trigger = opts.trigger;
    if (trigger?.kind === "catchUp") {
      context.push(
        `This is a catch-up run for the scheduled slot due at ${trigger.dueAt}. Execute the ` +
          `instruction once, as if it ran at that slot, and keep its normal time window; do not ` +
          `turn one catch-up into an unbounded historical sweep.`,
      );
    } else if (trigger?.kind === "todo") {
      const ref = trigger.ref;
      const about =
        ref?.kind === "email_draft"
          ? ` It is about the email draft ${ref.draftId} to ${ref.to} in account ${ref.accountId}; use the draft tools to change, send or discard it.`
          : ref?.kind === "outbound"
            ? ` It is about the ${ref.channel} draft ${ref.outboundId} to ${ref.targetLabel}; use the ${ref.channel} tools to change or send it.`
            : "";
      context.push(
        (ref
          ? `This run fired because the user answered your question on the approval "${trigger.title}" (item id ${trigger.todoId}).`
          : `This run fired because the user completed the linked todo "${trigger.title}" (todo id ${trigger.todoId}). Whoever or whatever that todo names is the subject of this run.`) +
          about +
          (trigger.answer ? ` The user answered: "${trigger.answer}". Act on that answer.` : ""),
      );
    } else if (trigger?.kind === "mail") {
      context.push(
        `This run was triggered by new inbound mail in: ${trigger.accountNames.join(", ")}. Start from that mailbox's newest messages instead of sweeping every account.`,
      );
    }
    const durableThreadContext = await automationReportContext(automationId);
    const draftOutcomes = lastSuccess?.finishedAt
      ? await draftOutcomeContext(conversationId, lastSuccess.finishedAt)
      : "";
    const todoNotes =
      trigger?.kind === "todo" && trigger.body
        ? `\n\nNotes from the completed todo "${trigger.title}":\n${trigger.body}`
        : "";
    const instructionMessage =
      `Scheduled automation "${automation.name}". ${context.join(" ")}` +
      `${durableThreadContext}${draftOutcomes} Execute this instruction now and report the outcome:\n\n` +
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
    emitServerEvent("automations");
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
    emitServerEvent("automations");
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
