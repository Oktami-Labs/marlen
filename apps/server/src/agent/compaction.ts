import {
  type AgentMessage,
  estimateContextTokens,
  estimateTokens,
  serializeConversation,
} from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { LlmContextUsage } from "@marlen/shared";
import { moduleLogger, type TurnLogger } from "../core/logger.js";
import { loadHistory } from "./history.js";
import { resolveActiveModel } from "./llm/registry.js";
import { runOneShot } from "./oneShot.js";
import { buildSystemPrompt } from "./prompt.js";
import { prompts } from "./prompts.js";

const defaultLog = moduleLogger("compaction");

/**
 * Keeps a long-running chat session inside its model's context window: pi's
 * Agent has no built-in compaction, so a conversation left to grow overflows
 * the provider's context and the turn fails outright.
 */

const COMPACT_TRIGGER_FRACTION = 0.8;

export const KEEP_RECENT_TOKENS = 20_000;

/** Prefixes shorter than this aren't worth the summarizer round trip. */
const MIN_PREFIX_MESSAGES = 4;

const MAX_SERIALIZED_CHARS = 120_000;

/**
 * Per-message ceiling for the kept tail. findCutIndex works between messages,
 * so it cannot cut into one, and a single message larger than the window would
 * otherwise be kept verbatim by every pass — compaction reporting success while
 * shrinking nothing, and the conversation failing forever. Matches the tool
 * ceiling (toolkit.ts TOOL_TEXT_MAX_CHARS): new results arrive already bounded,
 * so this is what brings a transcript recorded before that cap back inside it.
 */
const KEEP_MESSAGE_MAX_CHARS = 40_000;

const DROPPED_NOTE =
  "[Note: earlier content in this range was dropped to fit the summarizer's input limit.]";

const TRUNCATED_NOTE =
  "\n\n[This content was truncated here to keep the conversation inside the model's context window. " +
  "Run the tool again for a narrower slice if you still need the rest.]";

const SUMMARY_PREFIX =
  "[Summary of the earlier conversation — older turns were compacted to fit the context window:]";

/**
 * Context cost of one conversation state. The provider's own input count for
 * the last assistant turn covers the system prompt and every tool definition —
 * the two parts a character estimate cannot see, and on an install with several
 * connected accounts the larger share of the request. Anchor on it wherever the
 * transcript carries one (pi records usage per assistant message) and fall back
 * to characters plus the prompt for a transcript rebuilt from the message log,
 * which records no usage (history.ts).
 */
function estimateStateTokens(systemPrompt: string, messages: AgentMessage[]): number {
  const { tokens, usageTokens } = estimateContextTokens(messages);
  return usageTokens > 0 ? tokens : tokens + Math.ceil(systemPrompt.length / 4);
}

function clampText(text: string): string {
  return text.length <= KEEP_MESSAGE_MAX_CHARS
    ? text
    : text.slice(0, KEEP_MESSAGE_MAX_CHARS) + TRUNCATED_NOTE;
}

/**
 * The same message with its text bounded to KEEP_MESSAGE_MAX_CHARS, or the
 * message itself when it already fits. Returned by identity when nothing
 * changed, which is how the caller tells whether a forced pass found anything
 * to shrink. Content is a string or a block list across pi's message union, so
 * both shapes are handled structurally; each branch puts back the shape it took
 * out, which is what makes the widening casts sound.
 */
function clampMessage(message: AgentMessage): AgentMessage {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    const clamped = clampText(content);
    return clamped === content ? message : ({ ...message, content: clamped } as AgentMessage);
  }
  if (!Array.isArray(content)) return message;
  let clampedAny = false;
  const blocks = content.map((block: unknown) => {
    const b = block as { type?: unknown; text?: unknown };
    if (b.type !== "text" || typeof b.text !== "string") return block;
    const clamped = clampText(b.text);
    if (clamped === b.text) return block;
    clampedAny = true;
    return { ...b, text: clamped };
  });
  return clampedAny ? ({ ...message, content: blocks } as AgentMessage) : message;
}

/**
 * Context fullness for one conversation, by the same estimate the compaction
 * trigger uses. Null when no model is configured or it reports no window.
 */
export async function estimateContextUsage(
  conversationId: string,
): Promise<LlmContextUsage | null> {
  const model = await resolveActiveModel().catch(() => null);
  if (!model?.contextWindow) return null;
  const [systemPrompt, messages] = await Promise.all([
    buildSystemPrompt(),
    loadHistory(conversationId),
  ]);
  const tokens = estimateStateTokens(systemPrompt, messages);
  return {
    tokens,
    contextWindow: model.contextWindow,
    usedPct: Math.min(100, Math.round((tokens / model.contextWindow) * 100)),
  };
}

/**
 * Index of the first message to keep. Walks backward accumulating estimated
 * tokens until KEEP_RECENT_TOKENS, then steps back over any toolResult
 * messages so the kept slice never opens on a toolResult whose originating
 * assistant tool_use was left in the compacted prefix (most providers reject
 * that shape). Not "walk back to the nearest user message": one tool-heavy
 * turn has no user message near the token cut, so that collapses the cut to
 * ~0 and nothing compacts. Stepping back only over toolResults is bounded by
 * one tool-call batch, so the cut stays near the token index and always makes
 * progress; message 0 is never a toolResult, so the loop terminates. Returns
 * 0 when the whole transcript fits within KEEP_RECENT_TOKENS.
 */
export function findCutIndex(messages: AgentMessage[]): number {
  let tokens = 0;
  let index = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (tokens >= KEEP_RECENT_TOKENS) break;
    const message = messages[i];
    if (!message) break;
    tokens += estimateTokens(message);
    index = i;
  }
  while (index > 0 && messages[index]?.role === "toolResult") index--;
  return index;
}

/**
 * pi's AgentMessage union carries a "custom" role (branch/compaction
 * summaries) this app never produces; serializeConversation only understands
 * the base user/assistant/toolResult union, so filter defensively.
 */
function isCoreMessage(message: AgentMessage): message is Message {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

/**
 * One-shot, tool-less summary of the messages about to be dropped. Returns ""
 * on an empty model result; throws otherwise, which compactedMessages treats
 * as fail-open.
 */
async function summarizePrefix(prefix: AgentMessage[], signal?: AbortSignal): Promise<string> {
  let serialized = serializeConversation(prefix.filter(isCoreMessage));
  if (serialized.length > MAX_SERIALIZED_CHARS) {
    serialized = `${DROPPED_NOTE}\n\n${serialized.slice(serialized.length - MAX_SERIALIZED_CHARS)}`;
  }

  const raw = await runOneShot({ systemPrompt: prompts.compaction, prompt: serialized, signal });
  return raw.trim();
}

export interface CompactOptions {
  /**
   * Compact even under the trigger fraction, for recovery after a provider
   * context-overflow error: the provider has proven the estimate wrong, so the
   * transcript actually shrinks before a retry can succeed.
   */
  force?: boolean;
  signal?: AbortSignal;
}

export interface CompactionState {
  systemPrompt: string;
  model: { contextWindow: number };
  messages: AgentMessage[];
}

/**
 * Compacted replacement for a transcript nearing the model's context window:
 * older turns summarized into one brief, the recent ~KEEP_RECENT_TOKENS kept
 * verbatim. Returns null when nothing needs (or can) be compacted. Never
 * throws: fail-open, any error yields null and the caller keeps its messages.
 */
export async function compactedMessages(
  state: CompactionState,
  log: TurnLogger = defaultLog,
  options: CompactOptions = {},
): Promise<AgentMessage[] | null> {
  try {
    const { systemPrompt, model, messages } = state;
    const estimatedTokens = estimateStateTokens(systemPrompt, messages);
    if (!options.force) {
      if (estimatedTokens <= COMPACT_TRIGGER_FRACTION * model.contextWindow) return null;
    } else {
      // A forced pass only happens after the provider refused the request for
      // size, so this pairs what we believed the request cost with the window we
      // believed it had. An estimate far under the window means the refusal did
      // not come from the transcript at all, and no amount of trimming will
      // clear it — the model's catalogued window is wrong for this account, or
      // the provider rejected the request for another reason and said "context".
      log.warn(
        {
          estimatedTokens,
          contextWindow: model.contextWindow,
          messages: messages.length,
        },
        "provider refused a request for size; compacting before the retry",
      );
    }

    const cutIndex = findCutIndex(messages);
    const prefix = messages.slice(0, cutIndex);
    // The kept tail is bounded per message on the way through, so a result
    // bigger than the window can't ride out every pass untouched.
    const kept = messages.slice(cutIndex).map(clampMessage);
    const clamped = kept.some((message, i) => message !== messages[cutIndex + i]);

    if (prefix.length < MIN_PREFIX_MESSAGES) {
      // Too little history to be worth the summarizer round trip. A forced pass
      // is recovering from a request the provider already refused, so it still
      // reports the one thing it managed to shrink; without this the transcript
      // comes back unchanged and every later turn of the conversation fails the
      // same way, with nothing the user can do but abandon it.
      if (!options.force || !clamped) return null;
      log.info(
        { messages: messages.length },
        "compaction truncated oversized messages in the kept tail",
      );
      return [...prefix, ...kept];
    }

    const summary = await summarizePrefix(prefix, options.signal);
    if (!summary) {
      log.warn(
        { prefixMessages: prefix.length },
        "compaction summary was empty, leaving messages untouched",
      );
      return null;
    }

    const summaryMessage: AgentMessage = {
      role: "user",
      content: `${SUMMARY_PREFIX}\n\n${summary}`,
      timestamp: kept[0]?.timestamp ?? Date.now(),
    };

    const newMessages = [summaryMessage, ...kept];
    log.info(
      { beforeMessages: messages.length, afterMessages: newMessages.length, estimatedTokens },
      "compacted conversation history",
    );
    return newMessages;
  } catch (error) {
    log.warn({ err: error }, "compaction failed, leaving messages untouched");
    return null;
  }
}
