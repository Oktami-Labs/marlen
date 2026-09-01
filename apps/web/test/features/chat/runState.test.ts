import { describe, expect, it } from "vitest";
import {
  createInitialRunState,
  type DisplayMessage,
  reduceRunEvent,
} from "../../../src/features/chat/runState";

const message = (id: string): DisplayMessage => ({
  id: `message-${id}`,
  role: "user",
  content: id,
  createdAt: "2026-09-01T10:00:00.000Z",
  toolCalls: [],
  cards: [],
  streaming: false,
});

describe("chat run state", () => {
  it("bounds restored transcripts and clears the prior chat while an uncached one loads", () => {
    let state = createInitialRunState();
    for (let index = 0; index < 21; index += 1) {
      const conversationId = `conversation-${index}`;
      state = reduceRunEvent(state, { type: "open-conversation", conversationId });
      state = reduceRunEvent(state, {
        type: "open-conversation-loaded",
        conversationId,
        messages: [message(conversationId)],
      });
    }

    expect(Object.keys(state.messageCache)).toHaveLength(20);
    expect(state.messageCache["conversation-0"]).toBeUndefined();
    expect(state.messageCache["conversation-20"]).toHaveLength(1);

    state = reduceRunEvent(state, {
      type: "open-conversation",
      conversationId: "not-cached",
    });
    expect(state.messages).toEqual([]);
  });
});
