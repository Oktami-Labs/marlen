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
        frame({ type: "done", text: "Die Frist beginnt mit der Belehrung." }),
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
