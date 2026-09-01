import type { ConnectedAccount } from "@marlen/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyCalls: { method: string; url: string; body?: unknown }[] = [];
let draftGetResponse: unknown = { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };

vi.mock("../../src/integrations/pipedream/connect.js", () => ({
  proxyRequest: async (
    _accountId: string,
    method: string,
    url: string,
    opts?: { body?: unknown },
  ) => {
    proxyCalls.push({ method, url, ...(opts?.body !== undefined ? { body: opts.body } : {}) });
    if (method === "get") return draftGetResponse;
    return { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };
  },
}));

import { gmailDraftProvider } from "../../src/email/gmail/drafts.js";
import { htmlBodyWithSignature } from "../../src/email/textUtils.js";

const account = { id: "acc-1", app: "gmail", name: "user@example.com" } as ConnectedAccount;

function sentRawMime(method = "post"): string {
  const call = proxyCalls.find((c) => c.method === method);
  if (!call) throw new Error(`no draft ${method} call was proxied`);
  const raw = (call.body as { message: { raw: string } }).message.raw;
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("gmail drafts with inline signature images", () => {
  beforeEach(() => {
    proxyCalls.length = 0;
  });

  it("embeds cid images as multipart/related parts referenced by the html body", async () => {
    const pixel = "iVBORw0KGgoAAAANSUhEUg==";
    const { html, images } = htmlBodyWithSignature(
      "Hallo Frau Beispiel",
      `<p>Max Mustermann</p><img src="data:image/png;base64,${pixel}">`,
    );

    await gmailDraftProvider.createDraft(account, {
      to: ["empfaenger@example.com"],
      subject: "Exposé",
      body: html,
      bodyFormat: "html",
      inlineImages: images,
    });

    const mime = sentRawMime();
    expect(mime).toContain('Content-Type: multipart/related; boundary="');
    expect(mime).toContain(`Content-ID: <${images[0]?.contentId}>`);
    expect(mime).toContain("Content-Disposition: inline;");
    // The html body part is a single base64 line; decoded it references the cid.
    expect(mime).toContain(Buffer.from(html, "utf8").toString("base64"));
    expect(html).toContain(`cid:${images[0]?.contentId}`);
    expect(mime).toContain(images[0]?.content.toString("base64"));
  });

  it("nests the related body inside multipart/mixed when files are attached", async () => {
    const { html, images } = htmlBodyWithSignature(
      "Anbei das Exposé.",
      '<p>Max</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">',
    );

    await gmailDraftProvider.createDraft(account, {
      to: ["empfaenger@example.com"],
      subject: "Exposé",
      body: html,
      bodyFormat: "html",
      inlineImages: images,
      attachments: [
        { filename: "expose.pdf", mimeType: "application/pdf", content: Buffer.from("pdf") },
      ],
    });

    const mime = sentRawMime();
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="');
    expect(mime).toContain('Content-Type: multipart/related; boundary="');
    expect(mime.indexOf("multipart/mixed")).toBeLessThan(mime.indexOf("multipart/related"));
    expect(mime).toContain('Content-Disposition: attachment; filename="expose.pdf"');
  });
});

/**
 * Gmail's drafts.update replaces the whole message, so everything the caller
 * does not override has to be carried over verbatim. An edit that touches only
 * the subject must leave the html body and the signature's inline images
 * exactly as they were, rebuilding them from the plain-text reading would
 * strip the signature's formatting and drop its images for good.
 */
describe("gmail draft updates", () => {
  const PIXEL = "iVBORw0KGgoAAAANSUhEUg==";
  const CONTENT_ID = "abc123@marlen";

  /** A drafts.get payload shaped like a draft this app created with a signature. */
  function signedDraftPayload(html: string) {
    return {
      message: {
        id: "msg-1",
        threadId: "thread-1",
        payload: {
          mimeType: "multipart/related",
          headers: [
            { name: "To", value: "empfaenger@example.com" },
            { name: "Subject", value: "Alter Betreff" },
            { name: "MIME-Version", value: "1.0" },
          ],
          parts: [
            {
              mimeType: "text/html",
              body: { data: Buffer.from(html, "utf8").toString("base64url") },
            },
            {
              mimeType: "image/png",
              filename: "signature-1.png",
              headers: [
                { name: "Content-ID", value: `<${CONTENT_ID}>` },
                { name: "Content-Disposition", value: 'inline; filename="signature-1.png"' },
              ],
              body: { data: Buffer.from(PIXEL, "base64").toString("base64url") },
            },
          ],
        },
      },
    };
  }

  beforeEach(() => {
    proxyCalls.length = 0;
    draftGetResponse = signedDraftPayload(
      `<div style="font-family:x">Hallo<br><br><p>Max Mustermann</p><img src="cid:${CONTENT_ID}"></div>`,
    );
  });

  it("keeps the html body and its inline images when only the subject changes", async () => {
    await gmailDraftProvider.updateDraft?.(account, "draft-1", { subject: "Neuer Betreff" });

    const mime = sentRawMime("put");
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
    expect(mime).toContain(`Content-ID: <${CONTENT_ID}>`);
    expect(mime).toContain('Content-Type: multipart/related; boundary="');
    // The html survives beside its text twin rather than being flattened into it.
    expect(mime).toContain("Content-Type: multipart/alternative");
    // The signature image stays an inline part, never a file attachment.
    expect(mime).not.toContain("Content-Disposition: attachment");
  });

  it("replaces the body and its inline images when the caller sends a new one", async () => {
    const { html, images } = htmlBodyWithSignature("Neuer Text", "<p>Max</p>");
    await gmailDraftProvider.updateDraft?.(account, "draft-1", {
      body: html,
      bodyFormat: "html",
      inlineImages: images,
    });

    const mime = sentRawMime("put");
    expect(mime).toContain(Buffer.from(html, "utf8").toString("base64"));
    expect(mime).not.toContain(`Content-ID: <${CONTENT_ID}>`);
  });
});
