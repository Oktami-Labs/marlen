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
  await page.getByRole("button", { name: t("automations.frequency.weekdays") }).click();
  await page.getByLabel(t("automations.time")).fill("09:30");
  await page.getByRole("button", { name: t("automations.create"), exact: true }).click();

  const row = page.getByRole("button", { name: new RegExp(NAME) });
  await expect(row).toBeVisible();

  const created = (await (await request.get("/api/automations")).json()) as Automation[];
  expect(
    created.map((a) => a.name),
    "the automation reached the database",
  ).toContain(NAME);
  const saved = created.find((automation) => automation.name === NAME);
  if (!saved) throw new Error("the created automation was not returned by the API");
  expect(saved.schedule).toBe("30 9 * * 1-5");

  await row.click();
  const dialog = page.getByRole("dialog", { name: t("automations.editTitle") });
  await expect(
    dialog.getByRole("button", { name: t("automations.frequency.weekdays") }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel(t("automations.time"))).toHaveValue("09:30");
  await expect(dialog.getByText(saved.schedule, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: t("automations.delete"), exact: true }).click();
  await page
    .getByRole("dialog", { name: t("automations.delete") })
    .getByRole("button", { name: t("automations.delete"), exact: true })
    .click();

  await expect(row).toHaveCount(0);

  const after = (await (await request.get("/api/automations")).json()) as Automation[];
  expect(after.map((a) => a.name)).not.toContain(NAME);
});

test("an existing custom schedule stays private and unchanged while editing", async ({
  page,
  request,
}) => {
  const name = `E2E eigener Zeitplan ${Date.now()}`;
  const schedule = "0 8 1,15 * *";
  const createdResponse = await request.post("/api/automations", {
    data: {
      name,
      instruction: "Prüfe zweimal im Monat den Posteingang.",
      schedule,
    },
  });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()) as Automation;

  await openApp(page, "/automations");
  const row = page.getByRole("button", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(page.getByText(schedule, { exact: true })).toHaveCount(0);

  await row.click();
  const dialog = page.getByRole("dialog", { name: t("automations.editTitle") });
  await expect(dialog.getByText(t("automations.customSchedule"), { exact: true })).toBeVisible();
  await expect(dialog.getByText(schedule, { exact: true })).toHaveCount(0);

  const updatedName = `${name} bearbeitet`;
  await dialog.getByLabel(t("automations.name")).fill(updatedName);
  await dialog.getByRole("button", { name: t("automations.save"), exact: true }).click();

  const automations = (await (await request.get("/api/automations")).json()) as Automation[];
  const updated = automations.find((automation) => automation.id === created.id);
  expect(updated?.name).toBe(updatedName);
  expect(updated?.schedule).toBe(schedule);

  await request.delete(`/api/automations/${created.id}`);
});
