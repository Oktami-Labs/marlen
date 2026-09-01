import type { ConnectedAccount } from "@marlen/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyCalls: { method: string; url: string; body?: unknown }[] = [];

vi.mock("../../src/integrations/pipedream/connect.js", () => ({
  proxyRequest: async (
    _accountId: string,
    method: string,
    url: string,
    opts?: { body?: unknown },
  ) => {
    proxyCalls.push({ method, url, ...(opts?.body !== undefined ? { body: opts.body } : {}) });
    return { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };
  },
}));

import { gmailDraftProvider } from "../../src/email/gmail/drafts.js";
import { outgoingBody } from "../../src/email/signature.js";

const account = { id: "acc-1", app: "gmail", name: "user@example.com" } as ConnectedAccount;

function sentRawMime(): string {
  const call = proxyCalls.find((c) => c.method === "post");
  if (!call) throw new Error("no draft post call was proxied");
  const raw = (call.body as { message: { raw: string } }).message.raw;
  return Buffer.from(raw, "base64url").toString("utf8");
}

/** The decoded content of the first part with this content type. */
function part(mime: string, contentType: string): string {
  const start = mime.indexOf(`Content-Type: ${contentType}`);
  if (start < 0) throw new Error(`no ${contentType} part:\n${mime}`);
  const bodyStart = mime.indexOf("\r\n\r\n", start) + 4;
  const end = mime.indexOf("\r\n--", bodyStart);
  const encoded = mime.slice(bodyStart, end < 0 ? undefined : end).trim();
  return Buffer.from(encoded, "base64").toString("utf8");
}

/** Drafts leave as html so the agent's markdown arrives as formatting, with the
 *  source alongside it for clients that show only text. */
describe("a drafted body with markdown", () => {
  beforeEach(() => {
    proxyCalls.length = 0;
  });

  it("sends the rendered html and the markdown source as alternatives", async () => {
    const source = "Hallo Herr Brandt,\n\ndas Angebot ist **bis Freitag** gültig.\n\nBeste Grüße";

    await gmailDraftProvider.createDraft(account, {
      to: ["t.brandt@acme-gmbh.de"],
      subject: "Angebot",
      ...outgoingBody(source, undefined),
    });

    const mime = sentRawMime();
    expect(mime).toContain("Content-Type: multipart/alternative");
    expect(part(mime, "text/plain")).toBe(source);

    const html = part(mime, "text/html");
    expect(html).toContain("<strong>bis Freitag</strong>");
    expect(html).not.toContain("**");
  });

  it("appends the signature to both alternatives", async () => {
    await gmailDraftProvider.createDraft(account, {
      to: ["t.brandt@acme-gmbh.de"],
      subject: "Angebot",
      ...outgoingBody("Kurz und gut.", "<p>Selin Kaya<br>Nordwind Studio</p>"),
    });

    const mime = sentRawMime();
    expect(part(mime, "text/plain")).toContain("Selin Kaya");
    expect(part(mime, "text/html")).toContain("Nordwind Studio");
  });

  it("leaves prose that only looks like markup alone", async () => {
    await gmailDraftProvider.createDraft(account, {
      to: ["t.brandt@acme-gmbh.de"],
      subject: "Rechnung",
      ...outgoingBody("Betrag 5 * 3 EUR, Rabatt 10 % < 20 %.", undefined),
    });

    const html = part(sentRawMime(), "text/html");
    expect(html).toContain("5 * 3 EUR");
    expect(html).toContain("10 % &lt; 20 %");
    expect(html).not.toContain("<em>");
  });

  it("refuses a link target that is not a web or mail address", async () => {
    await gmailDraftProvider.createDraft(account, {
      to: ["t.brandt@acme-gmbh.de"],
      subject: "Link",
      // A link target reaches here from the model, so a script URL must never
      // become an href in the recipient's client.
      ...outgoingBody("[Angebot](https://acme.test/a) und [böse](javascript:alert(1))", undefined),
    });

    const html = part(sentRawMime(), "text/html");
    expect(html).toContain('<a href="https://acme.test/a">Angebot</a>');
    // The refused one stays literal text rather than becoming a link.
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("[böse](javascript:alert(1))");
  });
});
