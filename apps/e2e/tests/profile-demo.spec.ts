import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";
import { gradientPng } from "../src/images.js";

/** Runs only in the `demo` project (`pnpm demo profile`); the default suite skips @demo. */
test("profile: your name, picture and a few words about you, saved as you leave the field, shown in the sidebar @demo", async ({
  page,
}) => {
  await openApp(page, "/settings?section=profile");
  const title = page.getByRole("heading", { name: t("settings.profile.title"), exact: true });
  await expect(title).toBeVisible();
  const profileButton = page.getByRole("button", { name: t("sidebar.openProfileMenu") });
  await expect(profileButton).toContainText(t("sidebar.localProfile"));
  await page.waitForTimeout(1500);

  // The name saves on Enter; the sidebar and the avatar take it at once.
  const name = page.getByRole("textbox", { name: t("settings.profile.name.label") });
  await name.click();
  await name.pressSequentially("Selin Kaya", { delay: 70 });
  await page.waitForTimeout(600);
  await name.press("Enter");
  await expect(page.getByText(t("common.saved"), { exact: true })).toBeVisible();
  await expect(profileButton).toContainText("Selin Kaya");
  await page.waitForTimeout(1500);

  // A picture from disk replaces the initials, in the sidebar too.
  await page.getByRole("button", { name: t("settings.profile.picture.change") }).hover();
  await page.waitForTimeout(700);
  await page
    .getByTestId("settings-workspace")
    .locator('input[type="file"]')
    .setInputFiles(await gradientPng(page));
  await expect(profileButton.locator("img")).toBeVisible();
  await page.waitForTimeout(1500);

  // The free text saves when the field is left.
  const about = page.getByRole("textbox", { name: t("settings.profile.about.label") });
  await about.click();
  await about.pressSequentially(
    "Inhaberin von Nordwind Studio, Design und Branding in Hamburg. Mit Kunden per Sie, im Team per Du.",
    { delay: 28 },
  );
  await page.waitForTimeout(500);
  await title.click();
  await expect(page.getByText(t("common.saved"), { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: test.info().outputPath("final.png"), fullPage: true });
  await page.waitForTimeout(1000);
});
