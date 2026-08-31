import type { EmailRef } from "@marlen/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  createInitialRunState,
  type DisplayMessage,
  isIdleStale,
  type RunAction,
  reduceRunEvent,
  toDisplayMessage,
} from "@/features/chat/runState";
import { api, streamChat } from "@/lib/api";
import { subscribeServerEvents } from "@/lib/serverEvents";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/utils";

const LAST_CONVERSATION_KEY = "marlen-last-conversation";

const AWAITING_REPLY: DisplayMessage = {
  id: "awaiting-reply",
  role: "assistant",
  content: "",
  createdAt: "1970-01-01T00:00:00.000Z",
  toolCalls: [],
  cards: [],
  streaming: true,
  thinking: true,
};

export interface UseChatRunsOptions {
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onFocusComposer: () => void;
  pendingFocusAccountId?: string | null;
}

export interface UseChatRunsResult {
  messages: DisplayMessage[];
  busy: boolean;
  restoring: boolean;
  idleStale: boolean;
  conversationId: string | undefined;
  send: (message: string, refs?: EmailRef[]) => Promise<boolean>;
  stop: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  appendMessages: (messages: DisplayMessage[]) => void;
  updateMessage: (id: string, patch: Partial<DisplayMessage>) => void;
  setBusy: (busy: boolean) => void;
}

export function useChatRuns({
  setHistoryOpen,
  onFocusComposer,
  pendingFocusAccountId,
}: UseChatRunsOptions): UseChatRunsResult {
  const { t } = useTranslation();
  const pendingFocusRef = React.useRef(pendingFocusAccountId);
  pendingFocusRef.current = pendingFocusAccountId;
  // Commands in the same tick must see state before React renders again.
  const stateRef = React.useRef(createInitialRunState());
  const [state, setState] = React.useState(stateRef.current);

  const dispatch = React.useCallback((action: RunAction) => {
    const next = reduceRunEvent(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  React.useEffect(() => {
    const savedId = localStorage.getItem(LAST_CONVERSATION_KEY);
    if (!savedId) {
      dispatch({ type: "restore", result: null });
      return;
    }
    let cancelled = false;
    let restored: { conversationId: string; messages: DisplayMessage[] } | null = null;
    api
      .conversationMessages(savedId)
      .then((msgs) => {
        if (msgs.length === 0) return;
        const messages = msgs.map(toDisplayMessage);
        if (isIdleStale(messages, Date.now())) {
          localStorage.removeItem(LAST_CONVERSATION_KEY);
          return;
        }
        restored = { conversationId: savedId, messages };
      })
      .catch((err) => {
        toast.error(err);
      })
      .finally(() => {
        if (!cancelled) dispatch({ type: "restore", result: restored });
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Server turns outlive this client, so reload an unfinished transcript on updates.
  const awaitingReply = state.messages[state.messages.length - 1]?.role === "user";
  const awaitingId = awaitingReply ? state.activeConversationId : undefined;

  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const idleStale = !state.busy && !state.resumed && isIdleStale(state.messages, now);
  React.useEffect(() => {
    if (!awaitingId) return;
    let cancelled = false;
    const refresh = () => {
      void api
        .conversationMessages(awaitingId)
        .then((msgs) => {
          if (cancelled || msgs[msgs.length - 1]?.role !== "assistant") return;
          dispatch({
            type: "open-conversation-loaded",
            conversationId: awaitingId,
            messages: msgs.map(toDisplayMessage),
          });
        })
        .catch(() => {}); // The next topic event retries this transient failure.
    };
    const unsubscribe = subscribeServerEvents(["conversations"], refresh);
    refresh();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [awaitingId, dispatch]);

  const send = React.useCallback(
    async (message: string, refs?: EmailRef[]) => {
      const runId = crypto.randomUUID();
      const sentAt = new Date().toISOString();
      const userMessage: DisplayMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        createdAt: sentAt,
        toolCalls: [],
        cards: [],
        streaming: false,
        refs,
      };
      const assistantMessage: DisplayMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        createdAt: sentAt,
        toolCalls: [],
        cards: [],
        streaming: true,
      };
      const conversationIdAtStart = stateRef.current.activeConversationId;
      // An existing conversation owns its focus.
      const focusAccountId = conversationIdAtStart
        ? undefined
        : (pendingFocusRef.current ?? undefined);
      dispatch({ type: "start-run", runId, userMessage, assistantMessage });

      let accepted = false;
      try {
        await streamChat(
          { conversationId: conversationIdAtStart, message, refs, focusAccountId },
          (event) => {
            if (event.type === "conversation") {
              accepted = true;
              const wasActive = stateRef.current.activeRunId === runId;
              dispatch({ type: "stream", runId, event });
              if (wasActive) localStorage.setItem(LAST_CONVERSATION_KEY, event.conversationId);
              return;
            }
            if (event.type === "error") {
              toast.error(
                event.kind === "rate_limit" ? t("chat.rateLimited.message") : event.message,
              );
            }
            dispatch({ type: "stream", runId, event });
          },
        );
      } catch (err) {
        toast.error(err);
        if (accepted) dispatch({ type: "run-error", runId, message: errorMessage(err) });
      } finally {
        dispatch(
          accepted
            ? { type: "run-settled", runId, endedAt: new Date().toISOString() }
            : { type: "run-rejected", runId },
        );
        requestAnimationFrame(() => onFocusComposer());
      }
      return accepted;
    },
    [dispatch, onFocusComposer, t],
  );

  const openConversation = React.useCallback(
    async (id: string) => {
      dispatch({ type: "open-conversation", conversationId: id });
      localStorage.setItem(LAST_CONVERSATION_KEY, id);
      setHistoryOpen(false);
      if (stateRef.current.messageCache[id]) {
        onFocusComposer();
        return;
      }
      try {
        const msgs = await api.conversationMessages(id);
        if (stateRef.current.activeConversationId !== id) return;
        dispatch({
          type: "open-conversation-loaded",
          conversationId: id,
          messages: msgs.map(toDisplayMessage),
        });
        onFocusComposer();
      } catch (err) {
        toast.error(err);
      }
    },
    [dispatch, setHistoryOpen, onFocusComposer],
  );

  const newConversation = React.useCallback(() => {
    dispatch({ type: "new-conversation" });
    setHistoryOpen(false);
    localStorage.removeItem(LAST_CONVERSATION_KEY);
  }, [dispatch, setHistoryOpen]);

  const appendMessages = React.useCallback(
    (messages: DisplayMessage[]) => dispatch({ type: "append-messages", messages }),
    [dispatch],
  );

  const updateMessage = React.useCallback(
    (id: string, patch: Partial<DisplayMessage>) => dispatch({ type: "update-message", id, patch }),
    [dispatch],
  );

  const setBusy = React.useCallback(
    (busy: boolean) => dispatch({ type: "set-busy", busy }),
    [dispatch],
  );

  const stop = React.useCallback(async () => {
    const conversationId = stateRef.current.activeConversationId;
    if (!conversationId) return;
    try {
      await api.stopChat(conversationId);
    } catch (err) {
      toast.error(err);
    }
  }, []);

  const messages = React.useMemo(
    () => (awaitingReply ? [...state.messages, AWAITING_REPLY] : state.messages),
    [state.messages, awaitingReply],
  );

  return {
    messages,
    busy: state.busy || awaitingReply,
    restoring: state.restoring,
    idleStale,
    conversationId: state.activeConversationId,
    send,
    stop,
    openConversation,
    newConversation,
    appendMessages,
    updateMessage,
    setBusy,
  };
}
