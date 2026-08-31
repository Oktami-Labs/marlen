import { CHANGELOG } from "@marlen/shared";
import { expect, openApp, test } from "../src/fixtures.js";

test("the running version shows in the chat", async ({ page }) => {
  await openApp(page);

  const version = CHANGELOG[0]?.version ?? "";
  await expect(page.getByText(`v${version}`, { exact: true })).toBeVisible();
});
