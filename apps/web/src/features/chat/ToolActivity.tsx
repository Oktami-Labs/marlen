import type { ChatToolCall } from "@marlen/shared";
import { Check, RotateCcw, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { HoverActions } from "@/components/ui/hover-actions";
import { Markdown } from "@/components/ui/markdown";
import { Spinner } from "@/components/ui/spinner";
import type { DisplayMessage } from "@/features/chat/runState";
import { cn } from "@/lib/utils";

function formatToolValue(value: unknown, unavailable: string): string {
  if (value === undefined) return unavailable;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** First line of a failed call's result, short enough to sit on the row. */
function errorExcerpt(result: unknown): string {
  if (result === undefined || result === null) return "";
  const text = typeof result === "string" ? result : formatToolValue(result, "");
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

/**
 * Live elapsed readout for a running tool; freezes where it stands when the
 * call completes. Renders nothing for calls restored already-done, where the
 * start time is unknown.
 */
function ToolTimer({ done }: { done: boolean }) {
  const start = React.useRef(performance.now());
  const restored = React.useRef(done);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  React.useEffect(() => {
    if (restored.current || done) return;
    const id = window.setInterval(() => setElapsedMs(performance.now() - start.current), 100);
    return () => window.clearInterval(id);
  }, [done]);
  if (restored.current) return null;
  return (
    <span className="ml-auto shrink-0 pl-2 font-mono text-2xs tabular-nums text-muted-foreground/70">
      {(elapsedMs / 1000).toFixed(1)}s
    </span>
  );
}

/**
 * One tool call as a disclosure row. A failed call says so on the row itself:
 * the error's first line, which attempt it was, and an action that asks for
 * that one call again instead of replaying the whole turn.
 */
function ToolActivity({
  call,
  attempt,
  onRetry,
}: {
  call: ChatToolCall;
  /** Which attempt at this tool the call was, within its turn. Shown from 2 on. */
  attempt: number;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const failed = call.done && call.isError;
  const excerpt = failed ? errorExcerpt(call.result) : "";
  return (
    <details className="animate-in-up my-1 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 hover:text-foreground">
        {!call.done ? (
          <Spinner className="h-3 w-3" />
        ) : call.isError ? (
          <X className="check-pop h-3 w-3 shrink-0 text-destructive" strokeWidth={3} />
        ) : (
          <Check className="check-pop h-3 w-3 shrink-0 text-success" strokeWidth={3} />
        )}
        <span className={cn("truncate", !call.done && "text-shimmer")} title={call.name}>
          {call.label ?? call.name}
        </span>
        {call.detail && !call.done && <span className="truncate opacity-70">· {call.detail}</span>}
        {failed && <span className="shrink-0 text-destructive">· {t("chat.tool.failed")}</span>}
        {failed && attempt > 1 && (
          <span className="shrink-0">· {t("chat.tool.attempt", { n: attempt })}</span>
        )}
        {excerpt && (
          <span className="min-w-0 truncate opacity-70" title={excerpt}>
            · {excerpt}
          </span>
        )}
        {onRetry && (
          <HoverActions className="shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              // Inside a summary, so the toggle must not also fire.
              onClick={(e) => {
                e.preventDefault();
                onRetry();
              }}
              aria-label={t("chat.tool.retry")}
              title={t("chat.tool.retry")}
            >
              <RotateCcw />
            </Button>
          </HoverActions>
        )}
        <ToolTimer done={call.done} />
      </summary>
      <div className="mt-1 space-y-2 border-l border-border pl-3">
        <div>
          <div className="mb-0.5 font-medium">{t("chat.tool.parameters")}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono text-2xs text-foreground">
            {formatToolValue(call.parameters, t("chat.tool.noValue"))}
          </pre>
        </div>
        <div>
          <div className="mb-0.5 font-medium">{t("chat.tool.result")}</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono text-2xs text-foreground">
            {call.done
              ? formatToolValue(call.result, t("chat.tool.noValue"))
              : t("chat.tool.running")}
          </pre>
        </div>
      </div>
    </details>
  );
}

/** A closed cluster this long folds into a step-count summary line. */
const CLUSTER_COLLAPSE_MIN = 4;

/**
 * One contiguous run of tool calls with no prose between them. While the run
 * is live the steps stay visible and tick off one by one; once the cluster is
 * `closed` (prose follows it, or the turn is over) a long fully-finished
 * cluster folds into a step-count line so past work reads as one quiet
 * summary instead of a wall of rows. A cluster holding a failure never folds:
 * the thing that went wrong stays on screen with its retry.
 */
function ToolCluster({
  calls,
  closed,
  attempts,
  onRetryTool,
}: {
  calls: ChatToolCall[];
  closed: boolean;
  attempts: Map<string, number>;
  onRetryTool?: (call: ChatToolCall) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const failed = calls.filter((c) => c.isError).length;
  const rows = calls.map((c) => (
    <ToolActivity
      key={c.id}
      call={c}
      attempt={attempts.get(c.id) ?? 1}
      onRetry={c.done && c.isError && onRetryTool ? () => onRetryTool(c) : undefined}
    />
  ));
  const collapsible =
    closed && failed === 0 && calls.length >= CLUSTER_COLLAPSE_MIN && calls.every((c) => c.done);
  if (!collapsible) return <>{rows}</>;
  return (
    <div className="my-1">
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen((o) => !o)}
        className="animate-in-up py-0.5"
      >
        {t("chat.tool.steps", { count: calls.length })}
      </DisclosureToggle>
      {open && rows}
    </div>
  );
}

/** Keeps visible assistant prose in its actual position around tool calls. */
export function AssistantSequence({
  message,
  thinkingLabel,
  onRetryTool,
}: {
  message: DisplayMessage;
  thinkingLabel: string;
  /** Asks for one failed call again; withheld while the turn is still running. */
  onRetryTool?: (call: ChatToolCall) => void;
}) {
  const calls = [...message.toolCalls].sort(
    (a, b) => (a.contentOffset ?? 0) - (b.contentOffset ?? 0),
  );
  // How many times this turn had reached for the same tool by this call, which
  // is what makes a repeated failure read as one thing going wrong repeatedly.
  const attempts = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const call of message.toolCalls) {
    const nth = (seen.get(call.name) ?? 0) + 1;
    seen.set(call.name, nth);
    attempts.set(call.id, nth);
  }
  // Prose-separated clusters: a call with no text since the previous one joins
  // the previous cluster. Keyed by the first call's id, stable while the
  // stream appends calls and text.
  const groups: { key: string; text: string; calls: ChatToolCall[] }[] = [];
  let offset = 0;
  for (const call of calls) {
    const callOffset = Math.max(offset, Math.min(message.content.length, call.contentOffset ?? 0));
    const text = message.content.slice(offset, callOffset);
    const last = groups[groups.length - 1];
    if (last && !text) last.calls.push(call);
    else groups.push({ key: call.id, text, calls: [call] });
    offset = callOffset;
  }
  const tail = message.content.slice(offset);
  const parts: React.ReactNode[] = groups.flatMap((group, i) => [
    group.text ? <Markdown key={`text-${group.key}`} content={group.text} /> : null,
    <ToolCluster
      key={`calls-${group.key}`}
      calls={group.calls}
      closed={!message.streaming || i < groups.length - 1 || tail.length > 0}
      attempts={attempts}
      onRetryTool={message.streaming ? undefined : onRetryTool}
    />,
  ]);
  if (tail) parts.push(<Markdown key="text-tail" content={tail} stream={message.streaming} />);
  if (message.streaming && (message.thinking || parts.length === 0)) {
    parts.push(
      <div key="thinking" className="text-shimmer leading-relaxed">
        {thinkingLabel}
      </div>,
    );
  }
  return <>{parts}</>;
}
