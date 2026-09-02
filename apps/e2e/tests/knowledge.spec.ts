import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

test("a page written in the knowledge editor is stored as markdown", async ({ page, request }) => {
  await openApp(page);
  await page.getByRole("link", { name: t("views.knowledge.title"), exact: true }).click();
  await page.getByRole("button", { name: t("storage.editor.new"), exact: true }).click();

  const body = page.locator(".ProseMirror");
  await body.click();
  await page.keyboard.type("# Angebot Fischer");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Nachfassen am Montag.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Termin bestätigen");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Unterlagen senden");

  // The markdown shortcuts are the editor's own input rules, so what the page
  // shows proves the extensions loaded before anything is saved.
  await expect(body.getByRole("heading", { name: "Angebot Fischer" })).toBeVisible();
  await expect(body.getByRole("listitem")).toHaveCount(2);

  await page.getByRole("button", { name: t("storage.editor.save"), exact: true }).click();
  await expect(body).toHaveCount(0);

  const pages: { content: string }[] = await (await request.get("/api/wiki")).json();
  const stored = pages.find((entry) => entry.content.includes("Angebot Fischer"));
  expect(stored?.content).toContain("# Angebot Fischer");
  expect(stored?.content).toContain("Nachfassen am Montag.");
  expect(stored?.content).toContain("- Termin bestätigen");
  expect(stored?.content).toContain("- Unterlagen senden");
});
