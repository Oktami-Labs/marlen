import type { Agent } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type ImageContent,
  isContextOverflow,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";
import type { AgentCard } from "@marlen/shared";
import { moduleLogger, type TurnLogger } from "../core/logger.js";
import { parseAgentCard } from "./cards.js";

export interface RunHandlers {
  onTextDelta?: (delta: string) => void;
  onThinking?: () => void;
  onToolStart?: (
    toolCallId: string,
    toolName: string,
    toolLabel: string,
    parameters: unknown,
  ) => void;
  onToolUpdate?: (toolCallId: string, toolName: string, detail: string) => void;
  onToolEnd?: (toolCallId: string, toolName: string, isError: boolean, result: unknown) => void;
  onCard?: (toolCallId: string, card: AgentCard) => void;
}

export interface RunOptions {
  handlers?: RunHandlers;
  signal?: AbortSignal;
  images?: ImageContent[];
  log?: TurnLogger;
  compact?: (options?: { force?: boolean }) => Promise<boolean>;
}

const defaultLog = moduleLogger("agent");

const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 2_000;

export class ContextOverflowError extends Error {
  constructor(
    message: string,
    readonly irreducible: boolean,
  ) {
    super(message);
    this.name = "ContextOverflowError";
  }
}

const RATE_LIMIT_PATTERN = /rate.?limit|too many requests|\b429\b/i;

export function isRateLimitFailure(message: string): boolean {
  return RATE_LIMIT_PATTERN.test(message);
}

function streamedVisibleText(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === "text" && block.text.trim() !== "");
}

function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = RETRY_BASE_DELAY_MS * 3 ** (attempt - 1) + Math.random() * 500;
  return new Promise((resolve) => {
    const timer = setTimeout(done, delay);
    function done(): void {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });
}

/** Retry transient failures only before they produce visible output. */
async function retryTransientFailures(
  agent: Agent,
  log: TurnLogger,
  signal?: AbortSignal,
  compact?: RunOptions["compact"],
): Promise<boolean> {
  const irreducible = false;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    const failure = agent.state.errorMessage;
    if (!failure || signal?.aborted) return irreducible;
    const last = agent.state.messages[agent.state.messages.length - 1];
    if (last?.role !== "assistant") return irreducible;
    const errored = last as AssistantMessage;
    if (errored.stopReason !== "error") return irreducible;
    if (streamedVisibleText(errored)) return irreducible;

    const overflow = isContextOverflow(errored, agent.state.model.contextWindow);
    if (!overflow && !isRetryableAssistantError(errored)) return irreducible;

    if (overflow) {
      // Leave irreducible overflow messages intact for diagnosis.
      if (!compact || !(await compact({ force: true }))) return true;
    }

    agent.state.messages = agent.state.messages.slice(0, -1);

    if (!overflow) {
      await backoff(attempt, signal);
      if (signal?.aborted) return irreducible;
    }
    log.warn({ attempt, failure }, "retrying turn after transient provider failure");
    await agent.continue();
  }
  return irreducible;
}

export async function runPrompt(
  session: { agent: Agent },
  prompt: string,
  options: RunOptions = {},
): Promise<string> {
  const { handlers = {}, signal, images = [], log = defaultLog, compact } = options;
  if (signal?.aborted) return "";
  if (images.length > 0 && !session.agent.state.model.input.includes("image")) {
    throw new Error(
      "The selected model cannot read image attachments. Choose a model with image input and send the message again.",
    );
  }

  let text = "";
  const turnStartedAt = Date.now();
  const toolLabels = new Map(session.agent.state.tools.map((t) => [t.name, t.label]));
  const toolStarts = new Map<string, number>();
  let toolCalls = 0;
  let toolErrors = 0;
  let irreducibleOverflow = false;

  const unsubscribe = session.agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const inner = event.assistantMessageEvent;
        if (inner.type === "text_delta") {
          text += inner.delta;
          handlers.onTextDelta?.(inner.delta);
        } else if (inner.type === "thinking_delta") {
          handlers.onThinking?.();
        }
        break;
      }
      case "tool_execution_start": {
        toolStarts.set(event.toolCallId, Date.now());
        handlers.onToolStart?.(
          event.toolCallId,
          event.toolName,
          toolLabels.get(event.toolName) ?? event.toolName,
          event.args,
        );
        break;
      }
      case "tool_execution_update": {
        // pi exposes partial tool results as untyped provider data.
        const partial = event.partialResult as { content?: unknown; details?: unknown } | undefined;
        const blocks = Array.isArray(partial?.content) ? partial.content : [];
        const first = blocks[0] as { type?: string; text?: unknown } | undefined;
        if (first?.type === "text" && typeof first.text === "string" && first.text) {
          handlers.onToolUpdate?.(event.toolCallId, event.toolName, first.text);
        }
        const card = parseAgentCard(partial?.details);
        if (card) handlers.onCard?.(event.toolCallId, card);
        break;
      }
      case "tool_execution_end": {
        const { toolName, toolCallId, isError } = event;
        toolCalls += 1;
        if (isError) toolErrors += 1;

        const startedAt = toolStarts.get(toolCallId);
        toolStarts.delete(toolCallId);

        // Never log tool arguments or results because they may contain mail.
        const fields = {
          tool: toolName,
          ms: startedAt === undefined ? undefined : Date.now() - startedAt,
        };
        if (isError) log.warn(fields, "tool call failed");
        else log.info(fields, "tool call");

        const result = event.result as { details?: unknown } | undefined;
        const card = parseAgentCard(result?.details);
        if (card) handlers.onCard?.(toolCallId, card);
        handlers.onToolEnd?.(toolCallId, toolName, isError, event.result);
        break;
      }
    }
  });

  const onAbort = () => session.agent.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    await compact?.();
    await session.agent.prompt(prompt, images);
    irreducibleOverflow = await retryTransientFailures(session.agent, log, signal, compact);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (typeof unsubscribe === "function") unsubscribe();
  }

  const durationMs = Date.now() - turnStartedAt;

  // pi records provider failures on state instead of throwing them.
  const failure = session.agent.state.errorMessage;
  if (failure) {
    log.warn(
      { durationMs, toolCalls, toolErrors, failure, irreducibleOverflow },
      "agent turn failed",
    );
    if (irreducibleOverflow) throw new ContextOverflowError(failure, true);
    throw new Error(failure);
  }

  log.info({ durationMs, toolCalls, toolErrors }, "agent turn finished");
  return text.trim();
}
