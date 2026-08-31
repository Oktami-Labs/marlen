import type { Automation } from "@marlen/shared";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

const NAME = `E2E Automatisierung ${Date.now()}`;

test("an automation created in the UI is persisted and can be deleted again", async ({
  page,
  request,
}) => {
  await openApp(page, "/automations");

  await page.getByRole("button", { name: t("automations.new") }).click();
  await page.getByLabel(t("automations.name")).fill(NAME);
  await page.getByLabel(t("automations.instruction")).fill("Fasse den Posteingang zusammen.");
  await page.getByRole("button", { name: t("automations.create"), exact: true }).click();

  const row = page.getByRole("button", { name: new RegExp(NAME) });
  await expect(row).toBeVisible();

  const created = (await (await request.get("/api/automations")).json()) as Automation[];
  expect(
    created.map((a) => a.name),
    "the automation reached the database",
  ).toContain(NAME);

  await row.click();
  await page.getByRole("button", { name: t("automations.delete"), exact: true }).click();
  await page
    .getByRole("dialog", { name: t("automations.delete") })
    .getByRole("button", { name: t("automations.delete"), exact: true })
    .click();

  await expect(row).toHaveCount(0);

  const after = (await (await request.get("/api/automations")).json()) as Automation[];
  expect(after.map((a) => a.name)).not.toContain(NAME);
});
