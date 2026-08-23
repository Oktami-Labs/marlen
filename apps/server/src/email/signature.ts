import { getAccountSignatures } from "../db/settings.js";
import type { DraftDetail } from "./providers.js";
import { detachSignature, htmlBodyWithSignature, stripHtml, withCidImages } from "./textUtils.js";

/**
 * The account's configured signature HTML at call time (settings are cached in
 * memory), or undefined. The signature is appended at the provider boundary
 * only: snapshots, cards, and the learning loop all keep the clean body.
 */
export async function accountSignatureHtml(accountId: string): Promise<string | undefined> {
  const signatures = await getAccountSignatures();
  return signatures.find((s) => s.accountId === accountId)?.html;
}

/** Provider body fields for a draft body: the styled html wrapper plus its cid images when the account has a signature, the plain body untouched otherwise. */
export function outgoingBody(body: string, signatureHtml: string | undefined) {
  if (!signatureHtml) return { body };
  const { html, images } = htmlBodyWithSignature(body, signatureHtml);
  return { body: html, bodyFormat: "html" as const, inlineImages: images };
}

/**
 * The prose above the account signature and the signature's text, or null when
 * the draft body does not carry the signature (hand-written, or written before
 * the signature was configured) — the caller then treats the whole text as
 * body and must not re-append the signature on save.
 *
 * A signature made only of images (a logo banner) leaves no text to match, so
 * it is recognized instead by the cid references outgoingBody mints for its
 * images, which survive in the provider's html. Without that, such a signature
 * would read as absent and an in-app edit would save the body over it.
 */
export function detachAccountSignature(
  detail: DraftDetail,
  signatureHtml: string,
): { body: string; signature: string } | null {
  const signatureText = stripHtml(signatureHtml);
  if (signatureText) return detachSignature(detail.body, signatureText);

  const { bodyHtml } = detail;
  const { images } = withCidImages(signatureHtml);
  if (images.length === 0 || !bodyHtml) return null;
  return images.every((image) => bodyHtml.includes(`cid:${image.contentId}`))
    ? { body: detail.body, signature: "" }
    : null;
}
