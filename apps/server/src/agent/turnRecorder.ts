import { randomUUID } from "node:crypto";
import type { AgentCard, ChatToolCall, EmailRef, MessageCard } from "@marlen/shared";
import { emitServerEvent } from "../core/events.js";
import { moduleLogger, type TurnLogger } from "../core/logger.js";
import { errorMessage } from "../core/utils/util.js";
import { type EnsureConversationInput, ensureConversation } from "../db/conversationStore.js";
import { linkDraftProposalConversation } from "../db/draftProposalStore.js";
import { linkDraftConversation } from "../db/draftStore.js";
import { db, schema, sqlite } from "../db/index.js";
import { serializeRefs } from "./emailRefs.js";
import { applyConversationFocus, focusFromCard, focusFromRefs } from "./focus.js";
import { buildTurnPrompt } from "./prompt.js";
import { ContextOverflowError, isRateLimitFailure, type RunHandlers } from "./run.js";
import { type AgentSession, createEphemeralSession, getOrCreateSession } from "./sessionCache.js";

const log = moduleLogger("turnRecorder");

/** Preserve numeric ranges and bullets while removing prose dashes. */
function stripDashes(text: string): string {
  return text
    .replace(/(\d)[—–―](\d)/g, "$1-$2")
    .replace(/^[ \t]*[—–―][ \t]*/gm, "- ")
    .replace(/[ \t]*[—–―][ \t]*/g, ", ");
}

function failureRow(error: unknown, failure: string): string {
  if (isRateLimitFailure(failure)) {
    return (
      "This turn was stopped by the AI provider's rate limit. Wait a moment and send your " +
      "message again, or switch providers in Settings."
    );
  }
  // A new chat cannot fix context used entirely by instructions and tools.
  if (error instanceof ContextOverflowError && error.irreducible) {
    return (
      "This turn was refused by the AI provider: this model's context window is too small for " +
      "Marlen's own instructions and connected-account tools, before any conversation. A new " +
      "chat will fail the same way. Pick a model with a larger context window in Settings, " +
      "disconnect accounts you don't need, or tidy up a large memory under Knowledge."
    );
  }
  return `This turn failed: ${failure}`;
}

function collectTurnActivity(conversationId: string): {
  cards: MessageCard[];
  toolCalls: ChatToolCall[];
  text: () => string;
  wrap: (caller?: RunHandlers) => RunHandlers;
} {
  const cards: MessageCard[] = [];
  const toolCalls: ChatToolCall[] = [];
  let streamed = "";

  const onCard = (toolCallId: string, card: AgentCard) => {
    const existing = cards.findIndex((c) => c.toolCallId === toolCallId);
    if (existing >= 0) cards[existing] = { toolCallId, card };
    else cards.push({ toolCallId, card });

    if (card.kind === "email_draft" && card.draft.draftId) {
      // Re-emit after the conversation link exists.
      linkDraftConversation(card.account?.accountId ?? "", card.draft.draftId, conversationId)
        .then(() => emitServerEvent("drafts"))
        .catch((err: unknown) => {
          log.warn({ err, conversationId }, "linking the turn's draft to its conversation failed");
        });
    } else if (card.kind === "email_draft" && card.draft.proposalId) {
      linkDraftProposalConversation(card.draft.proposalId, conversationId).catch((err: unknown) => {
        log.warn({ err, conversationId }, "linking the turn's proposal to its chat failed");
      });
    }

    const focus = focusFromCard(card);
    if (focus) {
      applyConversationFocus(conversationId, focus).catch((err: unknown) => {
        log.warn({ err, conversationId }, "applying the card's conversation focus failed");
      });
    }
  };

  const wrap = (caller: RunHandlers = {}): RunHandlers => ({
    ...caller,
    onTextDelta: (delta) => {
      const clean = stripDashes(delta);
      streamed += clean;
      caller.onTextDelta?.(clean);
    },
    onToolStart: (toolCallId, toolName, toolLabel, parameters) => {
      const call: ChatToolCall = {
        id: toolCallId,
        name: toolName,
        label: toolLabel,
        isError: false,
        done: false,
        parameters,
        contentOffset: streamed.length,
      };
      const existing = toolCalls.findIndex((c) => c.id === toolCallId);
      if (existing >= 0) toolCalls[existing] = call;
      else toolCalls.push(call);
      caller.onToolStart?.(toolCallId, toolName, toolLabel, parameters);
    },
    onToolEnd: (toolCallId, toolName, isError, result) => {
      const call = toolCalls.find((c) => c.id === toolCallId);
      if (call) {
        call.done = true;
        call.isError = isError;
        call.result = result;
      }
      caller.onToolEnd?.(toolCallId, toolName, isError, result);
    },
    onCard: (toolCallId, card) => {
      onCard(toolCallId, card);
      caller.onCard?.(toolCallId, card);
    },
  });

  return { cards, toolCalls, text: () => streamed, wrap };
}

export function serializeTurnCards(cards: MessageCard[]): string | null {
  return cards.length > 0 ? JSON.stringify(cards) : null;
}

export class TurnInFlightError extends Error {
  constructor(conversationId: string) {
    super(`a turn is already in flight for conversation ${conversationId}`);
    this.name = "TurnInFlightError";
  }
}

export class TurnStoppedError extends Error {
  constructor(readonly text: string) {
    super("turn stopped by the user");
    this.name = "TurnStoppedError";
  }
}

export interface TurnSessions {
  pooled(conversationId: string): Promise<AgentSession>;
  ephemeral(conversationId: string): Promise<AgentSession>;
}

const realSessions: TurnSessions = {
  pooled: getOrCreateSession,
  ephemeral: createEphemeralSession,
};

let sessions: TurnSessions = realSessions;

export function _setSessionsForTest(override: TurnSessions | null): void {
  sessions = override ?? realSessions;
}

interface TurnRunOptions {
  prompt: string;
  refs?: EmailRef[];
  session: "pooled" | "ephemeral";
  conversation: EnsureConversationInput;
  focusAccountId?: string | null;
  handlers?: RunHandlers;
  signal?: AbortSignal;
  log: TurnLogger;
}

export interface Turn {
  run(opts: TurnRunOptions): Promise<{ text: string; cards: MessageCard[] }>;
}

const inFlight = new Set<string>();

// User stops stay separate from caller cancellation signals.
const stoppers = new Map<string, AbortController>();

export function stopTurn(conversationId: string): boolean {
  const stopper = stoppers.get(conversationId);
  if (!stopper) return false;
  stopper.abort();
  return true;
}

export function isTurnInFlight(conversationId: string): boolean {
  return inFlight.has(conversationId);
}

function endTurn(conversationId: string): void {
  inFlight.delete(conversationId);
  stoppers.delete(conversationId);
  emitServerEvent("drafts");
  emitServerEvent("outbound");
}

/** Acquire the guard before Fastify's response is hijacked. */
export function beginTurn(conversationId: string): Turn {
  if (inFlight.has(conversationId)) throw new TurnInFlightError(conversationId);
  inFlight.add(conversationId);
  const stopper = new AbortController();
  stoppers.set(conversationId, stopper);

  let used = false;

  return {
    async run(opts: TurnRunOptions): Promise<{ text: string; cards: MessageCard[] }> {
      if (used) {
        throw new Error(`turn.run() already called for conversation ${conversationId}`);
      }
      used = true;

      let session: AgentSession;
      try {
        await ensureConversation(conversationId, opts.conversation);
        session =
          opts.session === "pooled"
            ? await sessions.pooled(conversationId)
            : await sessions.ephemeral(conversationId);
      } catch (error) {
        endTurn(conversationId);
        throw error;
      }

      try {
        // Build pooled history before inserting the current prompt to avoid replaying it twice.
        await db.insert(schema.messages).values({
          id: randomUUID(),
          conversationId,
          role: "user",
          content: opts.prompt,
          refs: serializeRefs(opts.refs),
          createdAt: new Date().toISOString(),
        });

        if (opts.focusAccountId) {
          await applyConversationFocus(conversationId, {
            accountId: opts.focusAccountId,
          }).catch((err: unknown) => {
            opts.log.warn({ err }, "applying the pre-selected account focus failed");
          });
        }

        const refFocus = focusFromRefs(opts.refs);
        if (refFocus) {
          await applyConversationFocus(conversationId, refFocus).catch((err: unknown) => {
            opts.log.warn({ err }, "applying the @-mention's conversation focus failed");
          });
        }

        const collector = collectTurnActivity(conversationId);
        const handlers = collector.wrap(opts.handlers);

        const recordOutcome = async (content: string): Promise<void> => {
          await db.insert(schema.messages).values({
            id: randomUUID(),
            conversationId,
            role: "assistant",
            content: stripDashes(content),
            cards: serializeTurnCards(collector.cards),
            toolCalls: collector.toolCalls.length > 0 ? JSON.stringify(collector.toolCalls) : null,
            createdAt: new Date().toISOString(),
          });
          emitServerEvent("conversations");
        };

        const signal = opts.signal
          ? AbortSignal.any([opts.signal, stopper.signal])
          : stopper.signal;

        const stoppedOutcome = (): string => {
          const partial = collector.text().trim();
          return partial
            ? `${partial}\n\n_Stopped._`
            : "This reply was stopped before it produced anything.";
        };

        let text: string;
        try {
          text = stripDashes(
            await session.runTurn(
              await buildTurnPrompt(opts.prompt, opts.refs, conversationId),
              handlers,
              signal,
              opts.log,
            ),
          );
        } catch (error) {
          if (stopper.signal.aborted) {
            const stopped = stoppedOutcome();
            await recordOutcome(stopped);
            throw new TurnStoppedError(stopped);
          }
          if (opts.signal?.aborted) {
            await recordOutcome("This reply was cancelled before it finished.");
            throw new Error("turn cancelled: the signal was aborted before the turn finished");
          }
          const failure = errorMessage(error);
          await recordOutcome(failureRow(error, failure));
          throw error;
        }

        // Cancellation wins if it races with a successful return.
        if (stopper.signal.aborted) {
          const stopped = stoppedOutcome();
          await recordOutcome(stopped);
          throw new TurnStoppedError(stopped);
        }
        if (opts.signal?.aborted) {
          await recordOutcome("This reply was cancelled before it finished.");
          throw new Error("turn cancelled: the signal was aborted as the turn resolved");
        }

        await recordOutcome(text);
        return { text, cards: collector.cards };
      } finally {
        if (opts.session === "ephemeral") {
          await session.toolset.close().catch((error: unknown) => {
            opts.log.warn({ err: error }, "closing the run's MCP sessions failed");
          });
        }
        endTurn(conversationId);
      }
    },
  };
}

const RECOVERY_MARKER =
  "This turn was interrupted by a server restart before a reply was produced. Send your message again to continue.";

/** Close chat turns interrupted between the user and assistant inserts. */
export async function recoverInterruptedTurns(): Promise<void> {
  // rowid breaks ties when two rows share a timestamp.
  const stranded = sqlite
    .prepare(
      `SELECT m.conversation_id AS conversationId
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id AND c.type = 'chat'
        WHERE m.role = 'user'
          AND NOT EXISTS (
            SELECT 1 FROM messages n
             WHERE n.conversation_id = m.conversation_id
               AND n.role IN ('user', 'assistant')
               AND (n.created_at > m.created_at
                    OR (n.created_at = m.created_at AND n.rowid > m.rowid))
          )`,
    )
    .all() as { conversationId: string }[];

  if (stranded.length === 0) return;

  const now = new Date().toISOString();
  const rows = stranded.map(({ conversationId }) => ({
    id: randomUUID(),
    conversationId,
    role: "assistant" as const,
    content: RECOVERY_MARKER,
    createdAt: now,
  }));
  await db.insert(schema.messages).values(rows);

  log.warn({ count: rows.length }, "closed out chat turns interrupted by a restart");
  emitServerEvent("conversations");
}
