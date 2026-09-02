import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

function sql(stateDir: string, statement: string) {
  const db = new DatabaseSync(join(stateDir, "marlen.db"));
  try {
    db.exec(statement);
  } finally {
    db.close();
  }
}

const HOUR_MS = 3_600_000;

test("a reply still being written when the app loads shows as in progress (however old), then lands", async ({
  page,
  context,
  server,
  request,
}) => {
  const id = `e2e-${randomUUID()}`;
  const question = `Wie viele Mails kamen heute? (${id})`;
  const askedAt = new Date(Date.now() - 3 * HOUR_MS).toISOString();
  sql(
    server.stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES ('${id}', 'continuity', 'chat', '${askedAt}');
     INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('${id}-u', '${id}', 'user', '${question}', '${askedAt}');`,
  );
  await page.addInitScript((conversationId) => {
    localStorage.setItem("marlen-last-conversation", conversationId);
  }, id);

  await openApp(page);
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByText(t("chat.thinking"))).toBeVisible();
  await expect(page.getByRole("button", { name: t("chat.stop") })).toBeVisible();
  await expect(page.getByRole("button", { name: t("chat.send") })).toHaveCount(0);

  const stopRequested = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith(`/api/chat/${id}/stop`),
  );
  await page.getByPlaceholder(t("chat.placeholder")).press("Escape");
  await stopRequested;

  const answer = `Heute kamen drei. (${id})`;
  sql(
    server.stateDir,
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('${id}-a', '${id}', 'assistant', '${answer}', '${new Date().toISOString()}');`,
  );
  const renamed = await request.patch(`/api/conversations/${id}`, {
    data: { title: "continuity done" },
  });
  expect(renamed.ok()).toBeTruthy();

  await expect(page.getByText(answer)).toBeVisible();
  await expect(page.getByText(t("chat.thinking"))).toHaveCount(0);
  await expect(page.getByRole("button", { name: t("chat.send") })).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: t("chat.message.copy") }).click();
  await expect(page.getByRole("button", { name: t("chat.message.copied") })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(answer);
});

test("a long transcript opens at its end, and scrolling up offers the way back", async ({
  page,
  server,
}) => {
  const id = `e2e-${randomUUID()}`;
  const startedAt = Date.now();
  const rows = Array.from({ length: 60 }, (_, i) => {
    const role = i % 2 === 0 ? "user" : "assistant";
    const stamp = new Date(startedAt + i * 1000).toISOString();
    return `('${id}-${i}', '${id}', '${role}', 'Nachricht ${i} (${id})', '${stamp}')`;
  });
  sql(
    server.stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES ('${id}', 'long', 'chat', '${new Date(startedAt).toISOString()}');
     INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ${rows.join(",")};`,
  );
  await page.addInitScript((conversationId) => {
    localStorage.setItem("marlen-last-conversation", conversationId);
  }, id);

  await openApp(page);
  const latest = page.getByText(`Nachricht 59 (${id})`);
  await expect(latest).toBeInViewport();
  const jump = page.getByRole("button", { name: t("chat.jumpToLatest") });
  await expect(jump).toHaveCount(0);

  // Reading back up the transcript lets go of the end and offers the way back.
  await latest.hover();
  await page.mouse.wheel(0, -1200);
  await expect(latest).not.toBeInViewport();
  await expect(jump).toBeVisible();

  await jump.click();
  await expect(latest).toBeInViewport();
  await expect(jump).toHaveCount(0);
});

/** A finished exchange: question and answer written `hoursAgo`. */
function seedFinishedChat(stateDir: string, id: string, hoursAgo: number, question: string) {
  const askedAt = new Date(Date.now() - hoursAgo * HOUR_MS).toISOString();
  const answeredAt = new Date(Date.now() - hoursAgo * HOUR_MS + 5_000).toISOString();
  sql(
    stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES ('${id}', 'finished ${id}', 'chat', '${askedAt}');
     INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES
       ('${id}-u', '${id}', 'user', '${question}', '${askedAt}'),
       ('${id}-a', '${id}', 'assistant', 'Erledigt.', '${answeredAt}');`,
  );
}

test("history stays flat, newest-first, and opens automation runs on demand", async ({
  page,
  server,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const chatId = `history-chat-${suffix}`;
  const olderChatId = `history-chat-older-${suffix}`;
  const runId = `history-run-${suffix}`;
  const chatTitle = `Contract notice period ${suffix}`;
  const olderChatTitle = `Old project notes ${suffix}`;
  const chatPreview = "Check Nina's last email and summarize the termination clause.";
  const automationName = `Morning briefing ${suffix}`;
  const createdAt = new Date().toISOString();
  const olderAt = new Date(Date.now() - 48 * HOUR_MS).toISOString();
  sql(
    server.stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES
       ('${chatId}', '${chatTitle}', 'chat', '${createdAt}'),
       ('${olderChatId}', '${olderChatTitle}', 'chat', '${olderAt}'),
       ('${runId}', 'Run: ${automationName}', 'automation', '${createdAt}');
     INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES
       ('${chatId}-u', '${chatId}', 'user', '${chatPreview.replaceAll("'", "''")}', '${createdAt}');`,
  );

  await openApp(page, "/chat");
  const history = page.getByRole("complementary", { name: t("chat.history") });
  const automations = history.getByRole("button", {
    name: t("chat.automations"),
    exact: true,
  });

  await expect(history.getByRole("button", { name: t("chat.chats"), exact: true })).toHaveCount(0);
  await expect(history.getByText(chatTitle, { exact: true })).toBeVisible();
  await expect(history.getByText(chatPreview, { exact: true })).toBeVisible();
  await expect(history.getByText(olderChatTitle, { exact: true })).toBeVisible();
  await expect(history.getByText(automationName, { exact: true })).toHaveCount(0);
  await expect(history.getByRole("heading", { level: 4 })).toHaveCount(0);

  const newerRow = history.getByRole("button", { name: new RegExp(chatTitle) });
  const olderRow = history.getByRole("button", { name: new RegExp(olderChatTitle) });
  const [newerBox, olderBox] = await Promise.all([newerRow.boundingBox(), olderRow.boundingBox()]);
  expect(newerBox).not.toBeNull();
  expect(olderBox).not.toBeNull();
  expect(newerBox?.y ?? 0).toBeLessThan(olderBox?.y ?? 0);

  await automations.click();
  await expect(history.getByRole("button", { name: t("chat.chats"), exact: true })).toBeVisible();
  await expect(history.getByText(automationName, { exact: true })).toBeVisible();
  await expect(history.getByText(chatTitle, { exact: true })).toHaveCount(0);
});

test("a chat finished over an hour ago reopens where the user left it", async ({
  page,
  server,
  request,
}) => {
  const id = `e2e-${randomUUID()}`;
  const question = `Alte Frage (${id})`;
  seedFinishedChat(server.stateDir, id, 2, question);
  await page.addInitScript((conversationId) => {
    localStorage.setItem("marlen-last-conversation", conversationId);
  }, id);

  await openApp(page);
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByText("Erledigt.", { exact: true })).toBeVisible();
  await expect(page.getByText(t("chat.emptyTitle"))).toHaveCount(0);

  const listed = (await (await request.get("/api/conversations?limit=200")).json()) as {
    items: { id: string }[];
  };
  expect(listed.items.some((c) => c.id === id)).toBe(true);
});

test("a chat left open past the idle hour stays open", async ({ page, server }) => {
  const id = `e2e-${randomUUID()}`;
  const question = `Frage von vorhin (${id})`;
  seedFinishedChat(server.stateDir, id, 0.5, question);
  await page.addInitScript((conversationId) => {
    localStorage.setItem("marlen-last-conversation", conversationId);
  }, id);
  await page.clock.install();

  // Half an hour old: still the open chat.
  await openApp(page);
  await expect(page.getByText(question)).toBeVisible();

  // Forty more minutes pass with the window open. Time alone must not discard
  // the user's place or make the conversation look finished and forgotten.
  await page.clock.fastForward("40:00");
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByText("Erledigt.", { exact: true })).toBeVisible();
  await expect(page.getByText(t("chat.emptyTitle"))).toHaveCount(0);
});

test("a message the server never received returns to the composer", async ({ page }) => {
  await openApp(page);
  await page.route("**/api/chat", (route) => route.abort());

  const composer = page.getByPlaceholder(t("chat.placeholder"));
  const text = "Hallo, bist du da?";
  await composer.fill(text);
  await composer.press("Enter");

  await expect(composer).toHaveValue(text);
  // Nothing was sent, so the transcript is still the empty state, not a failed turn.
  await expect(page.getByText(t("chat.emptyTitle"))).toBeVisible();
});

test("a file pasted into the composer is attached to the next message", async ({ page }) => {
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  let sent: unknown;
  await page.route("**/api/chat", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-pasted-file" }) +
        frame({ type: "done", text: "Gelesen." }),
    });
  });

  await openApp(page);
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File(["Quarterly revenue: 42"], "quarterly.txt", { type: "text/plain" }),
    );
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));
  });

  await expect(page.getByText("quarterly.txt", { exact: true })).toBeVisible();
  await composer.fill("Summarize this file.");
  await composer.press("Enter");

  await expect
    .poll(() => sent)
    .toMatchObject({
      message: "Summarize this file.",
      attachments: [
        {
          name: "quarterly.txt",
          mimeType: "text/plain",
          data: "UXVhcnRlcmx5IHJldmVudWU6IDQy",
        },
      ],
    });
  await expect(page.getByText("quarterly.txt", { exact: true })).toBeVisible();
});

test("each conversation keeps its own unsent draft across switches and reloads", async ({
  page,
  server,
}) => {
  const firstId = `e2e-${randomUUID()}`;
  const secondId = `e2e-${randomUUID()}`;
  const firstTitle = `First draft ${firstId}`;
  const secondTitle = `Second draft ${secondId}`;
  const createdAt = new Date().toISOString();
  sql(
    server.stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES
       ('${firstId}', '${firstTitle}', 'chat', '${createdAt}'),
       ('${secondId}', '${secondTitle}', 'chat', '${createdAt}');
     INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES
       ('${firstId}-u', '${firstId}', 'user', 'First question', '${createdAt}'),
       ('${firstId}-a', '${firstId}', 'assistant', 'First answer', '${createdAt}'),
       ('${secondId}-u', '${secondId}', 'user', 'Second question', '${createdAt}'),
       ('${secondId}-a', '${secondId}', 'assistant', 'Second answer', '${createdAt}');`,
  );
  await page.addInitScript((conversationId) => {
    localStorage.setItem("marlen-last-conversation", conversationId);
  }, firstId);

  let releaseRestore!: () => void;
  const restoreGate = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  await page.route(`**/api/conversations/${firstId}/messages`, async (route) => {
    await restoreGate;
    await route.continue();
  });

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  const firstDraft = `Ask about catering ${firstId}`;
  const secondDraft = `Ask about the venue ${secondId}`;
  await composer.fill(firstDraft);

  // The saved conversation is already the composer owner while its transcript
  // is still restoring. Text entered during that window must not become a
  // separate "new conversation" draft.
  releaseRestore();
  await expect(page.getByText("First answer", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue(firstDraft);

  await page.getByRole("button", { name: new RegExp(secondTitle) }).click();
  await expect(composer).toHaveValue("");
  await composer.fill(secondDraft);

  await page.getByRole("button", { name: new RegExp(firstTitle) }).click();
  await expect(composer).toHaveValue(firstDraft);

  await page.reload();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(composer).toHaveValue(firstDraft);

  await page.getByRole("button", { name: new RegExp(secondTitle) }).click();
  await expect(composer).toHaveValue(secondDraft);
});

test("a destructive confirmation stays open when the delete fails", async ({ page, server }) => {
  const id = `e2e-${randomUUID()}`;
  const title = `Delete failure ${id}`;
  const createdAt = new Date().toISOString();
  sql(
    server.stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES ('${id}', '${title}', 'chat', '${createdAt}');`,
  );
  await page.route(`**/api/conversations/${id}`, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Delete failed", requestId: "e2e" }),
    });
  });

  await openApp(page, "/chat");
  const conversation = page.getByRole("button", { name: new RegExp(title) });
  await conversation.hover();
  await conversation
    .locator("..")
    .getByRole("button", { name: t("chat.moreActions") })
    .click();
  await page.getByRole("menuitem", { name: t("chat.delete") }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: t("chat.delete") }).click();
  await expect(page.getByText("Delete failed", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: t("common.cancel") }).click();
  await expect(conversation).toBeVisible();
});

test("a message typed while a reply is running waits its turn, then goes", async ({
  page,
  server,
  request,
}) => {
  const id = `e2e-${randomUUID()}`;
  const question = `Läuft noch (${id})`;
  const askedAt = new Date().toISOString();
  sql(
    server.stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES ('${id}', 'queue', 'chat', '${askedAt}');
     INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('${id}-u', '${id}', 'user', '${question}', '${askedAt}');`,
  );
  await page.addInitScript((conversationId) => {
    localStorage.setItem("marlen-last-conversation", conversationId);
  }, id);

  const sent: string[] = [];
  await page.route("**/api/chat", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}").message);
    const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: id }) +
        frame({ type: "done", text: "Alles klar." }),
    });
  });

  await openApp(page);
  await expect(page.getByText(question)).toBeVisible();
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  const followUp = `Und die von gestern? (${id})`;
  await composer.fill(followUp);
  await composer.press("Enter");

  await expect(composer).toHaveValue("");
  await expect(page.getByText(t("chat.queue.waiting_one", { count: 1 }))).toBeVisible();
  expect(sent).toEqual([]);

  // It is still the user's message until it goes, so rewriting it in place is
  // what gets sent.
  const edited = `Und die von vorgestern? (${id})`;
  await page.getByRole("button", { name: t("chat.queue.edit") }).click();
  const editor = page.getByRole("textbox", { name: t("chat.queue.edit") });
  await editor.fill(edited);
  await editor.press("Enter");
  await expect(page.getByText(edited)).toBeVisible();

  sql(
    server.stateDir,
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('${id}-a', '${id}', 'assistant', 'Drei.', '${new Date().toISOString()}');`,
  );
  expect(
    (await request.patch(`/api/conversations/${id}`, { data: { title: "queue done" } })).ok(),
  ).toBeTruthy();

  await expect(page.getByText(t("chat.queue.waiting_one", { count: 1 }))).toHaveCount(0);
  await expect(page.getByText("Alles klar.")).toBeVisible();
  expect(sent).toEqual([edited]);
});

test("a conversation spanning two days marks them, and the header searches inside it", async ({
  page,
  server,
}) => {
  const id = `e2e-${randomUUID()}`;
  const yesterday = new Date(Date.now() - 24 * HOUR_MS);
  const rows = [
    `('${id}-1', '${id}', 'user', 'Termin Mittwoch (${id})', '${yesterday.toISOString()}')`,
    `('${id}-2', '${id}', 'assistant', 'Notiert.', '${new Date(yesterday.getTime() + 1000).toISOString()}')`,
    `('${id}-3', '${id}', 'user', 'Termin Donnerstag (${id})', '${new Date().toISOString()}')`,
  ];
  sql(
    server.stateDir,
    `INSERT INTO conversations (id, title, type, created_at) VALUES ('${id}', 'days', 'chat', '${yesterday.toISOString()}');
     INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ${rows.join(",")};`,
  );
  await page.addInitScript((conversationId) => {
    localStorage.setItem("marlen-last-conversation", conversationId);
  }, id);

  await openApp(page);
  // Day headings are paragraphs; Home's own "Today" column head is a heading.
  const dayHeading = (label: string) =>
    page.getByRole("paragraph").filter({ hasText: new RegExp(`^${label}$`) });
  await expect(dayHeading(t("chat.groupYesterday"))).toBeVisible();
  await expect(dayHeading(t("chat.groupToday"))).toBeVisible();

  await page.getByRole("button", { name: t("chat.search.open") }).click();
  await page.getByPlaceholder(t("chat.search.placeholder")).fill("Termin");
  await expect(page.getByText("1/2")).toBeVisible();

  await page.getByPlaceholder(t("chat.search.placeholder")).press("Enter");
  await expect(page.getByText("2/2")).toBeVisible();

  await page.getByRole("button", { name: t("chat.search.close") }).click();
  await expect(page.getByPlaceholder(t("chat.search.placeholder"))).toHaveCount(0);
});

test("a stopped turn keeps its half-written reply, its failed call, and the way on", async ({
  page,
}) => {
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const call = {
    toolCallId: "t1",
    toolName: "email_search",
    toolLabel: "E-Mails durchsuchen",
    parameters: { query: "Rechnung" },
    contentOffset: 0,
  };
  const sent: string[] = [];
  await page.route("**/api/chat", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}").message);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-stopped" }) +
        frame({ type: "tool_start", ...call }) +
        frame({ ...call, type: "tool_end", isError: true, result: "Gmail antwortet nicht (503)" }) +
        frame({ type: "tool_start", ...call, toolCallId: "t2" }) +
        frame({
          ...call,
          toolCallId: "t2",
          type: "tool_end",
          isError: true,
          result: "Gmail antwortet nicht (503)",
        }) +
        frame({ type: "text_delta", delta: "Das Postfach antwortet gerade nicht." }) +
        frame({ type: "stopped", text: "Das Postfach antwortet gerade nicht." }),
    });
  });

  await openApp(page);
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("Such mir die Rechnungen von gestern.");
  await composer.press("Enter");

  await expect(page.getByText("Das Postfach antwortet gerade nicht.")).toBeVisible();
  await expect(page.getByText(t("chat.tool.attempt", { n: 2 }))).toBeVisible();
  await expect(page.getByText("Gmail antwortet nicht (503)").first()).toBeVisible();
  await expect(page.getByText(t("chat.message.stopped"))).toBeVisible();

  await page
    .getByRole("button", { name: t("chat.tool.retry") })
    .first()
    .click();
  await expect
    .poll(() => sent[1])
    .toBe(t("chat.tool.retryPrompt", { tool: "E-Mails durchsuchen" }));

  await page.getByRole("button", { name: t("chat.message.continue") }).click();
  await expect.poll(() => sent[2]).toBe(t("chat.message.continuePrompt"));
});
