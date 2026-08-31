import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AccountSignature, ConnectedAccount } from "@marlen/shared";
import type { Locator, Page } from "@playwright/test";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

const ACCOUNT: ConnectedAccount = {
  id: "e2e-signature-account",
  app: "gmail",
  name: "E2E Signaturkonto",
  healthy: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function openSignatureEditor(page: Page): Promise<Locator> {
  await page.route("**/api/pipedream/accounts", (route) => route.fulfill({ json: [ACCOUNT] }));
  await openApp(page, "/settings");
  await page.getByRole("button", { name: t("connections.permissions.editEmail") }).click();
  const editor = page.getByRole("textbox", { name: t("connections.signature.title") });
  await expect(editor).toBeVisible();
  return editor;
}

test("a pasted signature keeps its layout, owns its logo, and can be resized", async ({
  page,
  request,
}) => {
  const editor = await openSignatureEditor(page);
  await editor.click();

  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas context");
    context.fillStyle = "#2563eb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/html",
      `<div style="font-family:Arial"><b>Anna Muster</b><br><img src="${canvas.toDataURL("image/png")}"><img src="cid:logo@mail"></div>`,
    );
    const target = document.querySelector('[role="textbox"][contenteditable="true"]');
    target?.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  });

  await expect(page.getByText(t("connections.signature.imagesDropped_one"))).toBeVisible();
  await expect(editor.getByText("Anna Muster")).toBeVisible();

  const logo = editor.locator("img");
  await expect(logo, "the image nobody can reach is dropped, not left broken").toHaveCount(1);
  await expect(logo).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(logo).toHaveAttribute("width", "240");

  await logo.click();
  const grip = page.getByRole("button", { name: t("connections.signature.resize") });
  await grip.hover();
  const before = await logo.boundingBox();
  const corner = await grip.boundingBox();
  if (!before || !corner) throw new Error("no geometry");
  expect(Math.abs(corner.x + corner.width / 2 - (before.x + before.width))).toBeLessThan(3);
  expect(Math.abs(corner.y + corner.height / 2 - (before.y + before.height))).toBeLessThan(3);

  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x - 100, corner.y - 30, { steps: 10 });
  await page.mouse.up();

  const dragged = await logo.boundingBox();
  if (!dragged) throw new Error("no geometry");
  expect(dragged.width, "the drag narrows the logo").toBeLessThan(before.width);
  expect(Math.abs(dragged.height / dragged.width - 120 / 400)).toBeLessThan(0.02);
  const width = await logo.getAttribute("width");

  try {
    await page.getByRole("button", { name: t("connections.signature.save") }).click();
    await expect(page.getByText(t("connections.signature.saved"))).toBeVisible();

    const stored = (
      (await (await request.get("/api/settings/account-signatures")).json()) as {
        signatures: AccountSignature[];
      }
    ).signatures.find((signature) => signature.accountId === ACCOUNT.id);
    expect(stored?.html).toContain("data:image/png;base64,");
    expect(stored?.html, "the size on screen is the size stored").toContain(`width="${width}"`);
    expect(stored?.html, "an unreachable reference never reaches storage").not.toContain("cid:");
    expect(stored?.html, "the selection ring never reaches storage").not.toContain("is-selected");

    await page.reload();
    const reopened = await openSignatureEditor(page);
    await expect(reopened.locator("img")).toHaveAttribute("width", width ?? "");
  } finally {
    await request.put("/api/settings/account-signatures", { data: { signatures: [] } });
  }
});

test("an Outlook signature keeps the line spacing its own stylesheet gives it", async ({
  page,
  request,
}) => {
  const editor = await openSignatureEditor(page);
  await editor.click();

  await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/html",
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta name=Generator content="Microsoft Word 15 (filtered medium)">
<style><!--
/* Font Definitions */
@font-face {font-family:Calibri; panose-1:2 15 5 2 2 2 4 3 2 4;}
/* Style Definitions */
p.MsoNormal, li.MsoNormal, div.MsoNormal
	{margin:0cm; margin-bottom:.0001pt; font-size:11.0pt; font-family:"Calibri",sans-serif;}
a:link, span.MsoHyperlink {mso-style-priority:99; color:blue; text-decoration:underline;}
.MsoChpDefault {mso-style-type:export-only; font-size:10.0pt;}
@page WordSection1 {size:612.0pt 792.0pt; margin:70.85pt 70.85pt 2.0cm 70.85pt;}
div.WordSection1 {page:WordSection1;}
--></style></head>
<body lang=DE link=blue vlink=purple><div class=WordSection1>
<p class=MsoNormal><span style='font-size:10.0pt'>Mit freundlichen Grüßen<o:p></o:p></span></p>
<p class=MsoNormal><span style='font-size:9.0pt'>Musterstraße 12, 10115 Berlin<o:p></o:p></span></p>
<p class=MsoNormal><span style='font-size:9.0pt'>+49 (0) 30 1234567<o:p></o:p></span></p>
<p class=MsoNormal><span style='font-size:9.0pt'>anna.muster@example.com<o:p></o:p></span></p>
</div></body></html>`,
    );
    document
      .querySelector('[role="textbox"][contenteditable="true"]')
      ?.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
  });

  await expect(editor.getByText("Mit freundlichen Grüßen")).toBeVisible();
  const lines = editor.locator("p");
  await expect(lines).toHaveCount(4);

  const boxes = await lines.evaluateAll((paragraphs) =>
    paragraphs.map((p) => {
      const { top, bottom } = p.getBoundingClientRect();
      return { top, bottom };
    }),
  );
  for (const [index, box] of boxes.slice(1).entries()) {
    const previous = boxes[index];
    expect(box.top - (previous?.bottom ?? 0), `gap above line ${index + 2}`).toBeLessThan(2);
  }

  try {
    await page.getByRole("button", { name: t("connections.signature.save") }).click();
    await expect(page.getByText(t("connections.signature.saved"))).toBeVisible();

    const stored = (
      (await (await request.get("/api/settings/account-signatures")).json()) as {
        signatures: AccountSignature[];
      }
    ).signatures.find((signature) => signature.accountId === ACCOUNT.id);
    expect(stored?.html, "the stylesheet does not survive").not.toContain("<style");
    expect(stored?.html, "nor the classes that referenced it").not.toContain("class=");
    expect(stored?.html, "its spacing does").toContain("margin: 0cm");
    expect(stored?.html, "and its face").toContain("Calibri");
    expect(stored?.html, "without Word's private properties").not.toContain("mso-");
  } finally {
    await request.put("/api/settings/account-signatures", { data: { signatures: [] } });
  }
});

test("only a clipboard image is fetched for a signature, never the machine itself", async ({
  request,
  server,
}, testInfo) => {
  const clipboardDir = await mkdtemp(join(tmpdir(), "e2e-signature-"));
  const clipboardImage = join(clipboardDir, "logo.png");
  const ownImage = testInfo.outputPath("logo.png");
  await writeFile(clipboardImage, PNG_BYTES);
  await writeFile(ownImage, PNG_BYTES);

  const fetchImage = (url: string) =>
    request.post("/api/settings/signature-image", { data: { url } });

  try {
    const served = await fetchImage(pathToFileURL(clipboardImage).href);
    expect(served.status(), "the temp file an Outlook paste points at is readable").toBe(200);
    expect(((await served.json()) as { dataUri: string }).dataUri).toMatch(
      /^data:image\/png;base64,/,
    );

    const loopback = await fetchImage(`${server.baseURL}/logo.png`);
    expect(loopback.status(), "a private address is not somewhere on the web").toBe(400);

    const outside = await fetchImage(pathToFileURL(ownImage).href);
    expect(outside.status(), "a real image outside the temp folder is still a local file").toBe(
      400,
    );

    const secret = await fetchImage("file:///etc/passwd");
    expect(secret.status()).toBe(400);
  } finally {
    await rm(clipboardDir, { recursive: true, force: true });
  }
});
