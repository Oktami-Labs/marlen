import {
  type AgentMessage,
  estimateContextTokens,
  estimateTokens,
  serializeConversation,
} from "@earendil-works/pi-agent-core";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { LlmContextUsage } from "@marlen/shared";
import { moduleLogger, type TurnLogger } from "../core/logger.js";
import { loadHistory } from "./history.js";
import { resolveActiveModel } from "./llm/registry.js";
import { runOneShot } from "./oneShot.js";
import { buildSystemPromptParts } from "./prompt.js";
import { prompts } from "./prompts.js";

const defaultLog = moduleLogger("compaction");

const COMPACT_TRIGGER_FRACTION = 0.8;

export const KEEP_RECENT_TOKENS = 20_000;

const MIN_PREFIX_MESSAGES = 4;

const MAX_SERIALIZED_CHARS = 120_000;

/** Prevent one message from surviving every compaction pass unchanged. */
const KEEP_MESSAGE_MAX_CHARS = 40_000;

const TRUNCATED_NOTE =
  "\n\n[This content was truncated here to keep the conversation inside the model's context window. " +
  "Run the tool again for a narrower slice if you still need the rest.]";

const SUMMARY_PREFIX = "[Assistant-maintained memory of the earlier conversation:]";

/** Prefer provider usage; rebuilt histories fall back to a character estimate. */
function estimateStateTokens(systemPrompt: string, messages: AgentMessage[]): number {
  const { tokens, usageTokens } = estimateContextTokens(messages);
  return usageTokens > 0 ? tokens : tokens + Math.ceil(systemPrompt.length / 4);
}

function clampText(text: string): string {
  return text.length <= KEEP_MESSAGE_MAX_CHARS
    ? text
    : text.slice(0, KEEP_MESSAGE_MAX_CHARS) + TRUNCATED_NOTE;
}

/** Preserve message identity when no text was clamped. */
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

function promptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate how the active context window is divided across prompt, tools, and transcript. */
export async function estimateContextUsage(
  conversationId: string,
): Promise<LlmContextUsage | null> {
  const model = await resolveActiveModel().catch(() => null);
  if (!model?.contextWindow) return null;
  const [prompt, messages] = await Promise.all([
    buildSystemPromptParts(),
    loadHistory(conversationId),
  ]);
  const instructions = promptTokens(prompt.instructions);
  const knowledge = promptTokens(prompt.knowledge);
  const skills = promptTokens(prompt.skills);
  const promptTotal = instructions + knowledge + skills;

  const { tokens: messageTokens, usageTokens } = estimateContextTokens(messages);
  const tokens = usageTokens > 0 ? messageTokens : messageTokens + promptTotal;
  const transcript = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
  const conversation = Math.min(transcript, Math.max(0, tokens - promptTotal));

  return {
    tokens,
    contextWindow: model.contextWindow,
    usedPct: Math.min(100, Math.round((tokens / model.contextWindow) * 100)),
    breakdown: {
      instructions,
      knowledge,
      skills,
      tools: Math.max(0, tokens - promptTotal - conversation),
      conversation,
    },
  };
}

/** Keep the recent token budget without opening on an orphaned tool result. */
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

function isCoreMessage(message: AgentMessage): message is Message {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function chunksOf(text: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const hardEnd = Math.min(text.length, offset + MAX_SERIALIZED_CHARS);
    const newline = text.lastIndexOf("\n", hardEnd);
    const end = newline > offset + MAX_SERIALIZED_CHARS / 2 ? newline : hardEnd;
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

async function summarizeSerialized(serialized: string, signal?: AbortSignal): Promise<string> {
  let parts = chunksOf(serialized);
  for (;;) {
    const summaries: string[] = [];
    for (const part of parts) {
      const summary = await runOneShot({
        systemPrompt: prompts.compaction,
        prompt: part,
        signal,
      });
      if (summary.trim()) summaries.push(summary.trim());
    }
    const merged = summaries.join("\n\n");
    if (!merged) return "";
    if (merged.length <= MAX_SERIALIZED_CHARS) return merged;
    // Summarize every partial summary again. If a model expands instead of
    // compressing, fail open rather than silently discarding transcript data.
    if (merged.length >= parts.join("").length) {
      throw new Error("compaction summaries did not reduce the source");
    }
    parts = chunksOf(merged);
  }
}

async function summarizePrefix(
  prefix: AgentMessage[],
  kept: AgentMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const serialized = serializeConversation(prefix.filter(isCoreMessage));
  const recent = serializeConversation(kept.filter(isCoreMessage)).slice(-20_000);
  const taskContext = recent
    ? `The following recent context remains verbatim after this summary. Use it only to decide ` +
      `which older facts and open threads matter:\n\n${recent}\n\nEarlier transcript to summarize:\n\n`
    : "";
  return summarizeSerialized(taskContext + serialized, signal);
}

export interface CompactOptions {
  force?: boolean;
  signal?: AbortSignal;
}

export interface CompactionState {
  systemPrompt: string;
  model: Pick<Model<Api>, "api" | "provider" | "id" | "contextWindow">;
  messages: AgentMessage[];
}

/** Summarize earlier turns, keep the recent tail, and fail open. */
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
    const kept = messages.slice(cutIndex).map(clampMessage);
    const clamped = kept.some((message, i) => message !== messages[cutIndex + i]);

    if (prefix.length < MIN_PREFIX_MESSAGES) {
      if (!options.force || !clamped) return null;
      log.info(
        { messages: messages.length },
        "compaction truncated oversized messages in the kept tail",
      );
      return [...prefix, ...kept];
    }

    const summary = await summarizePrefix(prefix, kept, options.signal);
    if (!summary) {
      log.warn(
        { prefixMessages: prefix.length },
        "compaction summary was empty, leaving messages untouched",
      );
      return null;
    }

    const summaryMessage: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: `${SUMMARY_PREFIX}\n\n${summary}` }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
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
