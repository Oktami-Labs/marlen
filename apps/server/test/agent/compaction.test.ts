import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Compaction's recovery path, against the state that strands a conversation for
 * good: one tool result larger than the model's context window. findCutIndex
 * cuts between messages, so the oversized one lands in the kept tail of every
 * pass — and a pass that returns the transcript unchanged tells run.ts the
 * forced compaction worked, so the retry hits the same refusal and every later
 * turn of that conversation fails the same way.
 */

let compaction: typeof import("../../src/agent/compaction.js");

beforeAll(async () => {
  process.env.DATABASE_PATH = ":memory:";
  // The summarizer is a model round trip; the recovery path under test is the
  // one that must work without it.
  vi.doMock("../../src/agent/oneShot.js", () => ({
    runOneShot: async () => "the earlier turns, summarized",
    streamViaModelRegistry: () => {
      throw new Error("not used");
    },
  }));
  compaction = await import("../../src/agent/compaction.js");
});

const model = { contextWindow: 200_000 };

function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const b = block as { text?: unknown };
      return typeof b.text === "string" ? b.text : "";
    })
    .join("");
}

function chars(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + textOf(message).length, 0);
}

/** A mail search that came back with every matched message in full. */
function oversizedTurn(): AgentMessage[] {
  return [
    { role: "user", content: "what came in this month?", timestamp: 1 },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "gmail-find-email", arguments: {} }],
      stopReason: "toolUse",
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 2,
    } as AgentMessage,
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "gmail-find-email",
      content: [{ type: "text", text: "x".repeat(2_000_000) }],
      isError: false,
      timestamp: 3,
    } as AgentMessage,
  ];
}

describe("forced compaction", () => {
  it("shrinks a transcript whose whole size is one oversized tool result", async () => {
    const messages = oversizedTurn();
    const state = { systemPrompt: "you are Marlen", model, messages };

    const compacted = await compaction.compactedMessages(state, undefined, { force: true });

    expect(compacted).not.toBeNull();
    expect(chars(compacted ?? [])).toBeLessThan(chars(messages));
    // The result is trimmed, not dropped: the model still sees what the call
    // returned, and is told how to get the rest.
    const result = (compacted ?? []).find((m) => m.role === "toolResult");
    expect(textOf(result as AgentMessage)).toContain("truncated");
    expect(textOf(result as AgentMessage)).toContain("x");
  });

  it("reports nothing to do once the transcript is already inside its ceilings", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi", timestamp: 1 },
      { role: "user", content: "still there?", timestamp: 2 },
    ];

    const state = { systemPrompt: "you are Marlen", model, messages };
    expect(await compaction.compactedMessages(state, undefined, { force: true })).toBeNull();
  });
});
