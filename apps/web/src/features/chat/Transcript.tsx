import type { AccountColor, ChatToolCall } from "@marlen/shared";
import { Check, Copy, Pencil, Play, RotateCcw, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { EditSaveActions } from "@/components/draftActions";
import { Button } from "@/components/ui/button";
import { Highlight } from "@/components/ui/highlight";
import { HoverActions } from "@/components/ui/hover-actions";
import { SearchField } from "@/components/ui/search-field";
import { AgentAvatar } from "@/features/chat/AgentAvatar";
import { RefChips } from "@/features/chat/composer/RefChips";
import { RateLimitNotice } from "@/features/chat/RateLimitNotice";
import { RegenerateButton } from "@/features/chat/RegenerateButton";
import type { DisplayMessage } from "@/features/chat/runState";
import { AssistantSequence } from "@/features/chat/ToolActivity";
import { dateTimeLabel, dayLabel, isToday } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { useAutoGrow } from "@/lib/useAutoGrow";
import { cn, rowTransition, withViewTransition } from "@/lib/utils";

/** A message typed while a reply was running, waiting for its turn to be sent. */
export interface QueuedMessage {
  id: string;
  text: string;
}

/** What a conversation search is looking for and which hit it sits on. */
interface TranscriptSearch {
  query: string;
  currentId?: string;
}

/** Clipboard write with a short "copied" confirmation; a refused write toasts. */
function useCopyToClipboard() {
  const [copied, setCopied] = React.useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(err);
    }
  };
  return { copied, copy };
}

/** Chronology in a long thread: "Today"/"Yesterday", else the day spelled out. */
function DayHeading({ iso }: { iso: string }) {
  const { t, i18n } = useTranslation();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const near = isToday(iso)
    ? t("chat.groupToday")
    : new Date(iso).toDateString() === yesterday.toDateString()
      ? t("chat.groupYesterday")
      : null;
  return (
    <p className="animate-in-up py-1 text-center text-2xs uppercase tracking-wide text-muted-foreground">
      {near ?? dayLabel(iso, i18n.language)}
    </p>
  );
}

/**
 * Whether a day heading belongs above `message`. Only for a transcript that
 * moves forward in time: the placeholder standing in for a reply another
 * client is streaming carries no real timestamp, and a heading from it would
 * date the conversation wrong.
 */
function startsNewDay(message: DisplayMessage, previous: DisplayMessage | undefined): boolean {
  const at = Date.parse(message.createdAt);
  if (Number.isNaN(at)) return false;
  if (!previous) return true;
  const before = Date.parse(previous.createdAt);
  if (Number.isNaN(before) || at < before) return false;
  return new Date(at).toDateString() !== new Date(before).toDateString();
}

/**
 * The conversation as it reads: cards, the user's bubbles, the assistant's
 * prose and tool activity, day headings between them, and the messages still
 * waiting their turn at the end.
 */
export function Transcript({
  messages,
  accountColors,
  queued,
  search,
  hitRef,
  onRetryTurn,
  onRegenerate,
  onContinue,
  onRetryTool,
  onCancelQueued,
  onEditQueued,
}: {
  messages: DisplayMessage[];
  accountColors: AccountColor[];
  queued: QueuedMessage[];
  search?: TranscriptSearch;
  /** Attached to the message the search sits on, so the panel can scroll to it. */
  hitRef?: React.RefObject<HTMLDivElement | null>;
  /** Sends the question a failed reply answered again, as a new turn. */
  onRetryTurn: (index: number) => void;
  /** Asks the same question again, of whichever model the user picks. */
  onRegenerate: (index: number) => void;
  /** Asks the assistant to carry on the reply the user stopped. */
  onContinue: () => void;
  onRetryTool: (call: ChatToolCall) => void;
  onCancelQueued: (id: string) => void;
  /** Rewrites a waiting message before its turn comes. */
  onEditQueued: (id: string, text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const query = search?.query.trim() ?? "";

  return (
    <div className="thread-column flex flex-col gap-4 py-1">
      {messages.map((m, i) => (
        <React.Fragment key={m.id}>
          {startsNewDay(m, messages[i - 1]) && <DayHeading iso={m.createdAt} />}
          <div
            ref={search?.currentId === m.id ? hitRef : undefined}
            title={
              Number.isNaN(Date.parse(m.createdAt))
                ? undefined
                : dateTimeLabel(m.createdAt, i18n.language)
            }
            className={cn(
              "group animate-in-up flex flex-col gap-2",
              m.role === "user" ? "items-end" : "w-full items-start",
              search?.currentId === m.id && "thread-hit",
            )}
          >
            {/* Cards sit on the chat canvas as their own outlined blocks
                (CardShell carries the hairline), full-width like the
                assistant's prose. */}
            {m.cards.length > 0 && (
              <div className="flex w-full flex-col gap-2">
                {m.cards.map((c) => (
                  <AgentCardView key={c.toolCallId} card={c.card} colors={accountColors} />
                ))}
              </div>
            )}
            {/* Pinned emails sit outside the bubble, like cards: a neutral chip
                on the canvas rather than baked into the accent fill, so the
                selected email reads as quiet reference, not high-contrast. */}
            {m.role === "user" && m.refs && m.refs.length > 0 && (
              <RefChips refs={m.refs} colors={accountColors} />
            )}
            {(m.content || m.streaming || m.toolCalls.length > 0 || m.error || m.systemPrompt) && (
              <div
                className={cn(
                  "flex w-full gap-2",
                  m.role === "user" ? "justify-end" : "flex-col gap-1.5",
                )}
              >
                {/* The avatar tops the turn; its bloom lights while this
                    turn is still streaming. */}
                {m.role === "assistant" && <AgentAvatar active={m.streaming} />}
                <div
                  className={cn(
                    "text-sm",
                    m.role === "user"
                      ? "bubble-accent max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-accent-foreground"
                      : "min-w-0 text-foreground",
                  )}
                >
                  {m.systemPrompt ? (
                    <SystemPromptView prompt={m.systemPrompt} />
                  ) : m.role === "assistant" ? (
                    <AssistantSequence
                      message={m}
                      thinkingLabel={t("chat.thinking")}
                      onRetryTool={onRetryTool}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {query ? <Highlight text={m.content} query={query} /> : m.content}
                    </div>
                  )}
                  {m.error && (
                    <div
                      role="alert"
                      className={cn(
                        "text-destructive",
                        (m.content || m.toolCalls.length > 0) && "mt-2",
                      )}
                    >
                      {m.errorKind === "rate_limit" ? <RateLimitNotice /> : m.error}
                    </div>
                  )}
                  {m.role === "assistant" && !m.streaming && !m.systemPrompt && (
                    <MessageActions
                      content={m.content}
                      last={i === messages.length - 1}
                      onRegenerate={i === messages.length - 1 ? () => onRegenerate(i) : undefined}
                      stopped={m.stopped}
                      onContinue={m.stopped && i === messages.length - 1 ? onContinue : undefined}
                      onRetry={
                        m.error && i === messages.length - 1 ? () => onRetryTurn(i) : undefined
                      }
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </React.Fragment>
      ))}

      {queued.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-right text-2xs uppercase tracking-wide text-muted-foreground">
            {t("chat.queue.waiting", { count: queued.length })}
          </p>
          {queued.map((item) => (
            <QueuedRow
              key={item.id}
              item={item}
              onCancel={() => onCancelQueued(item.id)}
              onEdit={(text) => onEditQueued(item.id, text)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One message waiting its turn. It has not been sent yet, so it stays the
 * user's to change: the bubble morphs into its own editor in place, and
 * saving an empty one is the same as taking it out of the queue.
 */
function QueuedRow({
  item,
  onCancel,
  onEdit,
}: {
  item: QueuedMessage;
  onCancel: () => void;
  onEdit: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState<string | null>(null);
  const editRef = React.useRef<HTMLTextAreaElement>(null);
  useAutoGrow(editRef, draft ?? "");

  const morph = (next: string | null) => withViewTransition(() => setDraft(next));

  const save = () => {
    const text = (draft ?? "").trim();
    morph(null);
    if (!text) onCancel();
    else if (text !== item.text) onEdit(text);
  };

  if (draft !== null) {
    return (
      <div className="flex flex-col items-end gap-2" style={rowTransition(`queued-${item.id}`)}>
        <textarea
          ref={editRef}
          value={draft}
          // biome-ignore lint/a11y/noAutofocus: the caret belongs in the editor the user just opened
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              morph(null);
              return;
            }
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            save();
          }}
          aria-label={t("chat.queue.edit")}
          className="field max-h-40 w-full max-w-[85%] resize-none rounded-2xl px-4 py-2.5 text-sm leading-relaxed focus:outline-none"
        />
        <EditSaveActions saving={false} busy={false} onCancel={() => morph(null)} onSave={save} />
      </div>
    );
  }

  return (
    <div
      className="group animate-in-up flex items-center justify-end gap-1"
      style={rowTransition(`queued-${item.id}`)}
    >
      <HoverActions>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => morph(item.text)}
          aria-label={t("chat.queue.edit")}
          title={t("chat.queue.edit")}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCancel}
          aria-label={t("chat.queue.cancel")}
          title={t("chat.queue.cancel")}
        >
          <X />
        </Button>
      </HoverActions>
      {/* Recessed, not the accent bubble: this message has not been sent yet. */}
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-sm leading-relaxed text-muted-foreground">
        {item.text}
      </div>
    </div>
  );
}

/**
 * Quiet per-turn actions under an assistant reply: copy the text, carry on a
 * reply the user stopped, and after a failure send the question again. Always
 * visible on the last turn, hover-revealed on older ones.
 */
function MessageActions({
  content,
  last,
  stopped,
  onContinue,
  onRegenerate,
  onRetry,
}: {
  content: string;
  last: boolean;
  stopped?: boolean;
  onContinue?: () => void;
  onRegenerate?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyToClipboard();
  return (
    <HoverActions className={cn("-ml-1.5 mt-1", last && "sm:opacity-100")}>
      {content && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void copy(content)}
          aria-label={copied ? t("chat.message.copied") : t("chat.message.copy")}
          title={t("chat.message.copy")}
        >
          {copied ? <Check className="check-pop text-success" /> : <Copy />}
        </Button>
      )}
      {onContinue && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onContinue}
          aria-label={t("chat.message.continue")}
          title={t("chat.message.continue")}
        >
          <Play />
        </Button>
      )}
      {onRegenerate && <RegenerateButton onRegenerate={onRegenerate} />}
      {onRetry && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRetry}
          aria-label={t("chat.message.retry")}
          title={t("chat.message.retry")}
        >
          <RotateCcw />
        </Button>
      )}
      {stopped && (
        <span className="pl-1 text-2xs text-muted-foreground">{t("chat.message.stopped")}</span>
      )}
    </HoverActions>
  );
}

/** Compact inspector returned by /sys, with literal prompt text and in-place matches. */
function SystemPromptView({ prompt }: { prompt: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const { copied, copy } = useCopyToClipboard();
  const normalized = query.trim().toLocaleLowerCase();
  const matchCount = normalized ? prompt.toLocaleLowerCase().split(normalized).length - 1 : 0;

  return (
    <section
      className="overflow-hidden rounded-xl bg-surface-2"
      aria-label={t("chat.systemPrompt.title")}
    >
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <span className="px-1 text-xs font-semibold">{t("chat.systemPrompt.title")}</span>
        <SearchField
          size="sm"
          value={query}
          onChange={setQuery}
          placeholder={t("chat.systemPrompt.search")}
          className="ml-auto min-w-40 flex-1 sm:max-w-64"
        />
        {normalized && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("chat.systemPrompt.matches", { count: matchCount })}
          </span>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy(prompt)}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("chat.systemPrompt.copied") : t("chat.systemPrompt.copy")}
        </Button>
      </div>
      <pre className="max-h-112 overflow-auto whitespace-pre-wrap break-words bg-background/55 p-4 font-mono text-xs leading-relaxed">
        <Highlight text={prompt} query={query} minLength={1} />
      </pre>
    </section>
  );
}
