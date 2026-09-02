import type { RunStep } from "@marlen/shared";
import { coalescedEmitter } from "../../core/events.js";

/**
 * The live tool-call trail of the runs executing right now, so Home can show
 * what a run is doing instead of only that it is busy. Deliberately in memory:
 * the trail is worthless once the run ends, and the finished run's calls
 * persist on its assistant message.
 */
const byRun = new Map<string, RunStep[]>();

/** A long run calls many tools; the feed shows the tail, oldest dropped first. */
const MAX_STEPS = 8;

/** A tool call every few seconds would refetch the feed as often; coalesce. */
const announce = coalescedEmitter("runs", 1500);

export function startRunStep(runId: string, id: string, label: string): void {
  const steps = byRun.get(runId) ?? [];
  steps.push({ id, label, failed: false, startedAt: new Date().toISOString() });
  byRun.set(runId, steps.slice(-MAX_STEPS));
  announce();
}

export function endRunStep(runId: string, id: string, failed: boolean): void {
  const step = byRun.get(runId)?.find((s) => s.id === id);
  if (!step) return;
  step.endedAt = new Date().toISOString();
  step.failed = failed;
  announce();
}

/** Drops the run's trail; the run row itself carries the outcome from here on. */
export function clearRunSteps(runId: string): void {
  byRun.delete(runId);
}

export function runSteps(runId: string): RunStep[] | undefined {
  const steps = byRun.get(runId);
  return steps?.length ? steps : undefined;
}
