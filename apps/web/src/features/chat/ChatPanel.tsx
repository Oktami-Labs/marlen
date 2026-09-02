import type { ChatToolCall, EmailRef } from "@marlen/shared";
import type { ParseKeys } from "i18next";
import { ArrowDown, Plus, Quote, Send, Square } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LoadingRow, Notice } from "@/components/ui/feedback";
import { AgentAvatar } from "@/features/chat/AgentAvatar";
import { GroundingMenu } from "@/features/chat/composer/GroundingMenu";
import { RefChips } from "@/features/chat/composer/RefChips";
import { SlashMenu } from "@/features/chat/composer/SlashMenu";
import { useComposerDraft } from "@/features/chat/composer/useComposerDraft";
import { useGroundingPicker } from "@/features/chat/composer/useGroundingPicker";
import { useSlashCommands } from "@/features/chat/composer/useSlashCommands";
import { VoiceInput } from "@/features/chat/composer/VoiceInput";
import { onChatCommand } from "@/features/chat/controller";
import { HistoryList } from "@/features/chat/HistoryList";
import { ModelControl } from "@/features/chat/ModelControl";
import type { DisplayMessage } from "@/features/chat/runState";
import { type QueuedMessage, Transcript } from "@/features/chat/Transcript";
import { useChatRuns } from "@/features/chat/useChatRuns";
import { useFollowScroll } from "@/features/chat/useFollowScroll";
import { useQuoteSelection } from "@/features/chat/useQuoteSelection";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import { useServerConnection } from "@/lib/serverEvents";
import { toast } from "@/lib/toast";
import { useAutoGrow } from "@/lib/useAutoGrow";
import { cn, errorMessage } from "@/lib/utils";
import { useAppVersion } from "@/lib/version";

const SHOWCASE_COMMAND = "/showcase";
const SYSTEM_PROMPT_COMMAND = "/sys";

interface PendingSend extends QueuedMessage {
  refs?: EmailRef[];
  newConversation: boolean;
}

function pendingSend(text: string, options: Partial<PendingSend> = {}): PendingSend {
  return { id: crypto.randomUUID(), text, newConversation: false, ...options };
}

export function ChatPanel({
  historyOpen,
  setHistoryOpen,
  layout = "panel",
  onConversationChange,
  pendingFocusAccountId,
  search,
  onSearchHits,
}: {
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  layout?: "panel" | "page";
  onConversationChange?: (id: string | undefined) => void;
  pendingFocusAccountId?: string | null;
  search?: { query: string; hit: number };
  onSearchHits?: (count: number) => void;
}) {
  const { t } = useTranslation();
  const [queue, setQueue] = React.useState<PendingSend[]>([]);
  const { colors: accountColors } = useAccountColors({ withAccounts: false });
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const focusComposer = React.useCallback(() => {
    textareaRef.current?.focus();
  }, []);
  const runs = useChatRuns({
    setHistoryOpen,
    onFocusComposer: focusComposer,
    pendingFocusAccountId,
  });
  const { text: input, setText: setInput, ...composerRefs } = useComposerDraft(runs.conversationId);

  const isPage = layout === "page";
  const transcriptShown = (isPage || !historyOpen) && !runs.restoring && runs.messages.length > 0;
  const emptyConversation =
    (isPage || !historyOpen) && !runs.restoring && runs.messages.length === 0 && queue.length === 0;
  const centerEmptyConversation = isPage && emptyConversation;
  const lastMessage = runs.messages[runs.messages.length - 1];
  const scroll = useFollowScroll(
    viewportRef,
    transcriptShown
      ? `${runs.conversationId}:${runs.messages.length}:${lastMessage?.id}:${queue.length}`
      : null,
    runs.messages,
  );

  const query = search?.query.trim().toLocaleLowerCase() ?? "";
  const hitIds = React.useMemo(
    () =>
      query
        ? runs.messages
            .filter((m) => m.content.toLocaleLowerCase().includes(query))
            .map((m) => m.id)
        : [],
    [runs.messages, query],
  );
  const currentHitId = hitIds[Math.min(search?.hit ?? 0, Math.max(0, hitIds.length - 1))];
  const hitRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    onSearchHits?.(hitIds.length);
  }, [hitIds.length, onSearchHits]);
  React.useEffect(() => {
    if (currentHitId) hitRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentHitId]);

  React.useEffect(() => {
    document.documentElement.toggleAttribute("data-agent-busy", runs.busy);
    return () => document.documentElement.removeAttribute("data-agent-busy");
  }, [runs.busy]);

  React.useEffect(() => {
    onConversationChange?.(runs.conversationId);
  }, [runs.conversationId, onConversationChange]);

  useAutoGrow(textareaRef, input);

  const showcase = async (message: string) => {
    const { SHOWCASE_TURNS } = await import("@/components/cards/samples");
    const createdAt = new Date().toISOString();
    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      createdAt,
      toolCalls: [],
      cards: [],
      streaming: false,
    };
    const turns: DisplayMessage[] = SHOWCASE_TURNS.map((turn, turnIndex) => ({
      id: crypto.randomUUID(),
      role: "assistant",
      content: turn.contentKey ? String(t(turn.contentKey as ParseKeys)) : (turn.content ?? ""),
      createdAt,
      toolCalls: (turn.toolCalls ?? []).map((call, i) => ({
        ...call,
        id: `showcase-tool-${turnIndex}-${i}`,
      })),
      cards: (turn.cards ?? []).map((card, i) => ({
        toolCallId: `showcase-${turnIndex}-${i}`,
        card,
      })),
      streaming: turn.thinking ?? false,
      thinking: turn.thinking,
      stopped: turn.stopped,
    }));
    runs.appendMessages([userMessage, ...turns]);
  };

  const showSystemPrompt = async (message: string) => {
    runs.setBusy(true);
    const createdAt = new Date().toISOString();
    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      createdAt,
      toolCalls: [],
      cards: [],
      streaming: false,
    };
    const loadingMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt,
      toolCalls: [],
      cards: [],
      streaming: true,
      thinking: true,
    };
    runs.appendMessages([userMessage, loadingMessage]);
    try {
      const { prompt } = await api.systemPrompt();
      runs.updateMessage(loadingMessage.id, {
        streaming: false,
        thinking: false,
        systemPrompt: prompt,
      });
    } catch (err) {
      const messageText = errorMessage(err);
      toast.error(err);
      runs.updateMessage(loadingMessage.id, {
        streaming: false,
        thinking: false,
        error: messageText,
      });
    } finally {
      runs.setBusy(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const sendText = async (message: string, sendRefs?: EmailRef[]): Promise<boolean> => {
    if (!message || runs.busy) return true;
    setHistoryOpen(false);

    if (import.meta.env.DEV && message.toLowerCase() === SHOWCASE_COMMAND) {
      await showcase(message);
      return true;
    }
    if (message.toLowerCase() === SYSTEM_PROMPT_COMMAND) {
      await showSystemPrompt(message);
      return true;
    }
    return runs.send(message, sendRefs);
  };

  const restoreDraft = (message: string, sendRefs?: EmailRef[]) => {
    setInput((current) => (current ? `${message}\n\n${current}` : message));
    for (const ref of sendRefs ?? []) composerRefs.add(ref);
    textareaRef.current?.focus();
  };

  // Local commands may await before marking the run busy.
  const sendingRef = React.useRef(false);

  const startSend = (message: string, sendRefs?: EmailRef[]) => {
    sendingRef.current = true;
    void sendText(message, sendRefs)
      .then((accepted) => {
        if (!accepted) restoreDraft(message, sendRefs);
      })
      .finally(() => {
        sendingRef.current = false;
      });
  };

  const sendOrQueue = (message: string, sendRefs?: EmailRef[]) => {
    if (!message) return;
    // Do not let transcript restoration overwrite a new turn.
    if (runs.busy || runs.restoring || sendingRef.current) {
      setQueue((pending) => [...pending, pendingSend(message, { refs: sendRefs })]);
      return;
    }
    startSend(message, sendRefs);
  };

  // Selected transcript text, offered back to the composer as a quote.
  const quote = useQuoteSelection(viewportRef);
  const connected = useServerConnection();

  // Typing "/" turns the composer into a command line over the user's own
  // skills and manual automations.
  const slash = useSlashCommands({
    input,
    setInput: (text) => {
      setInput(text);
      focusComposer();
    },
    submit: sendOrQueue,
    newConversation: runs.newConversation,
  });
  const grounding = useGroundingPicker({
    input,
    setInput,
    addRef: composerRefs.add,
  });

  const send = () => {
    const message = input.trim();
    if (!message) return;
    setInput("");
    const sendRefs = composerRefs.refs.length > 0 ? composerRefs.refs : undefined;
    composerRefs.clear();
    sendOrQueue(message, sendRefs);
  };

  const retryTurn = (index: number) => {
    const asked = runs.messages[index - 1];
    if (asked?.role === "user") sendOrQueue(asked.content, asked.refs);
  };

  const continueTurn = () => sendOrQueue(t("chat.message.continuePrompt"));

  const retryToolCall = (call: ChatToolCall) =>
    sendOrQueue(t("chat.tool.retryPrompt", { tool: call.label ?? call.name }));

  // Never send queued text into a different conversation.
  const conversationRef = React.useRef(runs.conversationId);
  React.useEffect(() => {
    const previous = conversationRef.current;
    conversationRef.current = runs.conversationId;
    if (previous === undefined || previous === runs.conversationId || queue.length === 0) return;
    setQueue([]);
    for (const item of [...queue].reverse()) restoreDraft(item.text, item.refs);
  });

  // Drain one queued message only after the active turn settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const next = queue[0];
    if (!next || runs.busy || runs.restoring || sendingRef.current) return;
    setQueue((pending) => pending.slice(1));
    if (next.newConversation) runs.newConversation();
    startSend(next.text, next.refs);
  });

  React.useEffect(() => {
    return onChatCommand((command) => {
      switch (command.kind) {
        case "new":
          runs.newConversation();
          return;
        case "open":
          void runs.openConversation(command.conversationId);
          return;
        case "prefill":
          runs.newConversation();
          setInput(command.text);
          textareaRef.current?.focus();
          return;
        case "send":
          setQueue((pending) => [...pending, pendingSend(command.text, { newConversation: true })]);
          return;
        case "answer":
          setQueue((pending) => [...pending, pendingSend(command.text, { refs: command.refs })]);
          return;
        case "add-ref":
          composerRefs.add(command.ref);
          textareaRef.current?.focus();
          return;
      }
    });
  }, [runs.newConversation, runs.openConversation, composerRefs.add, setInput]);

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden",
        isPage && "thread-page",
        centerEmptyConversation && "justify-center pb-10",
      )}
    >
      <div className={cn("relative min-h-0", centerEmptyConversation ? "flex-none" : "flex-1")}>
        <div
          ref={viewportRef}
          onScroll={scroll.onScroll}
          className={cn("overflow-y-auto scroll-stable", !centerEmptyConversation && "h-full")}
        >
          {/* In page mode the history rail is external, so the internal toggle is inert. */}
          {!isPage && historyOpen ? (
            <HistoryList
              activeId={runs.conversationId}
              onPick={(id) => void runs.openConversation(id)}
            />
          ) : runs.restoring ? (
            <LoadingRow />
          ) : runs.messages.length === 0 && queue.length === 0 ? (
            <div
              className={cn(
                "flex justify-center",
                centerEmptyConversation ? "items-center py-8" : "h-full items-start pt-8",
              )}
            >
              {/* The assistant's presence, not a generic "nothing here": the
                avatar sits lit and breathing, waiting to be spoken to. */}
              <div className="flex flex-col items-center gap-3 text-center">
                <AgentAvatar size="lg" active />
                <div className="flex flex-col gap-1.5">
                  <p className="text-base font-semibold tracking-tight">{t("chat.emptyTitle")}</p>
                  <p className="max-w-sm text-pretty text-sm text-muted-foreground">
                    {t("chat.emptyBody")}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <Transcript
              messages={runs.messages}
              accountColors={accountColors}
              queued={queue}
              search={search ? { query: search.query, currentId: currentHitId } : undefined}
              hitRef={hitRef}
              onRetryTurn={retryTurn}
              onRegenerate={retryTurn}
              onContinue={continueTurn}
              onRetryTool={retryToolCall}
              onCancelQueued={(id) => setQueue((pending) => pending.filter((p) => p.id !== id))}
              onEditQueued={(id, text) =>
                setQueue((pending) => pending.map((p) => (p.id === id ? { ...p, text } : p)))
              }
            />
          )}
        </div>
        {quote.pick && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="surface-pop animate-in-up fixed z-50 -translate-x-1/2 rounded-xl"
            style={{ top: quote.pick.top - 40, left: quote.pick.left }}
            onClick={() => {
              const text = quote.pick?.text ?? "";
              quote.clear();
              setInput((current) => {
                const quoted = text
                  .split("\n")
                  .map((line) => `> ${line}`)
                  .join("\n");
                return current ? `${quoted}\n\n${current}` : `${quoted}\n\n`;
              });
              focusComposer();
            }}
          >
            <Quote />
            {t("chat.quote")}
          </Button>
        )}
        {scroll.away && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
            {/* Floats over the transcript once the user has scrolled up to read;
                one press returns to the live end and following resumes. */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={scroll.jumpToEnd}
              className="surface-pop animate-in-up pointer-events-auto rounded-xl"
              aria-label={t("chat.jumpToLatest")}
              title={t("chat.jumpToLatest")}
            >
              <ArrowDown />
            </Button>
          </div>
        )}
      </div>

      {!connected && (
        <Notice tone="warning" className="thread-column text-xs">
          {t("chat.offline")}
        </Notice>
      )}

      <div className="thread-column relative flex flex-col gap-1 rounded-2xl bg-surface-2 p-2">
        <SlashMenu {...slash} />
        <GroundingMenu {...grounding} colors={accountColors} />
        {composerRefs.refs.length > 0 && (
          <div className="px-2 pt-1">
            <RefChips
              refs={composerRefs.refs}
              colors={accountColors}
              onRemove={composerRefs.remove}
            />
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // The command menu owns its keys while it is open.
            if (slash.onKeyDown(e)) {
              e.preventDefault();
              return;
            }
            if (grounding.onKeyDown(e)) {
              e.preventDefault();
              return;
            }
            if (e.key === "Escape" && runs.busy) {
              e.preventDefault();
              void runs.stop();
              return;
            }
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            if (window.matchMedia("(pointer: coarse)").matches) return;
            e.preventDefault();
            send();
          }}
          placeholder={t("chat.placeholder")}
          rows={1}
          className={cn(
            "max-h-40 min-h-12 w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-base leading-relaxed [scrollbar-width:none] [-webkit-scrollbar]:hidden placeholder:text-muted-foreground focus:outline-none md:text-sm",
            !input && "overflow-x-hidden whitespace-nowrap",
          )}
          aria-busy={runs.busy}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-xl"
            onClick={() => {
              grounding.start();
              focusComposer();
            }}
            aria-label={t("chat.refs.add")}
            title={t("chat.refs.add")}
          >
            <Plus />
          </Button>
          <ModelControl conversationId={runs.conversationId} className="shrink-0" />
          <VoiceInput
            className="shrink-0"
            onTranscript={(text) => {
              setInput((current) => (current ? `${current.trimEnd()} ${text}` : text));
              focusComposer();
            }}
          />
          <div className="min-w-2 flex-1" />
          {runs.busy && !input.trim() ? (
            <Button
              onClick={() => void runs.stop()}
              size="icon-sm"
              variant="secondary"
              className="shrink-0 rounded-xl"
              aria-label={t("chat.stop")}
              title={t("chat.stop")}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!input.trim()}
              size="icon-sm"
              className="shrink-0 rounded-xl"
              aria-label={runs.busy ? t("chat.queue.send") : t("chat.send")}
              title={runs.busy ? t("chat.queue.send") : undefined}
            >
              <Send className="-translate-x-px translate-y-px" />
            </Button>
          )}
        </div>
      </div>

      <VersionLine />
    </div>
  );
}

function VersionLine() {
  const version = useAppVersion();
  if (!version) return null;

  return (
    <p className="thread-column shrink-0 text-center font-mono text-2xs tabular-nums text-muted-foreground">
      v{version}
    </p>
  );
}
