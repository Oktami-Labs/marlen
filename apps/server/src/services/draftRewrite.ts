import type { ConnectedAccount, DraftRewriteResult } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { type ReportToolSpec, runReportPrompt } from "../agent/oneShot.js";
import { accountVoiceDirectives } from "../agent/voiceLearn.js";
import { textDiff } from "../core/utils/diff.js";
import { accountSignatureHtml } from "../email/signature.js";
import { stripDuplicateSignoff, stripHtml } from "../email/textUtils.js";

/** Long enough for a whole letter, short of a pasted archive. */
const MAX_BODY_CHARS = 20_000;

/** The user is watching a spinner, so a stalled model fails rather than hangs. */
const REWRITE_TIMEOUT_MS = 90_000;

/**
 * Rewording is text in, text out: no mail tools, no thread, no conversation,
 * so it runs as one throwaway prompt instead of a chat turn. Anything that
 * needs to look something up or attach a file belongs in the chat, which the
 * draft keeps a button for.
 */
const rewriteTool: ReportToolSpec<{ body: string; subject: string | undefined }> = {
  name: "report_rewrite",
  label: "Report rewritten draft",
  description: "Record the rewritten draft. Call this exactly once, with the finished text.",
  parameters: Type.Object({
    body: Type.String({
      description:
        `The complete rewritten body, plain text with blank lines between paragraphs. ` +
        `Never a diff, a commentary, or an excerpt.`,
    }),
    subject: Type.Optional(
      Type.String({
        description: `A new subject line, ONLY if the instruction asks for one. Omit otherwise.`,
      }),
    ),
  }),
  narrow: (params) => {
    const { body, subject } = (params ?? {}) as Record<string, unknown>;
    return {
      body: typeof body === "string" ? body.trim() : "",
      subject: typeof subject === "string" && subject.trim() ? subject.trim() : undefined,
    };
  },
};

function systemPrompt(account: ConnectedAccount, hasSignature: boolean, voice?: string[]): string {
  return [
    `You rewrite one unsent email draft for the user, who writes from ${account.name}. You are ` +
      `given the draft as it stands and one instruction about it. Apply exactly that ` +
      `instruction and change nothing else: every sentence the instruction does not touch ` +
      `keeps its wording. It is the user's letter, not yours.`,
    `Write in the language the draft is written in, unless the instruction asks for another.`,
    `The instruction may be a single word ("Shorter", "Freundlicher"): read it as a request ` +
      `about the whole draft.`,
    `Keep the user's own voice. Never introduce marketing tone, exclamation marks, or ` +
      `filler the draft does not already have.`,
    hasSignature
      ? `The user's stored signature is appended below the body automatically: end with the ` +
        `closing phrase at most, never a signature block, name, or contact details.`
      : "",
    voice?.length ? `How this account writes:\n${voice.map((line) => `- ${line}`).join("\n")}` : "",
    `Report the finished draft with report_rewrite. Say nothing else.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The rewrite the instruction line asks for. Persists nothing: the user reads
 * the change list and keeps or drops the result, so a rewrite can never
 * overwrite the letter behind their back.
 */
export async function rewriteDraftText(
  account: ConnectedAccount,
  input: { instruction: string; body: string; subject: string },
): Promise<DraftRewriteResult> {
  const signatureHtml = await accountSignatureHtml(account.id);
  const rewritten = await runReportPrompt({
    systemPrompt: systemPrompt(
      account,
      Boolean(signatureHtml),
      await accountVoiceDirectives(account.id),
    ),
    tool: rewriteTool,
    prompt:
      `Subject: ${input.subject || "(none)"}\n\n` +
      `--- Draft ---\n${input.body.slice(0, MAX_BODY_CHARS)}\n--- End of draft ---\n\n` +
      `Instruction: ${input.instruction}`,
    timeoutMs: REWRITE_TIMEOUT_MS,
    missingReportError: "the rewrite finished without a result — try again",
  });
  if (!rewritten.body) throw new Error("the rewrite came back empty — try again");

  const body = signatureHtml
    ? stripDuplicateSignoff(rewritten.body, stripHtml(signatureHtml))
    : rewritten.body;
  const subject = rewritten.subject ?? input.subject;
  return { body, subject, diff: textDiff(input.body, body) };
}
