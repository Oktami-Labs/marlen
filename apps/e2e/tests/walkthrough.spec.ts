import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";

/** Local stand-in: the shipped openApp() is strict-mode ambiguous on /knowledge. */
async function openApp(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("navigation").first()).toBeVisible();
}

/** TEMPORARY exploratory walkthrough — delete after the manual review pass. */

const SHOTS =
  "/private/tmp/claude-501/-Users-huti-Desktop-Git-Trailin/58fa4765-e822-4843-90ed-5043b019ec20/scratchpad/shots";
mkdirSync(SHOTS, { recursive: true });

interface Problem {
  page: string;
  kind: string;
  detail: string;
}

test("walkthrough", async ({ page }) => {
  test.setTimeout(300_000);
  const problems: Problem[] = [];
  let current = "boot";

  const note = (kind: string, detail: string) => {
    problems.push({ page: current, kind, detail: detail.slice(0, 400) });
  };

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning")
      note(`console.${msg.type()}`, msg.text());
  });
  page.on("pageerror", (err) => note("pageerror", `${err.name}: ${err.message}`));
  page.on("requestfailed", (req) =>
    note("requestfailed", `${req.method()} ${req.url()} — ${req.failure()?.errorText}`),
  );
  page.on("response", (res) => {
    if (res.status() >= 400) note("http", `${res.status()} ${res.request().method()} ${res.url()}`);
  });

  const shot = async (name: string) => {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  };

  const visit = async (name: string, path: string) => {
    current = name;
    await openApp(page, path);
    await page.waitForTimeout(2000);
    await shot(name);
  };

  // --- every primary view -------------------------------------------------
  await visit("01-home", "/");
  await visit("02-chat", "/chat");
  await visit("03-automations", "/automations");
  await visit("04-knowledge", "/knowledge");
  await visit("05-settings", "/settings");

  // --- routes that must redirect -----------------------------------------
  current = "redirects";
  await page.goto("/leads");
  await page.waitForTimeout(1500);
  note("info", `/leads landed on ${new URL(page.url()).pathname}`);
  await page.goto("/does-not-exist");
  await page.waitForTimeout(1500);
  note("info", `/does-not-exist landed on ${new URL(page.url()).pathname}`);

  // --- settings, opened up ------------------------------------------------
  current = "settings-sections";
  await openApp(page, "/settings");
  await page.waitForTimeout(1500);
  const sectionButtons = page
    .locator("button")
    .filter({ hasNot: page.locator("svg[aria-hidden]") });
  const headings = await page.getByRole("button").all();
  note("info", `settings has ${headings.length} buttons`);
  for (let i = 0; i < headings.length; i++) {
    const label = (await headings[i]?.textContent())?.trim().replace(/\s+/g, " ") ?? "";
    if (!label) continue;
    note("inventory", `settings button: ${label}`);
  }
  void sectionButtons;
  // Expand every collapsed section by clicking its header row.
  for (const name of ["ai", "accounts", "preferences", "data", "about"]) {
    const header = page.locator(`[data-section="${name}"]`).first();
    if (await header.count()) await header.click().catch(() => {});
  }
  await page.waitForTimeout(1200);
  await shot("06-settings-expanded");

  // --- command palette ----------------------------------------------------
  current = "palette";
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(800);
  await shot("07-palette");
  const dialog = page.getByRole("dialog");
  note("info", `palette dialog visible: ${await dialog.isVisible().catch(() => false)}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // --- automations: open the create dialog --------------------------------
  current = "automations-create";
  await openApp(page, "/automations");
  await page.waitForTimeout(1500);
  const addButtons = await page.getByRole("button").all();
  for (const b of addButtons) {
    const label = ((await b.textContent()) ?? "").trim();
    if (/neu|hinzu|erstell|anleg/i.test(label)) {
      await b.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1200);
  await shot("08-automation-dialog");
  await page.keyboard.press("Escape");

  // --- knowledge: try creating a document ---------------------------------
  current = "knowledge-create";
  await openApp(page, "/knowledge");
  await page.waitForTimeout(1500);
  for (const b of await page.getByRole("button").all()) {
    const label = ((await b.textContent()) ?? "").trim();
    if (/neu|hinzu|erstell|anleg|upload|hochlad/i.test(label)) {
      await b.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1200);
  await shot("09-knowledge-create");
  await page.keyboard.press("Escape");

  // --- chat composer ------------------------------------------------------
  current = "chat-composer";
  await openApp(page, "/chat");
  await page.waitForTimeout(1500);
  const box = page.getByRole("textbox").first();
  if (await box.count()) {
    await box.click().catch(() => {});
    await box.fill("Testnachricht ohne Modell").catch(() => {});
  }
  await page.waitForTimeout(600);
  await shot("10-chat-typed");

  // --- sidebar collapse ---------------------------------------------------
  current = "sidebar";
  await openApp(page, "/");
  await page.waitForTimeout(1000);
  const collapse = page
    .getByRole("button", { name: /einklappen|collapse|ausklappen|expand/i })
    .first();
  if (await collapse.count()) {
    await collapse.click().catch(() => {});
    await page.waitForTimeout(700);
    await shot("11-sidebar-collapsed");
  }

  // --- dark theme ---------------------------------------------------------
  current = "theme-dark";
  await page.evaluate(() => localStorage.setItem("marlen-theme", "dark"));
  await page.reload();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot("12-home-dark");
  await openApp(page, "/settings");
  await page.waitForTimeout(1500);
  await shot("13-settings-dark");

  // biome-ignore lint/suspicious/noConsole: the exploratory run reports its findings on stdout
  console.log(`\n===PROBLEMS===\n${JSON.stringify(problems, null, 2)}\n===END===`);
});

test("@mobile walkthrough on a phone", async ({ page }) => {
  test.setTimeout(120_000);
  const problems: Problem[] = [];
  page.on("pageerror", (err) =>
    problems.push({ page: "mobile", kind: "pageerror", detail: `${err.name}: ${err.message}` }),
  );
  page.on("console", (msg) => {
    if (msg.type() === "error")
      problems.push({ page: "mobile", kind: "console.error", detail: msg.text().slice(0, 400) });
  });

  for (const [name, path] of [
    ["m1-home", "/"],
    ["m2-chat", "/chat"],
    ["m3-automations", "/automations"],
    ["m4-settings", "/settings"],
  ] as const) {
    await openApp(page, path);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  }
  // biome-ignore lint/suspicious/noConsole: the exploratory run reports its findings on stdout
  console.log(`\n===MOBILE-PROBLEMS===\n${JSON.stringify(problems, null, 2)}\n===END===`);
});
