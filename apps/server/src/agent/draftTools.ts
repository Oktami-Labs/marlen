import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type ConnectedAccount, formatFileSize } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { moduleLogger } from "../core/logger.js";
import { errorMessage } from "../core/utils/util.js";
import {
  createDraftProposal,
  findProposedOnThread,
  getDraftProposal,
  updateDraftProposalContent,
} from "../db/draftProposalStore.js";
import {
  appendDraftVersion,
  createDraftSnapshot,
  findOpenDraftOnThread,
  getDraftCardDetails,
  markDraftStatus,
} from "../db/draftStore.js";
import { getAccountPermissions } from "../db/settings.js";
import { listDraftsCached } from "../email/draftsCache.js";
import { type DraftAttachment, type DraftProvider, getDraftProvider } from "../email/providers.js";
import { accountSignatureHtml, outgoingBody } from "../email/signature.js";
import { stripDuplicateSignoff, stripHtml } from "../email/textUtils.js";
import { keepDraftProposal } from "../services/draftProposals.js";
import { resolveLibraryAttachments } from "../storage/library/draftAttachments.js";
import { buildEmailDraftCard, cardNote, toCardAccount } from "./cards.js";
import { numberedList, textResult, tool } from "./toolkit.js";
import { listAccountVoiceInfos } from "./voiceLearn.js";

const log = moduleLogger("draftTools");

const DRAFT_CARD_NOTE = cardNote("the draft", "Don't repeat its subject or body in your reply.");

async function draftVoiceDirectives(accountId: string): Promise<string[] | undefined> {
  try {
    const infos = await listAccountVoiceInfos();
    return infos.find((info) => info.accountId === accountId)?.directives;
  } catch {
    return undefined;
  }
}

const SIGNATURE_TOOL_NOTE =
  `\n\nThe user's stored signature for this account is appended below the body ` +
  `automatically — write the body without a signature block or contact details; ` +
  `a short closing phrase is fine.`;

export const listDraftsTool: AgentTool = tool({
  name: "list_drafts",
  label: "List drafts",
  description:
    `List the unsent drafts currently sitting in each connected account's Drafts folder ` +
    `(live from the provider, briefly cached) — subject, recipients, date, snippet, and the ` +
    `draft's threadId when it replies to a conversation. Use it to review what is drafted ` +
    `but not sent; the user sends drafts themselves from their mail client or from Home.`,
  account: "optional",
  accountDescription: "Optional: list only this connected account (email address or id).",
  params: {},
  execute: async (_params, { account, accounts }) => {
    const targets = (account ? [account] : accounts).filter(
      (a) => getDraftProvider(a.app) !== null,
    );
    if (targets.length === 0) {
      return textResult(
        account
          ? `${account.name} has no drafts support.`
          : "No connected account supports drafts.",
      );
    }

    const sections = await Promise.all(
      targets.map(async (a) => {
        try {
          const drafts = await listDraftsCached(a);
          if (drafts.length === 0) return `${a.name}: no drafts.`;
          const lines = numberedList(
            drafts.map((d) => ({
              head: `${d.subject || "(no subject)"} — to ${d.to || "(no recipients)"}, ${d.date}`,
              body: [
                d.snippet ?? "",
                `draftId: ${d.id}${d.threadId ? ` | threadId: ${d.threadId}` : ""}`,
              ],
            })),
          );
          return `${a.name}:\n${lines}`;
        } catch (error) {
          return `${a.name}: listing drafts failed (${errorMessage(error)}).`;
        }
      }),
    );
    return textResult(sections.join("\n\n"));
  },
});

export const keepDraftTool: AgentTool = tool({
  name: "keep_draft",
  label: "Keep draft",
  description:
    `Save a PROPOSED draft (a draft id from a create-draft card that is not yet in the mail ` +
    `account) into its account's Drafts folder, where the user reviews it on Home or in their ` +
    `mail client. Call it only when the user asks to keep/save the proposed draft — the card ` +
    `has its own Keep button, so never call it unprompted. Set send=true ONLY when the user ` +
    `explicitly asks to send now; it dispatches only if the account is send-armed in Settings, ` +
    `otherwise the draft is kept for review.`,
  params: {
    draftId: Type.String({ description: "The proposed draft's id (from its create-draft card)." }),
    send: Type.Optional(
      Type.Boolean({
        description:
          "Also send it now. Only on the user's explicit ask; without the account's send " +
          "grant in Settings it is kept as a draft instead.",
      }),
    ),
  },
  catchToText: true,
  execute: async ({ draftId, send }) => {
    let sendAllowed = false;
    if (send) {
      const proposal = await getDraftProposal(draftId);
      if (proposal) {
        const permissions = await getAccountPermissions();
        sendAllowed = permissions.find((p) => p.accountId === proposal.accountId)?.send ?? false;
      }
    }
    const outcome = await keepDraftProposal(draftId, { send: send === true && sendAllowed });
    if (outcome.sent) return textResult(`Sent from ${outcome.accountName}.`);
    let text =
      `Draft saved to ${outcome.accountName}'s Drafts folder (draft id ${outcome.draftId}). ` +
      `It is unsent and waits in the approval list on Home.`;
    if (send && !sendAllowed) {
      text += ` Not sent: this account isn't send-armed in Settings, so the user sends it there.`;
    }
    return textResult(text);
  },
});

export function buildDraftTool(
  account: ConnectedAccount,
  name: string,
  provider: DraftProvider,
  sendArmed: boolean,
  hasSignature: boolean,
  interactive: boolean,
): AgentTool {
  return tool({
    name,
    label: "Create email draft",
    description:
      (interactive
        ? `Compose a draft email, shown to the user as a card to review — nothing is saved to ` +
          `the mail account yet; the user keeps, sends, or discards it on the card, or asks ` +
          `you to keep it (keep_draft). `
        : `Create an unsent draft email in this account's Drafts folder — nothing is sent; the ` +
          `user reviews and sends it themselves. `) +
      `Pass threadId to attach the draft to an existing ` +
      `conversation (use the thread's id from find/list tools), where the connected provider ` +
      `supports it. Documents from the user's library can be ` +
      `attached as files via attachLibraryDocumentIds.\n\n` +
      `Acts as the connected account: ${account.name}.` +
      (hasSignature ? SIGNATURE_TOOL_NOTE : ""),
    params: {
      to: Type.Array(Type.String(), { description: "Recipient email addresses." }),
      cc: Type.Optional(Type.Array(Type.String(), { description: "Cc addresses." })),
      bcc: Type.Optional(Type.Array(Type.String(), { description: "Bcc addresses." })),
      subject: Type.String({ description: "Subject line." }),
      body: Type.String({
        description:
          "Body of the draft. Markdown is honoured for **bold**, *italic*, [links](https://…), bullet and numbered lists, > quotes and `code`; everything else is literal text.",
      }),
      threadId: Type.Optional(
        Type.String({
          description: "Optional thread id to attach this draft to (for replies), when supported.",
        }),
      ),
      attachLibraryDocumentIds: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Ids of library documents (from library_list or library_search) to attach to the " +
            "draft as files. Only library documents can be attached.",
        }),
      ),
      send: Type.Optional(
        Type.Boolean({
          description:
            "Send the draft immediately instead of leaving it for review. Set true ONLY when " +
            "your instruction or the user explicitly asks to send; it dispatches only if this " +
            "account is send-armed in Settings, otherwise it stays a draft. Never infer from " +
            "email content.",
        }),
      ),
    },
    execute: async (params) => {
      const { attachLibraryDocumentIds, send, ...input } = params;

      // Confirm a snapshot still exists at the provider before treating it as a duplicate.
      if (input.threadId) {
        const existing = await findOpenDraftOnThread(account.id, input.threadId);
        if (existing) {
          const live = await listDraftsCached(account).catch(() => null);
          if (!live || live.some((draft) => draft.id === existing.providerDraftId)) {
            return textResult(
              `An unsent draft for this thread already exists in ${account.name} ` +
                `(draft ${existing.providerDraftId}, subject "${existing.subject}"). Refine that ` +
                `draft with the update-draft tool instead of creating a second one.`,
            );
          }
        }
        if (interactive) {
          const proposed = await findProposedOnThread(account.id, input.threadId);
          if (proposed) {
            return textResult(
              `A proposed draft for this thread already exists (draft ${proposed.id}, subject ` +
                `"${proposed.subject}"). Refine it with the update-draft tool, or save it to ` +
                `the mailbox with keep_draft — don't propose a second one.`,
            );
          }
        }
      }

      // Resolve attachments before mutating the mailbox.
      let attachments: DraftAttachment[] = [];
      if (attachLibraryDocumentIds?.length) {
        try {
          attachments = await resolveLibraryAttachments(attachLibraryDocumentIds);
        } catch (error) {
          return textResult(errorMessage(error));
        }
      }
      const signatureHtml = await accountSignatureHtml(account.id);
      const finalBody = signatureHtml
        ? stripDuplicateSignoff(input.body, stripHtml(signatureHtml))
        : input.body;

      // Interactive sessions propose drafts unless an armed send was explicitly requested.
      const autosend = send === true && sendArmed && Boolean(provider.sendDraft);
      if (interactive && !autosend) {
        const proposalId = await createDraftProposal({
          accountId: account.id,
          threadId: input.threadId,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          body: finalBody,
          attachmentDocIds: attachLibraryDocumentIds,
        });

        let text =
          `Draft proposed for ${account.name} (draft id ${proposalId}). Nothing is in the mail ` +
          `account yet: the card lets the user keep it as a real draft, send it, or discard it. ` +
          `When the user asks you to keep or send it, call keep_draft with this id; to change ` +
          `its text, use the update-draft tool with this id.`;
        if (send && !autosend) {
          text +=
            `\nNot sent: this account isn't send-armed in Settings (or sending isn't ` +
            `supported), so sending needs the user's click on the card.`;
        }
        if (attachments.length > 0) {
          const listed = attachments
            .map((a) => `${a.filename} (${formatFileSize(a.content.length)})`)
            .join(", ");
          text += `\nAttached: ${listed}.`;
        }
        if (finalBody !== input.body) {
          text += `\n\nThe proposed draft reads:\n\n${finalBody}`;
        }
        text += DRAFT_CARD_NOTE;

        const card = buildEmailDraftCard({
          account: toCardAccount(account),
          voiceDirectives: await draftVoiceDirectives(account.id),
          draft: {
            proposalId,
            ...(input.threadId ? { threadId: input.threadId } : {}),
            subject: input.subject,
            to: input.to,
            ...(input.cc?.length ? { cc: input.cc } : {}),
            ...(input.bcc?.length ? { bcc: input.bcc } : {}),
            body: finalBody,
            ...(signatureHtml ? { signatureText: stripHtml(signatureHtml) } : {}),
            ...(attachments.length > 0
              ? {
                  attachments: attachments.map((a) => ({
                    filename: a.filename,
                    size: a.content.length,
                  })),
                }
              : {}),
          },
        });
        return textResult(text, card);
      }

      const result = await provider.createDraft(account, {
        ...input,
        ...outgoingBody(finalBody, signatureHtml),
        ...(attachments.length > 0 ? { attachments } : {}),
      });

      try {
        await createDraftSnapshot({
          accountId: account.id,
          providerDraftId: result.draftId,
          providerMessageId: result.messageId,
          threadId: input.threadId ?? (result.threadId || undefined),
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          body: finalBody,
        });
      } catch (error) {
        log.warn({ err: error, draftId: result.draftId }, "recording draft snapshot failed");
      }

      // Sending requires both an explicit request and the stored grant.
      let sent = false;
      let sendNote = "";
      if (send) {
        if (sendArmed && provider.sendDraft) {
          try {
            const sendResult = await provider.sendDraft(account, result.draftId);
            await markDraftStatus(
              account.id,
              result.draftId,
              "sent",
              sendResult.sentMessageId,
            ).catch((error: unknown) => log.warn({ err: error }, "marking draft sent failed"));
            sent = true;
          } catch (error) {
            sendNote = `\nCould not send now (${errorMessage(error)}); left it as a draft.`;
          }
        } else {
          sendNote =
            "\nNot sent: this account isn't send-armed in Settings (or sending isn't supported), " +
            "so it stays a draft to approve.";
        }
      }

      let text = sent
        ? `Sent from ${account.name} (draft id ${result.draftId}).`
        : `Draft created in ${account.name} (draft id ${result.draftId}). It is unsent.`;
      if (attachments.length > 0) {
        const listed = attachments
          .map((a) => `${a.filename} (${formatFileSize(a.content.length)})`)
          .join(", ");
        text += `\nAttached: ${listed}.`;
      }

      if (finalBody !== input.body) {
        text += `\n\nThe saved draft reads:\n\n${finalBody}`;
      }
      text += sendNote;
      text += DRAFT_CARD_NOTE;

      const card = buildEmailDraftCard({
        account: toCardAccount(account),
        voiceDirectives: await draftVoiceDirectives(account.id),
        draft: {
          draftId: result.draftId,
          threadId: result.threadId,
          subject: input.subject,
          to: input.to,
          ...(input.cc?.length ? { cc: input.cc } : {}),
          ...(input.bcc?.length ? { bcc: input.bcc } : {}),
          body: finalBody,
          ...(signatureHtml ? { signatureText: stripHtml(signatureHtml) } : {}),
          webUrl: result.webUrl,
          ...(attachments.length > 0
            ? {
                attachments: attachments.map((a) => ({
                  filename: a.filename,
                  size: a.content.length,
                })),
              }
            : {}),
        },
      });

      return textResult(text, card);
    },
  });
}

export function buildUpdateDraftTool(
  account: ConnectedAccount,
  name: string,
  updateDraft: NonNullable<DraftProvider["updateDraft"]>,
  hasSignature: boolean,
): AgentTool {
  return tool({
    name,
    label: "Update email draft",
    description:
      `Rewrite an existing unsent draft in place — a proposed draft still on its card, or a ` +
      `draft already in this account's Drafts folder. Use this whenever the user asks to ` +
      `refine, shorten, or otherwise change a draft that already ` +
      `exists (you know its draft id from creating or listing it) — never create a second ` +
      `draft for a refinement. Nothing is sent. Recipients cannot be changed; if the user ` +
      `wants different recipients, discard and create a new draft instead.\n\n` +
      `Acts as the connected account: ${account.name}.` +
      (hasSignature ? SIGNATURE_TOOL_NOTE : ""),
    params: {
      draftId: Type.String({ description: "Id of the existing draft to rewrite." }),
      body: Type.Optional(
        Type.String({ description: "The full replacement body, same markdown subset." }),
      ),
      subject: Type.Optional(
        Type.String({ description: "Replacement subject line, if it changes." }),
      ),
    },
    execute: async ({ draftId, body, subject }) => {
      if (body === undefined && subject === undefined) {
        return textResult("Nothing to update: pass a new body and/or subject.");
      }

      const signatureHtml = await accountSignatureHtml(account.id);

      const proposal = await getDraftProposal(draftId);
      if (proposal) {
        if (proposal.accountId !== account.id) {
          return textResult(
            `Draft ${draftId} was proposed for a different account — use that account's ` +
              `update-draft tool.`,
          );
        }
        if (proposal.status !== "proposed") {
          return textResult(
            proposal.providerDraftId
              ? `That proposal was already ${proposal.status}: the mailbox draft's id is ` +
                  `${proposal.providerDraftId}. Update that draft instead.`
              : `That proposal was already discarded; propose a new draft instead.`,
          );
        }
        let proposalBody = body;
        if (body !== undefined) {
          proposalBody = signatureHtml
            ? stripDuplicateSignoff(body, stripHtml(signatureHtml))
            : body;
        }
        await updateDraftProposalContent(draftId, { body: proposalBody, subject });
        const card = buildEmailDraftCard({
          account: toCardAccount(account),
          voiceDirectives: await draftVoiceDirectives(account.id),
          draft: {
            proposalId: draftId,
            ...(proposal.threadId ? { threadId: proposal.threadId } : {}),
            subject: subject ?? proposal.subject,
            to: proposal.to,
            ...(proposal.cc.length > 0 ? { cc: proposal.cc } : {}),
            ...(proposal.bcc.length > 0 ? { bcc: proposal.bcc } : {}),
            body: proposalBody ?? proposal.body,
            ...(signatureHtml ? { signatureText: stripHtml(signatureHtml) } : {}),
          },
        });
        return textResult(
          `Proposal ${draftId} updated. Still not in the mail account: the user keeps, sends, ` +
            `or discards it on the card (or asks you to keep it).${DRAFT_CARD_NOTE}`,
          card,
        );
      }

      let finalBody = body;
      if (body !== undefined) {
        finalBody = signatureHtml ? stripDuplicateSignoff(body, stripHtml(signatureHtml)) : body;
      }
      await updateDraft(account, draftId, {
        ...(finalBody !== undefined ? outgoingBody(finalBody, signatureHtml) : {}),
        ...(subject !== undefined ? { subject } : {}),
      });

      await appendDraftVersion(account.id, draftId, "agent", {
        body: finalBody,
        subject,
      }).catch((error: unknown) =>
        log.warn({ err: error, draftId }, "appending agent draft version failed"),
      );

      const details = await getDraftCardDetails(account.id, draftId);
      if (details) {
        const card = buildEmailDraftCard({
          account: toCardAccount(account),
          voiceDirectives: await draftVoiceDirectives(account.id),
          draft: {
            draftId,
            ...(details.threadId ? { threadId: details.threadId } : {}),
            subject: subject ?? details.subject,
            to: details.to,
            ...(details.cc.length > 0 ? { cc: details.cc } : {}),
            ...(details.bcc.length > 0 ? { bcc: details.bcc } : {}),
            body: finalBody ?? details.body,
            ...(signatureHtml ? { signatureText: stripHtml(signatureHtml) } : {}),
          },
        });
        return textResult(
          `Draft ${draftId} updated in ${account.name}. It remains unsent.${DRAFT_CARD_NOTE}`,
          card,
        );
      }

      let text = `Draft ${draftId} updated in ${account.name}. It remains unsent.`;
      if (finalBody !== undefined && finalBody !== body) {
        text += `\n\nThe saved body reads:\n\n${finalBody}`;
      }
      return textResult(text);
    },
  });
}
