import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Conversation, ConversationListResponse } from "@marlen/shared";
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
  it("filters history by type and identifies chats by their latest activity", async () => {
    await database.db.insert(database.schema.conversations).values([
      {
        id: "activity-old-conversation",
        title: "Activity ranking old",
        type: "chat",
        createdAt: "2026-08-01T10:00:00.000Z",
      },
      {
        id: "activity-new-conversation",
        title: "Activity ranking new",
        type: "chat",
        createdAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "activity-automation",
        title: "Activity ranking automation",
        type: "automation",
        createdAt: "2026-09-02T11:00:00.000Z",
      },
    ]);
    await database.db.insert(database.schema.messages).values([
      {
        id: "activity-old-message",
        conversationId: "activity-old-conversation",
        role: "user",
        content: "Continued today\nwith the termination clause",
        createdAt: "2026-09-02T10:00:00.000Z",
      },
      {
        id: "activity-new-message",
        conversationId: "activity-new-conversation",
        role: "user",
        content: "Started yesterday",
        createdAt: "2026-09-01T10:01:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/conversations?type=chat&q=Activity%20ranking",
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<ConversationListResponse>();
    expect(result.total).toBe(2);
    expect(result.items.map(({ id }) => id)).toEqual([
      "activity-old-conversation",
      "activity-new-conversation",
    ]);
    expect(result.items[0]).toMatchObject({
      preview: "Continued today with the termination clause",
      updatedAt: "2026-09-02T10:00:00.000Z",
    });

    const automations = await app.inject({
      method: "GET",
      url: "/api/conversations?type=automation&q=Activity%20ranking",
    });
    expect(automations.statusCode).toBe(200);
    expect(automations.json<ConversationListResponse>()).toMatchObject({
      total: 1,
      items: [{ id: "activity-automation", type: "automation", preview: null }],
    });
  });

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
