import { mkdirSync, writeFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

/** TEMPORARY exploratory click-through — delete after the manual review pass. */

const SHOTS =
  "/private/tmp/claude-501/-Users-huti-Desktop-Git-Trailin/68ec1ab0-1784-443b-9ea6-a3148a2a686c/scratchpad/shots2";
mkdirSync(SHOTS, { recursive: true });

/** The shipped openApp() is strict-mode ambiguous on /knowledge (two navs). */
async function openApp(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("navigation").first()).toBeVisible();
}

interface Problem {
  where: string;
  kind: string;
  detail: string;
}

/** Wires console/pageerror/http listeners and a screenshot helper onto a page. */
function watch(page: Page, info: TestInfo) {
  const problems: Problem[] = [];
  let where = "start";
  const note = (kind: string, detail: string) =>
    problems.push({ where, kind, detail: detail.slice(0, 500) });

  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") note(`console.${m.type()}`, m.text());
  });
  page.on("pageerror", (e) => note("pageerror", `${e.name}: ${e.message}`));
  page.on("requestfailed", (r) =>
    note("requestfailed", `${r.method()} ${r.url()} — ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) note("http", `${r.status()} ${r.request().method()} ${r.url()}`);
  });

  return {
    step: (name: string) => {
      where = name;
    },
    note,
    shot: (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }),
    dump: () => {
      const label = info.title.replace(/\W+/g, "-");
      // biome-ignore lint/suspicious/noConsole: the exploratory run reports its findings on stdout
      console.log(`\n===PROBLEMS ${label}===\n${JSON.stringify(problems, null, 2)}\n===END===`);
    },
  };
}

/** Toast text, whichever variant fired. */
async function toastText(page: Page): Promise<string> {
  const toast = page.locator("[data-sonner-toast], [role='status'], [role='alert']");
  if (!(await toast.count())) return "";
  return ((await toast.first().textContent()) ?? "").replace(/\s+/g, " ").trim();
}

test("automations: create, run, pause, edit, delete", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);
  const NAME = `E2E Durchlauf ${Date.now()}`;

  w.step("open");
  await openApp(page, "/automations");

  w.step("open-create-dialog");
  await page.getByRole("button", { name: t("automations.new") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  w.step("fill-form");
  await page.locator("#automation-name").fill(NAME);
  await page.locator("#automation-instruction").fill("Antworte nur mit dem Wort Hallo.");
  await w.shot("d01-automation-form-filled");

  w.step("submit");
  await dialog.getByRole("button", { name: t("automations.create") }).click();
  await expect(dialog).toBeHidden();
  const card = page.locator("div.surface").filter({ hasText: NAME }).last();
  await expect(card).toBeVisible();
  await w.shot("d02-automation-created");

  w.step("reload-persistence");
  await openApp(page, "/automations");
  await expect(page.getByText(NAME)).toBeVisible();

  w.step("expand-runs");
  await card.getByText(t("automations.recentRuns")).click();
  await page.waitForTimeout(800);
  await w.shot("d03-automation-runs-empty");

  w.step("run-now");
  await card.getByRole("button", { name: t("automations.runNow") }).click();
  await page.waitForTimeout(4000);
  w.note("info", `toast after run: ${await toastText(page)}`);
  await w.shot("d04-automation-after-run");

  w.step("read-run-error");
  const failed = card.getByText(t("automations.runStatus.error")).first();
  if (await failed.count()) {
    await failed.click();
    await page.waitForTimeout(900);
    await w.shot("d04b-automation-run-detail");
    const detail = await card.textContent();
    w.note("info", `run row text: ${(detail ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
  } else {
    w.note("gap", "no failed run row after Jetzt ausführen without AI credentials");
  }

  w.step("pause");
  await card.getByRole("switch").click();
  await page.waitForTimeout(600);
  w.note(
    "info",
    `paused badge visible: ${await card
      .getByText(t("automations.paused"))
      .first()
      .isVisible()
      .catch(() => false)}`,
  );
  await w.shot("d05-automation-paused");

  w.step("edit");
  await card
    .getByRole("button")
    .first()
    .click({ trial: true })
    .catch(() => {});
  await page.getByText(NAME).first().click();
  await expect(dialog).toBeVisible();
  await page.locator("#automation-name").fill(`${NAME} bearbeitet`);
  await dialog.getByRole("button", { name: t("automations.save") }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${NAME} bearbeitet`)).toBeVisible();
  await w.shot("d06-automation-edited");

  w.step("delete");
  await page.getByText(`${NAME} bearbeitet`).first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: t("automations.delete") }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
  await confirm
    .getByRole("button", { name: t("automations.delete") })
    .last()
    .click();
  await page.waitForTimeout(1200);
  await expect(page.getByText(`${NAME} bearbeitet`)).toBeHidden();
  await w.shot("d07-automation-deleted");

  w.dump();
});

test("knowledge: create a note, edit it, delete it", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);
  const FILE = `e2e-notiz-${Date.now()}`;

  w.step("open");
  await openApp(page, "/knowledge");
  await page.waitForTimeout(1500);
  await w.shot("d10-knowledge");

  w.step("new-file-dialog");
  await page.getByRole("button", { name: t("storage.editor.new"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await w.shot("d11-knowledge-new-dialog");

  w.step("fill-file");
  const nameBox = dialog.getByPlaceholder(t("storage.editor.namePlaceholder"));
  await nameBox.fill(FILE);
  const editor = dialog.locator("[contenteditable='true']").first();
  if (await editor.count()) {
    await editor.click();
    await page.keyboard.type("Testinhalt aus dem Durchlauf.");
  } else {
    w.note("gap", "no contenteditable body in the create dialog");
  }
  await w.shot("d12-knowledge-filled");

  w.step("save-file");
  await dialog.getByRole("button", { name: t("storage.editor.save") }).click();
  await page.waitForTimeout(1500);
  w.note("info", `toast after save: ${await toastText(page)}`);
  await w.shot("d13-knowledge-saved");
  w.note(
    "info",
    `visible in the root listing right after save: ${await page.getByText(FILE).count()}`,
  );

  w.step("where-did-it-land");
  const api = await page.evaluate(async () => {
    const res = await fetch("/api/library");
    return { status: res.status, body: (await res.text()).slice(0, 1200) };
  });
  w.note("info", `GET /api/library → ${api.status} ${api.body}`);
  await page.getByText("knowledge", { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await w.shot("d14-knowledge-folder");
  w.note("info", `visible inside knowledge/: ${await page.getByText(FILE).count()}`);

  w.step("recently-changed");
  await page.getByText(t("storage.nav.recent")).first().click();
  await page.waitForTimeout(1200);
  await w.shot("d15-knowledge-recent");
  w.note("info", `visible under recent: ${await page.getByText(FILE).count()}`);

  w.step("reopen-file");
  const row = page.getByText(FILE).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1200);
    await w.shot("d16-knowledge-reopened");
    const body = page.getByRole("dialog").locator("[contenteditable='true']").first();
    if (await body.count()) {
      w.note("info", `body after reopen: ${((await body.textContent()) ?? "").slice(0, 120)}`);
    }
    await page.keyboard.press("Escape");
  }

  w.step("global-search-finds-it");
  await page
    .getByRole("button", { name: t("search.openButton") })
    .first()
    .click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(t("search.placeholder")).fill("Testinhalt");
  await page.waitForTimeout(2500);
  await w.shot("d17-knowledge-global-search");
  w.note("info", `search hit for the new note: ${await page.getByText(FILE).count()}`);
  await page.keyboard.press("Escape");

  w.dump();
});

test("home: add a todo, edit it, complete it", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);
  const TITLE = `E2E Aufgabe ${Date.now()}`;

  w.step("open");
  await openApp(page, "/");
  await page.waitForTimeout(1200);

  w.step("add-todo");
  await page
    .getByRole("button", { name: t("home.todosAdd") })
    .first()
    .click();
  const input = page.getByPlaceholder(t("home.todosAddPlaceholder"));
  await expect(input).toBeVisible();
  await input.fill(TITLE);
  await input.press("Enter");
  await page.waitForTimeout(1200);
  await expect(page.getByText(TITLE)).toBeVisible();
  await w.shot("d20-todo-created");

  w.step("reload-persistence");
  await openApp(page, "/");
  await page.waitForTimeout(1500);
  await expect(page.getByText(TITLE)).toBeVisible();

  w.step("edit-todo");
  const row = page.locator("li, div").filter({ hasText: TITLE }).last();
  const editBtn = page.getByRole("button", { name: t("home.todosEdit") }).first();
  if (await editBtn.count()) {
    await editBtn.click();
    await page.waitForTimeout(800);
    await w.shot("d21-todo-editing");
    const noteBox = page.getByPlaceholder(t("home.todosBodyPlaceholder"));
    if (await noteBox.count()) {
      await noteBox.fill("Notiz aus dem Durchlauf");
      await page.waitForTimeout(1200);
    } else {
      w.note("gap", "no note field while editing a todo");
    }
    const due = page.getByRole("button", { name: t("home.todosDueDate") }).first();
    if (await due.count()) {
      await due.click();
      await page.waitForTimeout(700);
      await w.shot("d22-todo-duepicker");
      await page.keyboard.press("Escape");
    }
    const done = page.getByRole("button", { name: t("home.todosEditDone") }).first();
    if (await done.count()) await done.click();
    await page.waitForTimeout(800);
  } else {
    w.note("gap", `no edit button on the todo row (${await row.count()} candidate rows)`);
  }
  await w.shot("d23-todo-edited");

  w.step("complete-todo");
  // The input is sr-only; the visible box is its sibling span, so click the label.
  const check = page.getByRole("checkbox", { name: TITLE }).first();
  if (await check.count()) {
    await check.click({ force: true });
    await page.waitForTimeout(3000);
  } else {
    w.note("gap", "no checkbox found for the todo");
  }
  await w.shot("d24-todo-completed");
  w.note("info", `todo still on the agenda: ${await page.getByText(TITLE).count()}`);
  const doneGroup = page.getByText(t("home.todosDone_one")).first();
  w.note("info", `done group: ${await doneGroup.isVisible().catch(() => false)}`);

  w.step("reopen-done-group");
  if (await doneGroup.isVisible().catch(() => false)) {
    await doneGroup.click();
    await page.waitForTimeout(1000);
    await w.shot("d24b-todo-done-group");
    const restore = page.getByRole("checkbox", { name: t("home.todosRestore") }).first();
    if (await restore.count()) {
      await restore.click({ force: true });
      await page.waitForTimeout(2000);
      await w.shot("d24c-todo-restored");
      w.note("info", `restored back onto the agenda: ${await page.getByText(TITLE).count()}`);
    }
  }

  w.step("activity");
  const activity = page.getByText(t("home.activityTitle")).first();
  if (await activity.count()) {
    await activity.click();
    await page.waitForTimeout(1500);
    await w.shot("d25-home-activity");
  }

  w.dump();
});

test("settings: preferences round-trip", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);

  w.step("open");
  await openApp(page, "/settings");
  await page.waitForTimeout(2000);
  await w.shot("d30-settings");

  w.step("appearance");
  const appearance = page.locator("#settings-appearance");
  if (await appearance.count()) {
    await appearance.click();
    await page.waitForTimeout(600);
    await w.shot("d31-appearance-open");
    await page.keyboard.press("Escape");
  } else {
    w.note("gap", "no #settings-appearance control");
  }

  w.step("quick-actions");
  const quick = page.locator("#settings-quick-actions");
  if (await quick.count()) {
    await quick.click();
    await page.waitForTimeout(600);
    await w.shot("d32-quickactions-open");
    await page.keyboard.press("Escape");
  }

  w.step("language-to-en");
  const language = page.locator("#settings-language");
  if (await language.count()) {
    await language.click();
    await page.waitForTimeout(500);
    const english = page.getByRole("option", { name: /english/i }).first();
    if (await english.count()) {
      await english.click();
      await page.waitForTimeout(2000);
      await w.shot("d33-settings-english");
      // back to German so later steps still match the pinned language
      await page.locator("#settings-language").click();
      await page.waitForTimeout(500);
      const german = page.getByRole("option", { name: /deutsch|german/i }).first();
      if (await german.count()) await german.click();
      await page.waitForTimeout(1500);
      await w.shot("d34-settings-back-to-german");
    } else {
      w.note("gap", "no English option in the language select");
    }
  }

  w.step("timezone");
  const tz = page.locator("#settings-timezone");
  if (await tz.count()) {
    await tz.click();
    await page.waitForTimeout(700);
    await w.shot("d35-timezone-open");
    await page.keyboard.press("Escape");
  }

  w.step("about-and-data");
  await page.getByText(t("settings.sections.about.title")).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await w.shot("d36-settings-bottom");

  w.dump();
});

test("chat: composer, history, model control, send without credentials", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);

  w.step("open");
  await openApp(page, "/chat");
  await page.waitForTimeout(1500);
  await w.shot("d40-chat");

  w.step("model-control");
  const composer = page.getByPlaceholder(t("chat.placeholder")).first();
  const ring = page.getByRole("button", { name: t("chat.model.buttonLabel") }).first();
  if (await ring.count()) {
    await ring.click();
    await page.waitForTimeout(900);
    await w.shot("d41-model-popover");
    await page.keyboard.press("Escape");
  } else {
    w.note("gap", `no model control button named "${t("chat.model.buttonLabel")}"`);
  }

  w.step("voice");
  const voice = page.getByRole("button", { name: t("chat.voice.start") }).first();
  if (await voice.count()) {
    await voice.click();
    await page.waitForTimeout(1500);
    await w.shot("d42-voice");
    w.note("info", `voice toast: ${await toastText(page)}`);
    await page.keyboard.press("Escape");
  } else {
    w.note("gap", `no voice button named "${t("chat.voice.start")}"`);
  }

  w.step("send-without-credentials");
  await composer.click();
  await composer.fill("Was steht heute an?");
  await w.shot("d43-chat-typed");
  await page
    .getByRole("button", { name: t("chat.send") })
    .first()
    .click();
  await page.waitForTimeout(6000);
  w.note("info", `send toast: ${await toastText(page)}`);
  await w.shot("d44-chat-after-send");

  w.step("history");
  const history = page.getByRole("button", { name: t("chat.history") }).first();
  if (await history.count()) {
    await history.click();
    await page.waitForTimeout(1200);
    await w.shot("d45-chat-history");
  } else {
    w.note("gap", `no history button named "${t("chat.history")}"`);
  }

  w.step("new-conversation");
  const fresh = page.getByRole("button", { name: t("chat.newConversation") }).first();
  if (await fresh.count()) {
    await fresh.click();
    await page.waitForTimeout(1200);
    await w.shot("d46-chat-new");
  }

  w.dump();
});

test("shell: search, command palette, sidebar, deep links", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);

  w.step("global-search");
  await openApp(page, "/");
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: t("search.openButton") })
    .first()
    .click();
  const search = page.getByPlaceholder(t("search.placeholder")).first();
  await expect(search).toBeVisible();
  await search.fill("Morgenbriefing");
  await page.waitForTimeout(2500);
  await w.shot("d50-search-results");
  w.note(
    "info",
    `no-results copy shown: ${await page.getByText(t("search.noResults", { q: "Morgenbriefing" })).count()}`,
  );
  await search.fill("zzzz-kein-treffer");
  await page.waitForTimeout(2000);
  await w.shot("d50b-search-empty");
  await page.keyboard.press("Escape");

  w.step("palette-navigate");
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(800);
  await w.shot("d51-palette");
  await page.keyboard.type("Wissen");
  await page.waitForTimeout(900);
  await w.shot("d52-palette-typed");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  w.note("info", `palette Enter landed on ${new URL(page.url()).pathname}`);
  await w.shot("d53-palette-navigated");

  w.step("sidebar-collapse-persists");
  await openApp(page, "/");
  const collapse = page
    .getByRole("button", {
      name: new RegExp(`${t("sidebar.collapse")}|${t("sidebar.expand")}`, "i"),
    })
    .first();
  if (await collapse.count()) {
    await collapse.click();
    await page.waitForTimeout(800);
    await w.shot("d54-sidebar-collapsed");
    await page.reload();
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await page.waitForTimeout(1000);
    await w.shot("d55-sidebar-after-reload");
    const again = page
      .getByRole("button", {
        name: new RegExp(`${t("sidebar.collapse")}|${t("sidebar.expand")}`, "i"),
      })
      .first();
    if (await again.count()) await again.click();
  } else {
    w.note("gap", "no sidebar collapse button");
  }

  w.step("deep-links");
  for (const path of [
    "/settings?section=accounts",
    "/chat/does-not-exist",
    "/knowledge?focus=nope",
  ]) {
    await page.goto(path);
    await page.waitForTimeout(1500);
    w.note("info", `${path} → ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
    await w.shot(`d56-deep${path.replace(/\W+/g, "-")}`);
  }

  w.dump();
});

test("@mobile drawer, chat slide-over, and forms", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);

  w.step("home");
  await openApp(page, "/");
  await page.waitForTimeout(1500);
  await w.shot("m10-home");

  w.step("open-drawer");
  const menu = page.getByRole("button", { name: new RegExp(t("app.openMenu"), "i") }).first();
  if (await menu.count()) {
    await menu.click();
    await page.waitForTimeout(900);
    await w.shot("m11-drawer-open");
    await page
      .getByRole("link", { name: t("views.automations.title") })
      .first()
      .click();
    await page.waitForTimeout(1500);
    await w.shot("m12-after-nav");
  } else {
    w.note("gap", `no mobile menu button named "${t("app.openMenu")}"`);
  }

  w.step("automation-form-on-phone");
  await openApp(page, "/automations");
  await page.waitForTimeout(1200);
  const add = page.getByRole("button", { name: t("automations.new") }).first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(1000);
    await w.shot("m13-automation-form");
    await page.keyboard.press("Escape");
  }

  w.step("chat-slide-over");
  await openApp(page, "/chat");
  await page.waitForTimeout(1500);
  await w.shot("m14-chat");
  const composer = page.getByPlaceholder(t("chat.placeholder")).first();
  if (await composer.count()) {
    await composer.click();
    await composer.fill("Hallo vom Telefon");
    await page.waitForTimeout(600);
    await w.shot("m15-chat-typed");
  } else {
    w.note("gap", "no chat composer on the phone viewport");
  }

  w.step("settings");
  await openApp(page, "/settings");
  await page.waitForTimeout(2000);
  await w.shot("m16-settings");

  w.dump();
});

test("knowledge: folder, upload, views, and deletion", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);
  const FOLDER = `e2e-ordner-${Date.now()}`;

  w.step("open");
  await openApp(page, "/knowledge");
  await page.waitForTimeout(1500);

  w.step("create-folder");
  await page.getByRole("button", { name: t("storage.editor.new"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByText(t("storage.editor.kinds.folder"), { exact: true }).click();
  await page.waitForTimeout(400);
  await dialog.getByPlaceholder(t("storage.editor.namePlaceholder")).fill(FOLDER);
  await w.shot("e01-folder-dialog");
  await dialog.getByRole("button", { name: t("storage.editor.save") }).click();
  await page.waitForTimeout(1500);
  await w.shot("e02-folder-created");
  w.note("info", `folder visible after create: ${await page.getByText(FOLDER).count()}`);

  w.step("upload");
  // Written here rather than pointed at: a probe file outside the run's own
  // output folder is a path that only exists on the machine that wrote it.
  const probe = info.outputPath("upload-probe.md");
  writeFileSync(probe, "# Upload-Probe\n\nEine Datei fuer den Wissens-Upload.\n");
  await page.locator("input[type=file]").setInputFiles(probe);
  await page.waitForTimeout(3000);
  await w.shot("e03-uploaded");
  w.note("info", `upload toast: ${await toastText(page)}`);
  w.note("info", `upload visible: ${await page.getByText("upload-probe").count()}`);

  w.step("grid-view");
  const grid = page.getByRole("button", { name: t("storage.view.grid") }).first();
  if (await grid.count()) {
    await grid.click();
    await page.waitForTimeout(900);
    await w.shot("e04-grid-view");
    await page
      .getByRole("button", { name: t("storage.view.list") })
      .first()
      .click();
    await page.waitForTimeout(600);
  } else {
    w.note("gap", "no grid view toggle");
  }

  w.step("sort");
  const sort = page.getByRole("combobox").first();
  if (await sort.count()) {
    await sort.click();
    await page.waitForTimeout(600);
    await w.shot("e05-sort-open");
    await page.keyboard.press("Escape");
  }

  w.step("file-search");
  const fileSearch = page.getByPlaceholder(t("storage.searchPlaceholder")).first();
  if (await fileSearch.count()) {
    await fileSearch.fill("upload-probe");
    await page.waitForTimeout(2000);
    await w.shot("e06-file-search");
    w.note("info", `hits for upload-probe: ${await page.getByText("upload-probe").count()}`);
    await fileSearch.fill("");
    await page.waitForTimeout(800);
  }

  w.step("delete-upload");
  const row = page.getByText("upload-probe").first();
  if (await row.count()) {
    await row.hover();
    await page.waitForTimeout(300);
    const del = page.getByRole("button", { name: t("storage.actions.delete") }).first();
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(700);
      await w.shot("e07-delete-confirm");
      const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
      await confirm
        .getByRole("button", { name: t("library.delete") })
        .last()
        .click();
      await page.waitForTimeout(2000);
      await w.shot("e08-after-delete");
      w.note("info", `upload still listed: ${await page.getByText("upload-probe").count()}`);
    } else {
      w.note("gap", "no per-row delete button on hover");
    }
  }

  w.dump();
});

test("chat: history management and scope picker", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);

  w.step("seed-a-conversation");
  await openApp(page, "/chat");
  await page.waitForTimeout(1200);
  const composer = page.getByPlaceholder(t("chat.placeholder")).first();
  await composer.fill("Erste Testunterhaltung");
  await page
    .getByRole("button", { name: t("chat.send") })
    .first()
    .click();
  await page.waitForTimeout(4000);

  w.step("scope-picker");
  const scope = page
    .getByRole("button", { name: new RegExp(t("home.approvalsAllAccounts"), "i") })
    .first();
  if (await scope.count()) {
    await scope.click();
    await page.waitForTimeout(800);
    await w.shot("e10-chat-scope");
    await page.keyboard.press("Escape");
  } else {
    w.note("gap", "no account scope picker in the chat header");
  }

  w.step("history-row-menu");
  await page.waitForTimeout(800);
  const row = page.getByText("Erste Testunterhaltung").first();
  if (await row.count()) {
    await row.hover();
    await page.waitForTimeout(400);
    await w.shot("e11-history-hover");
    const rename = page.getByRole("button", { name: t("chat.rename") }).first();
    const menu = page.getByRole("button", { name: /mehr|more|optionen/i }).first();
    if (await rename.count()) {
      await rename.click();
    } else if (await menu.count()) {
      await menu.click();
      await page.waitForTimeout(600);
      await w.shot("e12-history-menu");
      const item = page.getByRole("menuitem", { name: t("chat.rename") }).first();
      if (await item.count()) await item.click();
    } else {
      w.note("gap", "no rename affordance on a history row");
    }
    await page.waitForTimeout(800);
    await w.shot("e13-history-rename");
    await page.keyboard.press("Escape");
  }

  w.step("delete-conversation");
  const del = page.getByRole("button", { name: t("chat.delete") }).first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(800);
    await w.shot("e14-delete-conversation");
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
    const yes = confirm.getByRole("button", { name: t("chat.delete") }).last();
    if (await yes.count()) {
      await yes.click();
      await page.waitForTimeout(1500);
      await w.shot("e15-after-delete");
    }
  } else {
    w.note("gap", "no delete affordance for a conversation");
  }

  w.dump();
});

test("settings: AI key dialog, file access, backup, changelog", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);

  w.step("open");
  await openApp(page, "/settings");
  await page.waitForTimeout(2000);

  w.step("api-key-dialog");
  const addKey = page.getByRole("button", { name: t("settings.addApiKey") }).first();
  if (await addKey.count()) {
    await addKey.click();
    await page.waitForTimeout(900);
    await w.shot("e20-api-key-dialog");
    const providerSelect = page.getByRole("dialog").getByRole("combobox").first();
    if (await providerSelect.count()) {
      await providerSelect.click();
      await page.waitForTimeout(700);
      await w.shot("e21-api-key-providers");
      await page.keyboard.press("Escape");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } else {
    w.note("gap", `no "${t("settings.addApiKey")}" button`);
  }

  w.step("file-access-toggles");
  const readSwitch = () =>
    page.getByRole("switch", { name: t("settings.fileAccess.read.title") }).first();
  if (await readSwitch().count()) {
    await readSwitch().click();
    await page.waitForTimeout(1200);
    await w.shot("e22-file-access-confirm");
    // The whole-filesystem grants are armed: a confirm dialog stands between
    // the switch and the write.
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
    w.note("info", `confirm dialog shown: ${await confirm.isVisible().catch(() => false)}`);
    await confirm.getByRole("button", { name: t("settings.fileAccess.read.confirmCta") }).click();
    await page.waitForTimeout(1500);
    await w.shot("e22b-file-access-on");
    w.note("info", `read toggle after confirm: ${await readSwitch().getAttribute("aria-checked")}`);
    w.note(
      "info",
      `on-copy visible: ${await page.getByText(t("settings.fileAccess.read.on")).count()}`,
    );

    await page.reload();
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await page.waitForTimeout(2000);
    w.note("info", `read toggle after reload: ${await readSwitch().getAttribute("aria-checked")}`);

    // Turning a grant back off must not need a confirmation.
    await readSwitch().click();
    await page.waitForTimeout(1500);
    w.note(
      "info",
      `read toggle after switching off: ${await readSwitch().getAttribute("aria-checked")}`,
    );
    await w.shot("e22c-file-access-off-again");
  } else {
    w.note("gap", "no file access switches");
  }

  w.step("backup");
  const backup = page.getByRole("button", { name: t("settings.backup.cta") }).first();
  if (await backup.count()) {
    const popup = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
    const download = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await backup.click();
    const [p, d] = await Promise.all([popup, download]);
    w.note("info", `backup click → popup:${!!p} download:${d ? d.suggestedFilename() : "none"}`);
    if (p) await p.close();
    await page.waitForTimeout(800);
    await w.shot("e23-after-backup");
  } else {
    w.note("gap", "no backup download button");
  }

  w.step("changelog");
  const changelog = page.getByRole("button", { name: t("changelog.open") }).first();
  if (await changelog.count()) {
    await changelog.click();
    await page.waitForTimeout(1500);
    await w.shot("e24-changelog");
    w.note(
      "info",
      `changelog dialog: ${await page
        .getByRole("dialog")
        .isVisible()
        .catch(() => false)}`,
    );
    await page.keyboard.press("Escape");
  } else {
    w.note("gap", "no changelog button");
  }

  w.dump();
});

test("dark mode: the same flows, repainted", async ({ page }, info) => {
  test.setTimeout(180_000);
  const w = watch(page, info);

  w.step("switch-to-dark");
  await openApp(page, "/");
  await page.evaluate(() => localStorage.setItem("marlen-theme", "dark"));
  await page.reload();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await page.waitForTimeout(1500);

  w.step("dark-automation-dialog");
  await openApp(page, "/automations");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: t("automations.new") }).click();
  await page.waitForTimeout(900);
  await w.shot("e30-dark-automation-dialog");
  await page.keyboard.press("Escape");

  w.step("dark-knowledge-editor");
  await openApp(page, "/knowledge");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: t("storage.editor.new"), exact: true }).click();
  await page.waitForTimeout(900);
  await w.shot("e31-dark-file-dialog");
  await page.keyboard.press("Escape");

  w.step("dark-palette-and-search");
  await openApp(page, "/");
  await page
    .getByRole("button", { name: t("search.openButton") })
    .first()
    .click();
  await page.waitForTimeout(700);
  await w.shot("e32-dark-palette");
  await page.keyboard.press("Escape");

  w.step("dark-chat");
  await openApp(page, "/chat");
  await page.waitForTimeout(1500);
  await w.shot("e33-dark-chat");

  w.step("dark-settings");
  await openApp(page, "/settings");
  await page.waitForTimeout(2000);
  await w.shot("e34-dark-settings");

  w.dump();
});
