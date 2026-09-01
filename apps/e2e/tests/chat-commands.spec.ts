import { randomUUID } from "node:crypto";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

/**
 * The two ways the chat surfaces work the user cannot see in a message: the
 * composer's command menu over their own skills and manual automations, and
 * the cards that say what an answer stood on and what the agent kept.
 */

test("the command menu lists the user's own skills and automations", async ({ page, request }) => {
  const skill = `e2e-skill-${randomUUID().slice(0, 8)}`;
  const automation = `E2E Knopf ${randomUUID().slice(0, 8)}`;
  expect(
    (
      await request.post("/api/wiki", {
        data: {
          name: skill,
          type: "skill",
          content: "Wenn ein Angebot drei Tage ohne Antwort ist, freundlich nachfassen.",
        },
      })
    ).ok(),
  ).toBeTruthy();
  // No schedule: a button the user built, which the menu runs on demand.
  expect(
    (
      await request.post("/api/automations", {
        data: { name: automation, instruction: "Sortiere den Posteingang.", schedule: "" },
      })
    ).ok(),
  ).toBeTruthy();

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("/");

  const menu = page.getByRole("listbox");
  await expect(menu.getByText(skill)).toBeVisible();
  await expect(menu.getByText(automation)).toBeVisible();
  await expect(menu.getByText(t("chat.slash.systemPrompt"))).toBeVisible();

  // Typing filters to what was meant, and picking a skill hands the phrasing
  // to the composer rather than sending it: the case it runs on is still to be
  // typed.
  await composer.fill(`/${skill.slice(0, 6)}`);
  await expect(menu.getByText(automation)).toHaveCount(0);
  await composer.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(composer).toHaveValue(t("chat.slash.skillPrompt", { name: skill }));
});

test("arrowing through a long command menu keeps the active row visible", async ({
  page,
  request,
}) => {
  const skills = Array.from(
    { length: 12 },
    (_, index) => `e2e-scroll-${String(index).padStart(2, "0")}-${randomUUID().slice(0, 8)}`,
  );
  const responses = await Promise.all(
    skills.map((name) =>
      request.post("/api/wiki", {
        data: { name, type: "skill", content: `Run scroll test command ${name}.` },
      }),
    ),
  );
  expect(responses.every((response) => response.ok())).toBeTruthy();

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  // Scope the menu to this test's commands. Worker-scoped E2E databases keep
  // work created by earlier cases, and that unrelated work must not change
  // either the row count or which row ArrowDown reaches.
  await composer.fill("/e2e-scroll-");

  const menu = page.getByRole("listbox");
  const rows = menu.getByRole("button");
  await expect(rows).toHaveCount(skills.length);

  const targetIndex = 9;
  for (let index = 0; index < targetIndex; index += 1) {
    await composer.press("ArrowDown");
  }

  const target = rows.nth(targetIndex);
  const viewport = menu.locator(".overflow-y-auto");
  await expect
    .poll(async () => {
      const [targetBox, viewportBox] = await Promise.all([
        target.boundingBox(),
        viewport.boundingBox(),
      ]);
      if (!targetBox || !viewportBox) return false;
      return (
        targetBox.y >= viewportBox.y &&
        targetBox.y + targetBox.height <= viewportBox.y + viewportBox.height
      );
    })
    .toBe(true);
});

test("an email can be pinned from the composer and stays attached through reload and send", async ({
  page,
}) => {
  const picked = {
    threadId: "thread-catering",
    accountId: "account-work",
    accountName: "Work",
    messageId: "message-catering",
    subject: "Catering quote for September",
    from: "Alex Morgan <alex@example.com>",
    date: "2026-08-31T09:30:00.000Z",
    snippet: "The revised menu and venue total are attached.",
  };
  await page.route("**/api/mail/search?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [picked], partial: false }),
    });
  });

  let sent: Record<string, unknown> | undefined;
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  await page.route("**/api/chat", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-mail-ref" }) +
        frame({ type: "done", text: "The quoted total is €4,800." }),
    });
  });

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await page.getByRole("button", { name: t("chat.refs.add") }).click();
  await expect(composer).toHaveValue("@");
  await composer.type("catering");

  const picker = page.getByRole("listbox", { name: t("chat.refs.picker") });
  await expect(picker.getByText(picked.subject)).toBeVisible();
  await composer.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(composer).toHaveValue("");
  await expect(page.getByText(picked.subject)).toBeVisible();

  // A pinned email is part of the unsent draft, not transient picker state.
  await page.reload();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByText(picked.subject)).toBeVisible();

  await composer.fill("What is the final catering total?");
  await composer.press("Enter");
  await expect.poll(() => sent).toBeDefined();
  if (!sent) throw new Error("chat request was not captured");
  expect(sent).toMatchObject({
    message: "What is the final catering total?",
    refs: [
      {
        threadId: picked.threadId,
        accountId: picked.accountId,
        accountName: picked.accountName,
        messageId: picked.messageId,
        subject: picked.subject,
        from: picked.from,
        date: picked.date,
      },
    ],
  });
  expect((sent.refs as Array<Record<string, unknown>>)[0]).not.toHaveProperty("snippet");
});

test("an answer shows the sources it stood on and what it kept, and the note can be dropped", async ({
  page,
}) => {
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-cards" }) +
        frame({
          type: "card",
          toolCallId: "t1",
          card: {
            kind: "sources",
            query: "Widerrufsfrist Maklervertrag",
            items: [
              { url: "https://www.gesetze-im-internet.de/bgb/__355.html", title: "§ 355 BGB" },
            ],
          },
        }) +
        frame({
          type: "card",
          toolCallId: "t2",
          card: {
            kind: "wiki_note",
            pageId: "familie-mueller",
            summary: "Familie Müller sucht 4 Zimmer in Bogenhausen.",
            updated: true,
            diff: {
              added: 1,
              removed: 1,
              rows: [
                { op: "-", text: "Budget bis 900.000 Euro." },
                { op: "+", text: "Budget bis 1,2 Millionen Euro." },
              ],
            },
          },
        }) +
        frame({
          type: "card",
          toolCallId: "t3",
          card: {
            kind: "mail_sources",
            query: "Maklervertrag",
            items: [
              {
                accountId: "account-work",
                accountName: "Work",
                threadId: "thread-contract",
                messageId: "message-contract",
                subject: "Maklervertrag Müller",
                from: "Anna Müller <anna@example.com>",
                date: "2026-08-29T10:00:00.000Z",
                snippet: "Anbei der unterschriebene Maklervertrag.",
              },
            ],
          },
        }) +
        frame({ type: "done", text: "Die Frist beginnt mit der Belehrung." }),
    });
  });

  await page.route("**/api/mail/threads?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subject: "Maklervertrag Müller",
        messages: [
          {
            id: "message-contract",
            from: "Anna Müller <anna@example.com>",
            to: ["Work <work@example.com>"],
            date: "2026-08-29T10:00:00.000Z",
            body: "Anbei der unterschriebene Maklervertrag für Ihre Unterlagen.",
          },
        ],
      }),
    });
  });

  let deleted: string | null = null;
  await page.route("**/api/wiki/*", async (route) => {
    deleted = new URL(route.request().url()).pathname.split("/").pop() ?? null;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("Wie lange kann ein Maklervertrag widerrufen werden?");
  await composer.press("Enter");

  await expect(page.getByText("§ 355 BGB")).toBeVisible();
  await expect(page.getByText("gesetze-im-internet.de")).toBeVisible();
  await expect(page.getByText("Maklervertrag Müller")).toBeVisible();
  await page.getByRole("button", { name: t("threadHistory.show") }).click();
  await expect(
    page.getByText("Anbei der unterschriebene Maklervertrag für Ihre Unterlagen."),
  ).toBeVisible();
  await expect(page.getByText("Familie Müller sucht 4 Zimmer in Bogenhausen.")).toBeVisible();

  // A rewrite says what it changed, not just that it happened.
  await page
    .getByRole("button", { name: t("chat.cards.wikiNote.changes", { added: 1, removed: 1 }) })
    .click();
  await expect(page.getByText("Budget bis 1,2 Millionen Euro.")).toBeVisible();

  // What the agent decided to remember is the user's to refuse, right here.
  await page.getByRole("button", { name: t("chat.cards.wikiNote.discard") }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: t("chat.cards.wikiNote.discard") })
    .click();
  await expect.poll(() => deleted).toBe("familie-mueller");
  await expect(page.getByText(t("chat.cards.wikiNote.discarded"))).toBeVisible();
});

test("the agent can ask for several details at once and gets them back as one message", async ({
  page,
}) => {
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const sent: string[] = [];
  await page.route("**/api/chat", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}").message);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-form" }) +
        (sent.length > 1
          ? frame({ type: "done", text: "Danke, ich kümmere mich darum." })
          : frame({
              type: "card",
              toolCallId: "t1",
              card: {
                kind: "form",
                title: "Angaben für die Zahlungserinnerung",
                fields: [
                  { name: "due", label: "Neue Frist", kind: "date", required: true },
                  {
                    name: "tone",
                    label: "Tonfall",
                    kind: "choice",
                    options: ["Freundlich erinnern", "Sachlich mahnen"],
                    required: true,
                  },
                ],
              },
            }) + frame({ type: "done", text: "Dafür brauche ich noch zwei Angaben." })),
    });
  });

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("Erinnere Acme an die offene Rechnung.");
  await composer.press("Enter");

  const submit = page.getByRole("button", { name: t("chat.cards.form.submit") });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Neue Frist").fill("2026-09-15");
  await page.getByLabel("Tonfall").click();
  await page.getByRole("option", { name: "Sachlich mahnen" }).click();
  await expect(submit).toBeEnabled();
  await submit.click();

  // The filled fields arrive as the next message of the same conversation.
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toBe("Neue Frist: 2026-09-15\nTonfall: Sachlich mahnen");
});

test("selected text in a reply can be quoted into the composer", async ({ page }) => {
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-quote" }) +
        frame({ type: "done", text: "Die Frist läuft am 30. Juni ab." }),
    });
  });

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("Wann läuft die Frist?");
  await composer.press("Enter");

  const answer = page.getByText("Die Frist läuft am 30. Juni ab.");
  await expect(answer).toBeVisible();
  // Triple-click selects the paragraph, which is how a reader picks a line out
  // of a long reply.
  await answer.click({ clickCount: 3 });
  await page.getByRole("button", { name: t("chat.quote") }).click();
  await expect(composer).toHaveValue("> Die Frist läuft am 30. Juni ab.\n\n");
});

test("a dropped event stream says so instead of looking idle", async ({ page }) => {
  await openApp(page, "/chat");
  // The stream is the app's only push channel; killing it is what a restarted
  // server looks like from here.
  await page.route("**/api/events", (route) => route.abort());
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
  });
  await page.reload();
  await expect(page.getByText(t("chat.offline"))).toBeVisible();
});
