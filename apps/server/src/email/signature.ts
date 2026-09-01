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

/**
 * Provider body fields for a draft body. Mail always leaves as html so the
 * markdown the agent wrote arrives as formatting rather than asterisks, with
 * the markdown source itself as the plain-text alternative: a text-only client
 * gets readable prose, and reading the draft back returns the source it was
 * written from rather than a flattened copy.
 */
export function outgoingBody(body: string, signatureHtml: string | undefined) {
  const { html, images } = htmlBodyWithSignature(body, signatureHtml);
  const signatureText = signatureHtml ? stripHtml(signatureHtml) : "";
  return {
    body: html,
    bodyFormat: "html" as const,
    bodyText: signatureText ? `${body}\n\n${signatureText}` : body,
    ...(images.length > 0 ? { inlineImages: images } : {}),
  };
}

/**
 * The prose above the account signature and the signature's text, or null when
 * the draft body does not carry the signature (hand-written, or written before
 * the signature was configured), the caller then treats the whole text as
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
