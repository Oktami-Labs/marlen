import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Conversation } from "@marlen/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
let database: typeof import("../../src/db/index.js");

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-chat-route-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  database = await import("../../src/db/index.js");
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  await app?.close();
});

describe("conversation routes", () => {
  it("loads one conversation by id and returns the standard missing-row error", async () => {
    const conversation: Conversation = {
      id: "focused-conversation",
      title: "Mailbox review",
      type: "chat",
      createdAt: "2026-08-31T10:00:00.000Z",
      focusAccountId: "account-1",
      focusThreadId: "thread-1",
      focusThreadSubject: "Quarterly report",
    };
    await database.db.insert(database.schema.conversations).values(conversation);

    const found = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json<Conversation>()).toEqual({ ...conversation, running: false });

    const missing = await app.inject({
      method: "GET",
      url: "/api/conversations/missing",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: string }>()).toMatchObject({ error: "not found" });
  });
});
