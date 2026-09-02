import type { AccountDrafts, DraftRewriteResult, EmailDraftDetail, Todo } from "@marlen/shared";
import type { Page } from "@playwright/test";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

const ACCOUNT_ID = "e2e-rewrite-account";
const DRAFT_ID = "e2e-rewrite-draft";
const SUBJECT = "Re: Besichtigung Lindenstraße";
const ORIGINAL = "Guten Tag Frau Weber,\n\nDonnerstag um 14 Uhr passt gut.";
const REWRITTEN = "Hallo Frau Weber,\n\nDonnerstag 14 Uhr passt.";

/**
 * Marlen's own mailbox and model, stood in for at the network boundary: the
 * app, the reader, and every state it moves through are the real thing, while
 * this holds the draft the way a provider would, remembering what the app
 * saves so the letter on screen and the "mailbox" cannot silently disagree.
 */
async function stubMailbox(page: Page): Promise<{
  saved: () => { body?: string; subject?: string }[];
  asked: () => { instruction: string; body: string; subject: string }[];
}> {
  let body = ORIGINAL;
  let subject = SUBJECT;
  const saved: { body?: string; subject?: string }[] = [];
  const asked: { instruction: string; body: string; subject: string }[] = [];

  await page.route("**/api/drafts**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/drafts") {
      const list: AccountDrafts[] = [
        {
          account: "kadim@example.com",
          accountId: ACCOUNT_ID,
          drafts: [
            {
              id: DRAFT_ID,
              messageId: "e2e-message",
              threadId: "e2e-thread",
              subject,
              to: "s.weber@example.com",
              date: "2026-09-03T08:00:00.000Z",
              webUrl: "https://mail.example.com/e2e-rewrite-draft",
            },
          ],
        },
      ];
      return route.fulfill({ json: list });
    }

    if (path.endsWith("/rewrite")) {
      const input = request.postDataJSON() as {
        instruction: string;
        body: string;
        subject: string;
      };
      asked.push(input);
      const result: DraftRewriteResult = {
        body: REWRITTEN,
        subject: input.subject,
        diff: {
          added: 2,
          removed: 2,
          rows: [
            { op: "-", text: "Guten Tag Frau Weber," },
            { op: "+", text: "Hallo Frau Weber," },
            { op: "-", text: "Donnerstag um 14 Uhr passt gut." },
            { op: "+", text: "Donnerstag 14 Uhr passt." },
          ],
        },
      };
      return route.fulfill({ json: result });
    }

    if (request.method() === "PATCH") {
      const patch = request.postDataJSON() as { body?: string; subject?: string };
      saved.push(patch);
      if (patch.body !== undefined) body = patch.body;
      if (patch.subject !== undefined) subject = patch.subject;
      return route.fulfill({ json: { ok: true } });
    }

    const detail: EmailDraftDetail = { body, cc: "", bcc: "" };
    return route.fulfill({ json: detail });
  });

  return { saved: () => saved, asked: () => asked };
}

/** The approval Home lists for that draft, the row the rewrite action sits on. */
async function stubApproval(page: Page): Promise<void> {
  const todo: Todo = {
    id: "e2e-rewrite-approval",
    kind: "approval",
    ref: {
      kind: "email_draft",
      accountId: ACCOUNT_ID,
      account: "kadim@example.com",
      draftId: DRAFT_ID,
      to: "s.weber@example.com",
      webUrl: "https://mail.example.com/e2e-rewrite-draft",
    },
    title: SUBJECT,
    body: "",
    status: "open",
    dueAt: null,
    position: 0,
    conversationId: null,
    linkedAutomationId: null,
    options: [],
    answer: null,
    createdAt: "2026-09-03T08:00:00.000Z",
    updatedAt: "2026-09-03T08:00:00.000Z",
  };
  await page.route("**/api/todos**", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [todo] }) : route.continue(),
  );
}

function letter(page: Page) {
  return {
    body: page.getByRole("textbox", { name: t("drafts.bodyLabel") }),
    instruction: page.getByRole("textbox", { name: t("drafts.rewriteAsk") }),
  };
}

// Skipped while the instruction line is parked (REWRITE_BAR_ENABLED in
// features/drafts/RewriteBar.tsx). Both specs pass with it on.
test.describe
  .skip("the letter's instruction line", () => {
    test("rewords a draft in the letter itself, and the rewrite is kept or dropped", async ({
      page,
    }) => {
      const mailbox = await stubMailbox(page);
      await openApp(page, `/?draft=${ACCOUNT_ID}:${DRAFT_ID}`);

      const { body, instruction } = letter(page);
      await expect(body).toHaveValue(ORIGINAL);

      // The letter as it stands on screen is what gets rewritten, so a hand edit
      // made a second earlier goes along with the instruction.
      await body.click();
      await body.fill(`${ORIGINAL}\n\nDie Unterlagen bringe ich mit.`);
      await instruction.fill("kürzer");
      await instruction.press("Enter");

      await expect(body).toHaveValue(REWRITTEN);
      expect(mailbox.asked()).toHaveLength(1);
      expect(mailbox.asked()[0]?.instruction).toBe("kürzer");
      expect(mailbox.asked()[0]?.body).toContain("Die Unterlagen bringe ich mit.");
      // Asking is not saving: the mailbox has heard nothing yet.
      expect(mailbox.saved()).toEqual([]);

      // What changed is spelled out, so the letter needs no re-reading.
      await expect(
        page.getByText(t("drafts.rewriteChanges", { added: 2, removed: 2 })),
      ).toBeVisible();
      await expect(page.getByText("Guten Tag Frau Weber,", { exact: true })).toBeVisible();
      await expect(page.getByText("Hallo Frau Weber,", { exact: true })).toBeVisible();

      // Dropping it brings back the letter the user had, hand edit included.
      await page.getByRole("button", { name: t("drafts.rewriteRevert") }).click();
      await expect(body).toHaveValue(`${ORIGINAL}\n\nDie Unterlagen bringe ich mit.`);
      await expect(page.getByText("Hallo Frau Weber,", { exact: true })).toBeHidden();

      // Keeping it is the only thing that writes, and it writes what is on screen.
      await instruction.fill("kürzer");
      await instruction.press("Enter");
      await expect(body).toHaveValue(REWRITTEN);
      await page.getByRole("button", { name: t("drafts.rewriteApply") }).click();

      await expect(page.getByRole("button", { name: t("drafts.send") })).toBeVisible();
      expect(mailbox.saved()).toEqual([{ body: REWRITTEN }]);
      await expect(body).toHaveValue(REWRITTEN);
    });

    test("opens from Home's rewrite action with the caret in it", async ({ page }) => {
      await stubMailbox(page);
      await stubApproval(page);
      await openApp(page);

      // The row's verbs take no room until it is hovered.
      await page.getByRole("button", { name: new RegExp(SUBJECT) }).hover();
      await page.getByRole("button", { name: t("drafts.rewrite") }).click();

      const { body, instruction } = letter(page);
      await expect(body).toHaveValue(ORIGINAL);
      await expect(instruction).toBeFocused();
    });
  });
