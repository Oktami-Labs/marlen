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

test("the agent can compose a safe card and its reply action stays in chat", async ({ page }) => {
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const sent: string[] = [];
  await page.route("**/api/chat", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}") as { message: string };
    sent.push(request.message);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-composed-card" }) +
        (sent.length > 1
          ? frame({ type: "done", text: "I’ll draft that follow-up." })
          : frame({
              type: "card",
              toolCallId: "compose-1",
              card: {
                kind: "composed",
                version: 1,
                title: "Launch readiness",
                fallback: "The launch is 78% ready; two tasks remain.",
                blocks: [
                  {
                    kind: "metrics",
                    items: [
                      { label: "Ready", value: "78%", detail: "+12% this week", tone: "success" },
                      { label: "Open", value: "2", tone: "warning" },
                    ],
                  },
                  { kind: "markdown", content: "**Next bottleneck:** packaging approval." },
                  {
                    kind: "key_value",
                    items: [
                      { label: "Owner", value: "Elif" },
                      { label: "Deadline", value: "Thursday" },
                    ],
                  },
                  {
                    kind: "list",
                    items: [
                      { title: "Approve packaging", tone: "warning" },
                      { title: "Confirm print date", detail: "Quote received" },
                    ],
                  },
                  {
                    kind: "table",
                    columns: ["Vendor", "Price"],
                    rows: [
                      ["Norddruck", "€3,480"],
                      ["Printwerk", "€3,250"],
                    ],
                  },
                  {
                    kind: "chart",
                    chartType: "bar",
                    title: "Price",
                    unit: "€",
                    points: [
                      { label: "Norddruck", value: 3480 },
                      { label: "Printwerk", value: 3250, tone: "success" },
                    ],
                  },
                ],
                actions: [
                  {
                    kind: "reply",
                    label: "Follow up",
                    message: "Draft a follow-up to Elif.",
                  },
                  {
                    kind: "open_url",
                    label: "Open project",
                    url: "https://example.com/project",
                  },
                ],
              },
            }) + frame({ type: "done", text: "The launch is moving, but approval is next." })),
    });
  });

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("Show me launch readiness as a card.");
  await composer.press("Enter");

  await expect(page.locator("p").filter({ hasText: /^Launch readiness$/ })).toBeVisible();
  await expect(page.getByText("78%")).toBeVisible();
  await expect(page.getByText("Next bottleneck:")).toBeVisible();
  await expect(page.getByText("Approve packaging")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Vendor" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: t("chat.cards.chart.alt", { title: "Price" }) }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open project" })).toBeVisible();

  await page.getByRole("button", { name: "Follow up" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toBe("Draft a follow-up to Elif.");
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

test("the agent can connect a service inside chat without putting credentials in the transcript", async ({
  page,
  request,
}) => {
  await request.delete("/api/onoffice");
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/conversations/e2e-inline-connection", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-inline-connection",
        title: "Inline connection",
        type: "chat",
        createdAt: "2026-09-02T10:00:00.000Z",
        running: false,
      }),
    });
  });
  await page.route("**/api/chat", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-inline-connection" }) +
        (sent.length === 1
          ? frame({
              type: "card",
              toolCallId: "connect-1",
              card: { kind: "connection", query: "" },
            }) + frame({ type: "done", text: "Verbinden Sie den benötigten Dienst hier." })
          : frame({ type: "done", text: "Die Verbindung steht. Ich mache weiter." })),
    });
  });

  await openApp(page, "/chat");
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("Verbinde mein CRM und arbeite danach weiter.");
  await composer.press("Enter");

  await expect(page.getByText(t("chat.cards.connection.titleAny"))).toBeVisible();
  await page.getByRole("button", { name: t("connections.pipedreamSetupOption") }).click();
  await expect(page.getByLabel(t("connections.clientId"))).toBeVisible();
  await expect(page.getByLabel(t("connections.clientSecret"))).toBeVisible();
  await expect(page).not.toHaveURL(/settings/);

  await page.getByRole("button", { name: t("common.close") }).click();
  await page.getByRole("button", { name: "onOffice" }).click();
  await page.getByLabel(t("onoffice.token")).fill("inline-e2e-token");
  await page.getByLabel(t("onoffice.secret")).fill("inline-e2e-secret");
  await page.getByRole("button", { name: t("onoffice.save"), exact: true }).click();

  await expect(page.getByText(t("connections.connected", { service: "onOffice" }))).toBeVisible();
  const status = (await (await request.get("/api/onoffice")).json()) as { configured: boolean };
  expect(status.configured).toBe(true);
  expect(JSON.stringify(status)).not.toContain("inline-e2e-secret");

  await page.getByRole("button", { name: t("connections.continue"), exact: true }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]?.message).toBe(
    t("chat.cards.connection.continueMessage", { service: "onOffice" }),
  );
  expect(JSON.stringify(sent)).not.toContain("inline-e2e-token");
  expect(JSON.stringify(sent)).not.toContain("inline-e2e-secret");
  await expect(page).not.toHaveURL(/settings/);

  await request.delete("/api/onoffice");
});

test("an explicit appearance request applies immediately and leaves the choices in chat", async ({
  page,
}) => {
  const conversationId = "e2e-inline-appearance";
  const appearanceCard = {
    kind: "app_setting",
    setting: "appearance",
    value: "dark",
  } as const;
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  let chatRequests = 0;
  let replayLiveTurn = false;

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: conversationId,
        title: "Inline appearance",
        type: "chat",
        createdAt: "2026-09-02T10:00:00.000Z",
        running: replayLiveTurn,
      }),
    });
  });
  await page.route(`**/api/conversations/${conversationId}/messages`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "appearance-user-1",
          conversationId,
          role: "user",
          content: "Schalte den Dunkelmodus ein.",
          createdAt: "2026-09-02T10:00:00.000Z",
        },
      ]),
    });
  });
  await page.route(`**/api/chat/${conversationId}/live`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        turn: replayLiveTurn
          ? {
              id: "appearance-assistant-1",
              conversationId,
              content: "Der Dunkelmodus ist aktiv.",
              createdAt: "2026-09-02T10:00:01.000Z",
              toolCalls: [],
              cards: [{ toolCallId: "appearance-1", card: appearanceCard }],
              thinking: false,
            }
          : null,
      }),
    });
  });
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId }) +
        frame({ type: "card", toolCallId: "appearance-1", card: appearanceCard }) +
        frame({ type: "done", text: "Der Dunkelmodus ist aktiv." }),
    });
  });

  await openApp(page, "/chat");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  const composer = page.getByPlaceholder(t("chat.placeholder"));
  await composer.fill("Schalte den Dunkelmodus ein.");
  await composer.press("Enter");

  const appearance = page.getByRole("group", { name: t("settings.appearance.label") });
  const light = appearance.getByRole("button", {
    name: t("settings.appearance.light"),
    exact: true,
  });
  const dark = appearance.getByRole("button", {
    name: t("settings.appearance.dark"),
    exact: true,
  });
  const system = appearance.getByRole("button", {
    name: t("settings.appearance.system"),
    exact: true,
  });
  await expect(appearance).toBeVisible();
  await expect(light).toBeVisible();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(system).toBeVisible();
  await expect(html).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("marlen-theme"))).toBe("dark");
  expect(chatRequests).toBe(1);
  await expect(page).not.toHaveURL(/settings/);

  await light.click();
  await expect(html).not.toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("marlen-theme"))).toBe("light");
  expect(chatRequests).toBe(1);

  // A live-turn snapshot can replay after a reload. The same action must not
  // override the user's later choice a second time.
  replayLiveTurn = true;
  await page.reload();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(appearance).toBeVisible();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(html).not.toHaveClass(/dark/);
  expect(chatRequests).toBe(1);
});

test("a timezone offered in chat saves there without another agent turn", async ({
  page,
  request,
}) => {
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  let chatRequests = 0;

  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        frame({ type: "conversation", conversationId: "e2e-inline-timezone" }) +
        frame({
          type: "card",
          toolCallId: "timezone-1",
          card: { kind: "app_setting", setting: "timezone" },
        }) +
        frame({ type: "done", text: "Wählen Sie die Zeitzone direkt hier." }),
    });
  });

  await openApp(page, "/chat");
  const readTimezone = async () => {
    const response = await request.get("/api/settings/timezone");
    return (await response.json()) as { timezone: string | null };
  };
  await expect.poll(async () => (await readTimezone()).timezone).not.toBeNull();
  const initialTimezone = (await readTimezone()).timezone;
  if (!initialTimezone) throw new Error("the app did not initialize its timezone");

  try {
    const composer = page.getByPlaceholder(t("chat.placeholder"));
    await composer.fill("Stelle meine Zeitzone auf Amerika um.");
    await composer.press("Enter");

    const timezone = page.getByRole("combobox", { name: t("settings.timezone.label") });
    await expect(timezone).toBeVisible();
    await timezone.fill("America/New_York");
    await page.getByRole("option").filter({ hasText: "America/New_York" }).click();

    await expect(page.getByText(t("common.saved"), { exact: true })).toBeVisible();
    await expect.poll(async () => (await readTimezone()).timezone).toBe("America/New_York");
    expect(chatRequests).toBe(1);
    await expect(page).not.toHaveURL(/settings/);
  } finally {
    await request.put("/api/settings/timezone", { data: { timezone: initialTimezone } });
  }
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
