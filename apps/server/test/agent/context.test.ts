import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmContextResponse } from "@marlen/shared";
import { afterAll, beforeAll, expect, it } from "vitest";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
let db: typeof import("../../src/db/index.js").db;
let schema: typeof import("../../src/db/index.js").schema;

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-context-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  ({ db, schema } = await import("../../src/db/index.js"));
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  await app?.close();
});

async function seedConversation(id: string, contents: string[]) {
  const now = new Date().toISOString();
  await db.insert(schema.conversations).values({ id, title: id, type: "chat", createdAt: now });
  await db.insert(schema.messages).values(
    contents.map((content, i) => ({
      id: `${id}-${i}`,
      conversationId: id,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content,
      createdAt: new Date(Date.parse(now) + i).toISOString(),
    })),
  );
}

async function contextOf(conversationId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/llm/context?conversation=${conversationId}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json<LlmContextResponse>().context;
}

it("splits the used context into parts that add up to the total it reports", async () => {
  await seedConversation("ctx-small", ["Wie viele Mails kamen heute?", "Drei."]);
  const context = await contextOf("ctx-small");
  if (!context) throw new Error("no model configured for the context readout");

  const { instructions, knowledge, skills, tools, conversation } = context.breakdown;
  expect(instructions + knowledge + skills + tools + conversation).toBe(context.tokens);
  // The prompt rides on every turn, so it is never a free part of the window.
  expect(instructions).toBeGreaterThan(0);
  expect(context.tokens).toBeLessThanOrEqual(context.contextWindow);
  expect(context.usedPct).toBe(
    Math.min(100, Math.round((context.tokens / context.contextWindow) * 100)),
  );
});

it("charges a longer transcript to the conversation, not to the prompt", async () => {
  await seedConversation("ctx-large", ["x".repeat(40_000), "y".repeat(40_000)]);
  const small = await contextOf("ctx-small");
  const large = await contextOf("ctx-large");
  if (!small || !large) throw new Error("no model configured for the context readout");

  expect(large.breakdown.conversation).toBeGreaterThan(small.breakdown.conversation);
  expect(large.breakdown.instructions).toBe(small.breakdown.instructions);
  expect(large.tokens).toBeGreaterThan(small.tokens);
});
