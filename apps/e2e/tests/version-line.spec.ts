import { CHANGELOG } from "@marlen/shared";
import { expect, openApp, test } from "../src/fixtures.js";

/**
 * The build number under the chat composer. It exists so a support screenshot
 * of the one screen every user has open says which version produced it — a
 * stale install is a cause of failures that look like bugs, and it cost a real
 * investigation to rule out once.
 */
test("the running version shows in the chat", async ({ page }) => {
  await openApp(page);

  // Outside the desktop shell there is no build number to ask for, so the line
  // falls back to the version compiled into the bundle under test.
  const version = CHANGELOG[0]?.version ?? "";
  await expect(page.getByText(`v${version}`, { exact: true })).toBeVisible();
});
