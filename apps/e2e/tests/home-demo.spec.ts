import { DEMO } from "../../server/src/services/demo/fixtures.js";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

/** Runs only in the `demo` project (`pnpm demo`); the default suite skips @demo. */
test.use({ seeded: true });

test("home: what needs you by kind, the day around its now line, the report behind its row @demo", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.home.title"));

  // The left column groups by kind, the right column is the day.
  const startsWith = (key: string) => new RegExp(`^${t(key)}`);
  await expect(page.getByRole("heading", { name: startsWith("home.needsYou") })).toBeVisible();
  for (const group of ["approvals", "questions", "tasks"]) {
    await expect(page.getByRole("heading", { name: startsWith(`home.${group}`) })).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: t("home.todosToday"), exact: true }),
  ).toBeVisible();
  await expect(page.getByText(t("home.now"), { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);

  // A question answers with one click and leaves the list with its answer.
  const question = page.getByText(DEMO.decisionQuestion);
  await expect(question).toBeVisible();
  await page.getByRole("button", { name: DEMO.decisionAnswer }).hover();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: DEMO.decisionAnswer }).click();
  await expect(question).toHaveCount(0);
  await page.getByRole("button", { name: /erledigt$/ }).click();
  await expect(page.getByText(DEMO.decisionAnswer)).toBeVisible();
  await page.waitForTimeout(1800);

  // The agent's question on an approval is answered on the row, which stays
  // until the draft is sent; the old email draft waits in the same group.
  await expect(page.getByText(DEMO.waitingDraft, { exact: true })).toBeVisible();
  await expect(page.getByText(DEMO.approvalQuestion)).toBeVisible();
  await page.getByRole("button", { name: DEMO.approvalAnswer }).hover();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: DEMO.approvalAnswer }).click();
  await expect(
    page.getByText(t("home.todosAnswered", { answer: DEMO.approvalAnswer })),
  ).toBeVisible();
  await page.waitForTimeout(1800);

  // The briefing leads the day; its row opens the report in place of Home.
  await page.getByRole("button", { name: DEMO.briefingHeadline }).click();
  await expect(page).toHaveURL(/\?report=/);
  await expect(page.getByRole("heading", { name: DEMO.waitingSection })).toBeVisible();
  await expect(page.getByText(DEMO.waitingOn)).toBeVisible();
  await expect(page.getByText(DEMO.resolved)).toBeVisible();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: t("views.home.title"), exact: true }).click();
  await expect(page).not.toHaveURL(/report=/);
  await expect(page.getByText(t("home.now"), { exact: true })).toBeVisible();

  // Any run on the day opens the same way; a chart run shows its chart.
  await page.getByRole("button", { name: DEMO.statsResult }).click();
  await expect(page.getByText(DEMO.chartTitle)).toBeVisible();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: test.info().outputPath("final.png"), fullPage: true });
  await page.waitForTimeout(1200);
});
