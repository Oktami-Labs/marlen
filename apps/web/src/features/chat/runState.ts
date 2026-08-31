import type {
  AgentCard,
  ChatMessage,
  ChatStreamEvent,
  ChatToolCall,
  EmailRef,
} from "@marlen/shared";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  toolCalls: ChatToolCall[];
  cards: { toolCallId: string; card: AgentCard }[];
  streaming: boolean;
  thinking?: boolean;
  stopped?: boolean;
  error?: string;
  errorKind?: "rate_limit";
  systemPrompt?: string;
  refs?: EmailRef[];
}

export interface RunEntry {
  conversationId: string | undefined;
  messages: DisplayMessage[];
}

export interface RunState {
  activeConversationId: string | undefined;
  messages: DisplayMessage[];
  busy: boolean;
  restoring: boolean;
  resumed: boolean;
  activeRunId: string | undefined;
  runs: Record<string, RunEntry>;
  runIdByConversation: Record<string, string>;
  messageCache: Record<string, DisplayMessage[]>;
}

export type RunAction =
  | { type: "restore"; result: { conversationId: string; messages: DisplayMessage[] } | null }
  | {
      type: "start-run";
      runId: string;
      userMessage: DisplayMessage;
      assistantMessage: DisplayMessage;
    }
  | { type: "stream"; runId: string; event: ChatStreamEvent }
  | { type: "run-error"; runId: string; message: string }
  | { type: "run-rejected"; runId: string }
  | { type: "run-settled"; runId: string; endedAt: string }
  | { type: "open-conversation"; conversationId: string }
  | { type: "open-conversation-loaded"; conversationId: string; messages: DisplayMessage[] }
  | { type: "new-conversation" }
  | { type: "append-messages"; messages: DisplayMessage[] }
  | { type: "update-message"; id: string; patch: Partial<DisplayMessage> }
  | { type: "set-busy"; busy: boolean };

export const IDLE_RESET_MS = 60 * 60 * 1000;

/** Active turns never expire. */
export function isIdleStale(messages: DisplayMessage[], now: number): boolean {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant" || last.streaming) return false;
  return now - Date.parse(last.createdAt) > IDLE_RESET_MS;
}

export function createInitialRunState(): RunState {
  return {
    activeConversationId: undefined,
    messages: [],
    busy: false,
    restoring: true,
    resumed: false,
    activeRunId: undefined,
    runs: {},
    runIdByConversation: {},
    messageCache: {},
  };
}

export function toDisplayMessage(m: ChatMessage): DisplayMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    toolCalls: m.toolCalls ?? [],
    cards: m.cards ?? [],
    streaming: false,
    error: m.error,
    refs: m.refs,
  };
}

function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/** Update a run, its cache, and the visible transcript when they refer to the same run. */
function applyToRunMessages(
  state: RunState,
  runId: string,
  update: (messages: DisplayMessage[]) => DisplayMessage[],
): RunState {
  const run = state.runs[runId];
  if (!run) return state;

  const nextMessages = update(run.messages);
  const nextRun: RunEntry = { ...run, messages: nextMessages };
  const runs = { ...state.runs, [runId]: nextRun };
  const messageCache =
    run.conversationId !== undefined
      ? { ...state.messageCache, [run.conversationId]: nextMessages }
      : state.messageCache;
  const isVisible =
    state.activeRunId === runId ||
    (run.conversationId !== undefined && state.activeConversationId === run.conversationId);

  return {
    ...state,
    runs,
    messageCache,
    messages: isVisible ? nextMessages : state.messages,
  };
}

function settleRun(state: RunState, runId: string): RunState {
  const run = state.runs[runId];
  if (!run) return state;
  const runs = withoutKey(state.runs, runId);
  const runIdByConversation =
    run.conversationId !== undefined && state.runIdByConversation[run.conversationId] === runId
      ? withoutKey(state.runIdByConversation, run.conversationId)
      : state.runIdByConversation;
  const wasActive = state.activeRunId === runId;
  return {
    ...state,
    runs,
    runIdByConversation,
    activeRunId: wasActive ? undefined : state.activeRunId,
    busy: wasActive ? false : state.busy,
  };
}

function applyToRun(
  state: RunState,
  runId: string,
  updater: (message: DisplayMessage) => DisplayMessage,
): RunState {
  return applyToRunMessages(state, runId, (messages) => {
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || !last.streaming) return messages;
    return [...messages.slice(0, -1), updater(last)];
  });
}

function reduceStreamEvent(
  state: RunState,
  runId: string,
  run: RunEntry,
  event: ChatStreamEvent,
): RunState {
  switch (event.type) {
    case "conversation": {
      const updatedRun: RunEntry = { ...run, conversationId: event.conversationId };
      const runs = { ...state.runs, [runId]: updatedRun };
      const runIdByConversation = { ...state.runIdByConversation, [event.conversationId]: runId };
      const messageCache = { ...state.messageCache, [event.conversationId]: run.messages };
      const wasActive = state.activeRunId === runId;
      return {
        ...state,
        runs,
        runIdByConversation,
        messageCache,
        activeConversationId: wasActive ? event.conversationId : state.activeConversationId,
      };
    }
    case "thinking":
      return applyToRun(state, runId, (m) => ({ ...m, thinking: true }));
    case "text_delta":
      return applyToRun(state, runId, (m) => ({
        ...m,
        content: m.content + event.delta,
        thinking: false,
      }));
    case "tool_start":
      return applyToRun(state, runId, (m) => ({
        ...m,
        thinking: false,
        toolCalls: [
          ...m.toolCalls,
          {
            id: event.toolCallId,
            name: event.toolName,
            label: event.toolLabel,
            isError: false,
            done: false,
            parameters: event.parameters,
            contentOffset: event.contentOffset,
          },
        ],
      }));
    case "tool_update":
      return applyToRun(state, runId, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((call) =>
          call.id === event.toolCallId ? { ...call, detail: event.detail } : call,
        ),
      }));
    case "tool_end":
      return applyToRun(state, runId, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((call) =>
          call.id === event.toolCallId
            ? { ...call, done: true, isError: event.isError, result: event.result }
            : call,
        ),
      }));
    case "card":
      return applyToRun(state, runId, (m) => ({
        ...m,
        thinking: false,
        cards: [
          ...m.cards.filter((c) => c.toolCallId !== event.toolCallId),
          { toolCallId: event.toolCallId, card: event.card },
        ],
      }));
    case "done":
    case "stopped":
      return applyToRun(state, runId, (m) => ({
        ...m,
        content: event.text || m.content,
        streaming: false,
        thinking: false,
        stopped: event.type === "stopped",
      }));
    case "error":
      return applyToRun(state, runId, (m) => ({
        ...m,
        error: event.message,
        errorKind: event.kind,
        streaming: false,
        thinking: false,
      }));
  }
}

export function reduceRunEvent(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "restore": {
      if (!action.result) return { ...state, restoring: false };
      const { conversationId, messages } = action.result;
      return {
        ...state,
        activeConversationId: conversationId,
        messages,
        messageCache: { ...state.messageCache, [conversationId]: messages },
        restoring: false,
        resumed: false,
      };
    }
    case "start-run": {
      const { runId, userMessage, assistantMessage } = action;
      const conversationId = state.activeConversationId;
      const nextMessages = [...state.messages, userMessage, assistantMessage];
      const run: RunEntry = { conversationId, messages: nextMessages };
      const runs = { ...state.runs, [runId]: run };
      const runIdByConversation =
        conversationId !== undefined
          ? { ...state.runIdByConversation, [conversationId]: runId }
          : state.runIdByConversation;
      const messageCache =
        conversationId !== undefined
          ? { ...state.messageCache, [conversationId]: nextMessages }
          : state.messageCache;
      return {
        ...state,
        runs,
        runIdByConversation,
        messageCache,
        activeRunId: runId,
        messages: nextMessages,
        busy: true,
        resumed: false,
      };
    }
    case "stream": {
      const run = state.runs[action.runId];
      if (!run) return state;
      return reduceStreamEvent(state, action.runId, run, action.event);
    }
    case "run-error":
      return applyToRun(state, action.runId, (m) => ({
        ...m,
        error: action.message,
        streaming: false,
        thinking: false,
      }));
    // No stream event arrived, so the optimistic pair is still the tail.
    case "run-rejected":
      return settleRun(
        applyToRunMessages(state, action.runId, (messages) => messages.slice(0, -2)),
        action.runId,
      );
    // Idle time starts when the reply was recorded.
    case "run-settled":
      return settleRun(
        applyToRunMessages(state, action.runId, (messages) => {
          const last = messages[messages.length - 1];
          if (last?.role !== "assistant") return messages;
          return [...messages.slice(0, -1), { ...last, createdAt: action.endedAt }];
        }),
        action.runId,
      );
    case "open-conversation": {
      const { conversationId } = action;
      const liveRunId = state.runIdByConversation[conversationId];
      const cached = state.messageCache[conversationId];
      return {
        ...state,
        activeConversationId: conversationId,
        activeRunId: liveRunId,
        busy: Boolean(liveRunId),
        messages: cached ?? state.messages,
        resumed: true,
      };
    }
    case "open-conversation-loaded": {
      if (state.activeConversationId !== action.conversationId) return state;
      return {
        ...state,
        messages: action.messages,
        messageCache: { ...state.messageCache, [action.conversationId]: action.messages },
      };
    }
    case "new-conversation":
      return {
        ...state,
        activeConversationId: undefined,
        activeRunId: undefined,
        busy: false,
        messages: [],
        resumed: false,
      };
    case "append-messages":
      return { ...state, messages: [...state.messages, ...action.messages] };
    case "update-message":
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      };
    case "set-busy":
      return { ...state, busy: action.busy };
  }
}
