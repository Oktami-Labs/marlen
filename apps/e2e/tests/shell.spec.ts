import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

test("a fresh install opens the app and navigates between views", async ({ page }) => {
  await openApp(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.home.title"));

  for (const view of ["automations", "knowledge", "settings"] as const) {
    await page.getByRole("link", { name: t(`views.${view}.title`), exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(`views.${view}.title`));
  }
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

test("Leads stays hidden until a CRM is connected", async ({ page, request }) => {
  await openApp(page);
  const leads = page.getByRole("link", { name: t("views.leads.title"), exact: true });
  await expect(leads).toHaveCount(0);

  await request.put("/api/onoffice", { data: { token: "e2e-token", secret: "e2e-secret" } });
  try {
    await page.reload();
    await expect(leads).toBeVisible();
    await leads.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.leads.title"));
  } finally {
    await request.delete("/api/onoffice");
  }
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
  await openApp(page, "/settings");

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

    await expect(
      page.locator("[data-sonner-toast][data-type='success']").filter({
        hasText: t("common.saved"),
      }),
    ).toBeVisible();
    await expect.poll(async () => (await readTimezone()).timezone).toBe(timezone);
  } finally {
    await request.put("/api/settings/timezone", { data: { timezone: initialTimezone } });
  }
});

test("the complete support export downloads from one settings button", async ({ page }) => {
  await openApp(page, "/settings");

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

  await page
    .getByRole("button", { name: t("app.openMenu") })
    .first()
    .click();
  await expect(home).toBeInViewport();
});
