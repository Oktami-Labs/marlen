import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

test("a fresh install opens the app and navigates between views", async ({ page }) => {
  await openApp(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.home.title"));

  for (const view of ["automations", "knowledge"] as const) {
    await page.getByRole("link", { name: t(`views.${view}.title`), exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(`views.${view}.title`));
  }

  const primaryNav = page.getByRole("navigation", { name: t("sidebar.primaryNavigation") });
  await expect(
    primaryNav.getByRole("link", { name: t("views.settings.title"), exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: t("sidebar.openProfileMenu") }).click();
  const profileMenu = page.getByRole("menu", { name: t("sidebar.profileMenu") });
  await profileMenu.getByRole("menuitem", { name: t("views.settings.title"), exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.settings.title"));
});

test("the navigation sidebar resizes by pointer and keyboard and remembers its width", async ({
  page,
}) => {
  await openApp(page);

  const sidebar = page.getByRole("complementary").first();
  const resize = page.getByRole("separator", { name: t("sidebar.resize") });
  const dragGrip = async (dx: number) => {
    const grip = await resize.boundingBox();
    if (!grip) throw new Error("the sidebar resize handle was not rendered");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + dx, grip.y + grip.height / 2, { steps: 10 });
    await page.mouse.up();
  };
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(256);

  await dragGrip(96);
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(352);
  await expect(resize).toHaveAttribute("aria-valuenow", "352");

  await page.reload();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(352);

  await resize.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(328);
  await page.keyboard.press("Home");
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(200);
  await page.keyboard.press("End");
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(384);

  // Pulling well past the minimum folds the sidebar to an icon rail.
  await dragGrip(-300);
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(64);
  await expect(
    page.getByRole("link", { name: t("views.automations.title"), exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(64);

  // Pulling the rail's edge back out reopens it at its last width and keeps dragging.
  await dragGrip(100);
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(300);
});

test("setup keeps one task open while both step headers stay available", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("marlen-setup-dismissed", ""));
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("setup.title"));
  const aiStep = page.getByRole("button", { name: t("setup.stepAiTitle"), exact: false });
  const emailStep = page.getByRole("button", { name: t("setup.stepEmailTitle"), exact: false });

  await expect(aiStep).toHaveAttribute("aria-expanded", "true");
  await expect(emailStep).toHaveAttribute("aria-expanded", "false");

  await emailStep.click();
  await expect(aiStep).toHaveAttribute("aria-expanded", "false");
  await expect(emailStep).toHaveAttribute("aria-expanded", "true");
});

test("an unknown address says so instead of quietly landing on Home", async ({ page }) => {
  await openApp(page, "/gibt-es-nicht");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("notFound.title"));
  await expect(page.getByText("/gibt-es-nicht")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/gibt-es-nicht");

  await page.getByRole("button", { name: t("notFound.goHome") }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.home.title"));
});

test("Leads opens from the nav without a CRM", async ({ page }) => {
  await openApp(page);
  const leads = page.getByRole("link", { name: t("views.leads.title"), exact: true });
  await leads.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.leads.title"));
});

test("the theme preference survives a reload", async ({ page }) => {
  await openApp(page);
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);

  await page
    .getByRole("button", { name: t("sidebar.darkMode") })
    .first()
    .click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(html).toHaveClass(/dark/);
});

test("saving a profile preference confirms the save", async ({ page, request }) => {
  await openApp(page, "/settings?section=general");

  const readTimezone = async () => {
    const response = await request.get("/api/settings/timezone");
    return (await response.json()) as { timezone: string | null };
  };
  await expect.poll(async () => (await readTimezone()).timezone).not.toBeNull();
  const initialTimezone = (await readTimezone()).timezone;
  if (!initialTimezone) throw new Error("the app did not initialize its timezone");

  const timezone = initialTimezone === "Pacific/Honolulu" ? "Europe/London" : "Pacific/Honolulu";
  try {
    const field = page.getByRole("combobox", { name: t("settings.timezone.label") });
    await field.fill(timezone);
    await page.getByRole("option").filter({ hasText: timezone }).click();

    await expect(page.getByText(t("common.saved"), { exact: true })).toBeVisible();
    await expect.poll(async () => (await readTimezone()).timezone).toBe(timezone);
  } finally {
    await request.put("/api/settings/timezone", { data: { timezone: initialTimezone } });
  }
});

test("settings keeps the chat open while categories change", async ({ page }) => {
  await openApp(page, "/settings?section=general");

  const collapseChat = page.getByRole("button", { name: t("app.collapseChat") });
  const expandChat = page.getByRole("button", { name: t("app.expandChat") });
  await expect(collapseChat).toBeVisible();
  await expect(expandChat).toBeHidden();
  await expect(page.getByRole("navigation", { name: t("settings.nav.label") })).toBeHidden();

  const category = page.getByRole("combobox", { name: t("settings.nav.label") });
  await expect(category).toBeVisible();
  await category.click();
  await page.getByRole("option", { name: t("settings.nav.permissions"), exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?section=permissions$/);
  await expect(
    page.getByRole("heading", { name: t("settings.fileAccess.title"), exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\?section=general$/);
  await expect(
    page.getByRole("heading", { name: t("settings.sections.preferences.title"), exact: true }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/settings\?section=permissions$/);
  await expect(
    page.getByRole("heading", { name: t("settings.fileAccess.title"), exact: true }),
  ).toBeVisible();

  await collapseChat.click();
  await expect(expandChat).toBeVisible();
});

test("settings uses a wider single reading column on a large monitor", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openApp(page, "/settings?section=general");

  const canvas = await page.locator("#main-content").boundingBox();
  const workspace = await page.getByTestId("settings-workspace").boundingBox();
  if (!canvas || !workspace) throw new Error("the Settings workspace was not rendered");

  expect(workspace.x - canvas.x).toBeLessThan(64);
  expect(workspace.width / canvas.width).toBeGreaterThan(0.5);
  expect(workspace.width / canvas.width).toBeLessThan(0.7);

  const appearance = await page
    .getByRole("combobox", { name: t("settings.appearance.label") })
    .boundingBox();
  const language = await page
    .getByRole("combobox", { name: t("settings.sections.language.title") })
    .boundingBox();
  if (!appearance || !language) throw new Error("the General settings were not rendered");

  expect(language.y).toBeGreaterThan(appearance.y + appearance.height);

  await page.getByRole("button", { name: t("settings.nav.connections"), exact: true }).click();
  const clientId = await page.getByLabel(t("connections.clientId")).boundingBox();
  const clientSecret = await page.getByLabel(t("connections.clientSecret")).boundingBox();
  if (!clientId || !clientSecret) throw new Error("the Connections settings were not rendered");

  expect(clientSecret.y).toBeGreaterThan(clientId.y + clientId.height);
});

test("@mobile the settings category selector navigates", async ({ page }) => {
  await openApp(page, "/settings?section=general");

  const selector = page.getByRole("combobox", { name: t("settings.nav.label") });
  await expect(selector).toBeVisible();
  await expect(page.getByRole("navigation", { name: t("settings.nav.label") })).toBeHidden();

  await selector.click();
  await page.getByRole("option", { name: t("settings.nav.permissions"), exact: true }).click();

  await expect(page).toHaveURL(/\/settings\?section=permissions$/);
  await expect(
    page.getByRole("heading", { name: t("settings.fileAccess.title"), exact: true }),
  ).toBeVisible();
});

test("full computer access makes its implied file access explicit", async ({ page, request }) => {
  const initialResponse = await request.get("/api/settings/file-access");
  const initial = (await initialResponse.json()) as {
    fileAccess: { read: boolean; write: boolean; bash: boolean };
  };
  await request.put("/api/settings/file-access", {
    data: { read: false, write: false, bash: false },
  });

  try {
    await openApp(page, "/settings?section=permissions");
    const read = page.getByRole("switch", { name: t("settings.fileAccess.read.title") });
    const write = page.getByRole("switch", { name: t("settings.fileAccess.write.title") });
    const fullAccess = page.getByRole("switch", {
      name: t("settings.fileAccess.bash.title"),
    });

    await fullAccess.click();
    await page
      .getByRole("button", { name: t("settings.fileAccess.bash.confirmCta"), exact: true })
      .click();

    await expect(fullAccess).toBeChecked();
    await expect(read).toBeChecked();
    await expect(read).toBeDisabled();
    await expect(write).toBeChecked();
    await expect(write).toBeDisabled();
    await expect(
      page.getByText(t("settings.fileAccess.includedWithCommands"), { exact: true }),
    ).toHaveCount(2);
  } finally {
    await request.put("/api/settings/file-access", { data: initial.fileAccess });
  }
});

test("the complete support export downloads from one settings button", async ({ page }) => {
  await openApp(page, "/settings?section=data");

  const downloadStarted = page.waitForEvent("download");
  await page.getByRole("button", { name: t("settings.export.cta") }).click();
  const download = await downloadStarted;

  expect(download.suggestedFilename()).toMatch(/^marlen-export-.*\.zip$/);
  expect(await download.failure()).toBeNull();
});

test("@mobile the navigation is a drawer on a phone", async ({ page }) => {
  await page.goto("/");
  const home = page.getByRole("link", { name: t("views.home.title"), exact: true });
  // The sidebar is rendered but translated off-screen, so it is "visible" to
  // the DOM and only the viewport check distinguishes the two states.
  await expect(home).not.toBeInViewport();

  await page.getByRole("button", { name: t("app.openMenu"), exact: true }).click();
  await expect(home).toBeInViewport();
});

test("@mobile the chat history drawer stays interactive above its backdrop", async ({ page }) => {
  await openApp(page, "/chat");
  const history = page.getByRole("complementary", { name: t("chat.history") });

  await expect(history).not.toBeInViewport();
  await page.getByRole("button", { name: t("chat.history"), exact: true }).click();
  await expect(history).toBeInViewport();

  await history.getByRole("button", { name: t("common.close"), exact: true }).click();
  await expect(history).not.toBeInViewport();
});
