import { DEMO } from "../../server/src/services/demo/fixtures.js";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

/** Runs only in the `demo` project (`pnpm demo`); the default suite skips @demo. */
test.use({ seeded: true });

test("home: the living briefing, a decision answered in place, a chart from a run @demo", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.home.title"));

  // The report says what changed since the previous one.
  await expect(page.getByText(DEMO.briefingHeadline)).toBeVisible();
  await expect(page.getByText(t("chat.cards.report.newMessage")).first()).toBeVisible();
  await expect(page.getByText(/^seit\s/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.waitingSection })).toBeVisible();
  await expect(page.getByText(DEMO.waitingOn)).toBeVisible();
  await expect(page.getByText(DEMO.resolved)).toBeVisible();
  await page.waitForTimeout(2500);

  // A decision answers with one click and leaves the agenda with its answer.
  const question = page.getByText(DEMO.decisionQuestion);
  await expect(question).toBeVisible();
  await page.getByRole("button", { name: DEMO.decisionAnswer }).hover();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: DEMO.decisionAnswer }).click();
  await expect(question).toHaveCount(0);
  await page.getByRole("button", { name: /erledigt$/ }).click();
  await expect(page.getByText(DEMO.decisionAnswer)).toBeVisible();
  await page.waitForTimeout(1800);

  // Drafts awaiting approval share the agenda's day axis: the old email draft
  // sits under Missed, and the agent's question on the WhatsApp draft is
  // answered on the row, which stays until the draft is sent.
  await expect(page.getByText(DEMO.waitingDraft, { exact: true })).toBeVisible();
  await expect(page.getByText(DEMO.approvalQuestion)).toBeVisible();
  await page.getByRole("button", { name: DEMO.approvalAnswer }).hover();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: DEMO.approvalAnswer }).click();
  await expect(
    page.getByText(t("home.todosAnswered", { answer: DEMO.approvalAnswer })),
  ).toBeVisible();
  await page.waitForTimeout(1800);

  // A run's chart shows on Home when its row unfolds.
  await page.getByText(DEMO.statsAutomation).first().click();
  await expect(page.getByText(DEMO.chartTitle)).toBeVisible();
  await page.getByText(DEMO.chartTitle).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: test.info().outputPath("final.png"), fullPage: true });
  await page.waitForTimeout(1200);
});
