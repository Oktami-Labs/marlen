import { randomUUID } from "node:crypto";
import type { AgentCard, ChatToolCall, LiveChatTurn } from "@marlen/shared";
import { emitServerEvent } from "../core/events.js";

/**
 * A turn survives its initiating HTTP stream. This bounded process-local view
 * lets a reloaded or newly opened client attach to the text, tools and cards
 * already in flight; the final assistant message still persists in SQLite.
 */
const liveTurns = new Map<string, LiveChatTurn>();

function publish(): void {
  emitServerEvent("chat");
}

export interface LiveTurnWriter {
  text(delta: string): void;
  thinking(): void;
  toolStart(call: ChatToolCall): void;
  toolUpdate(toolCallId: string, detail: string): void;
  toolEnd(toolCallId: string, isError: boolean, result: unknown): void;
  card(toolCallId: string, card: AgentCard): void;
  finish(): void;
}

export function startLiveTurn(conversationId: string): LiveTurnWriter {
  const turn: LiveChatTurn = {
    id: randomUUID(),
    conversationId,
    content: "",
    createdAt: new Date().toISOString(),
    toolCalls: [],
    cards: [],
    thinking: false,
  };
  liveTurns.set(conversationId, turn);
  publish();

  return {
    text(delta) {
      turn.content += delta;
      turn.thinking = false;
      publish();
    },
    thinking() {
      turn.thinking = true;
      publish();
    },
    toolStart(call) {
      turn.thinking = false;
      turn.toolCalls.push(call);
      publish();
    },
    toolUpdate(toolCallId, detail) {
      const call = turn.toolCalls.find((candidate) => candidate.id === toolCallId);
      if (call) call.detail = detail;
      publish();
    },
    toolEnd(toolCallId, isError, result) {
      const call = turn.toolCalls.find((candidate) => candidate.id === toolCallId);
      if (call) {
        call.done = true;
        call.isError = isError;
        call.result = result;
      }
      publish();
    },
    card(toolCallId, card) {
      const index = turn.cards.findIndex((entry) => entry.toolCallId === toolCallId);
      const entry = { toolCallId, card };
      if (index >= 0) turn.cards[index] = entry;
      else turn.cards.push(entry);
      publish();
    },
    finish() {
      if (liveTurns.get(conversationId) !== turn) return;
      liveTurns.delete(conversationId);
      publish();
    },
  };
}

export function liveTurn(conversationId: string): LiveChatTurn | null {
  const turn = liveTurns.get(conversationId);
  return turn
    ? {
        ...turn,
        toolCalls: turn.toolCalls.map((call) => ({ ...call })),
        cards: [...turn.cards],
      }
    : null;
}
