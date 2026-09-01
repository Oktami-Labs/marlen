import type { ConnectedAccount } from "@marlen/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyCalls: { method: string; body?: unknown }[] = [];

vi.mock("../../src/integrations/pipedream/connect.js", () => ({
  proxyRequest: async (
    _accountId: string,
    method: string,
    _url: string,
    opts?: { body?: unknown },
  ) => {
    proxyCalls.push({ method, ...(opts?.body !== undefined ? { body: opts.body } : {}) });
    if (method === "get") {
      return {
        message: {
          id: "msg-1",
          threadId: "thread-1",
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "To", value: "markus@example.se" },
              { name: "Cc", value: "julia@example.de" },
              { name: "Subject", value: "Workshop" },
            ],
            body: { data: Buffer.from("Hallo Markus", "utf8").toString("base64url") },
          },
        },
      };
    }
    return { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };
  },
}));

import { gmailDraftProvider } from "../../src/email/gmail/drafts.js";

const account = { id: "acc-1", app: "gmail", name: "user@example.com" } as ConnectedAccount;

function updatedMime(): string {
  const call = proxyCalls.find((c) => c.method === "put");
  if (!call) throw new Error("no draft update was proxied");
  const raw = (call.body as { message: { raw: string } }).message.raw;
  return Buffer.from(raw, "base64url").toString("utf8");
}

/**
 * Who a draft goes to is the one field where a silent failure sends mail to the
 * wrong person, so an edit must reach the mailbox and an untouched field must
 * survive an unrelated edit.
 */
describe("editing a draft's recipients", () => {
  beforeEach(() => {
    proxyCalls.length = 0;
  });

  it("replaces the addressed field and leaves the others as they were", async () => {
    await gmailDraftProvider.updateDraft?.(account, "draft-1", {
      to: ["Markus Lindqvist <markus@example.se>", "neu@example.com"],
    });

    const mime = updatedMime();
    expect(mime).toContain("To: Markus Lindqvist <markus@example.se>, neu@example.com");
    expect(mime).toContain("Cc: julia@example.de");
  });

  it("adds a Bcc the draft did not have", async () => {
    await gmailDraftProvider.updateDraft?.(account, "draft-1", { bcc: ["still@example.com"] });

    expect(updatedMime()).toContain("Bcc: still@example.com");
  });

  it("clears a field the user emptied", async () => {
    await gmailDraftProvider.updateDraft?.(account, "draft-1", { cc: [] });

    const mime = updatedMime();
    expect(mime).not.toContain("Cc:");
    expect(mime).toContain("To: markus@example.se");
  });

  it("keeps every recipient when only the subject changes", async () => {
    await gmailDraftProvider.updateDraft?.(account, "draft-1", { subject: "Neuer Betreff" });

    const mime = updatedMime();
    expect(mime).toContain("To: markus@example.se");
    expect(mime).toContain("Cc: julia@example.de");
  });
});
