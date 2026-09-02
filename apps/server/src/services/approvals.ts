import type { AccountDrafts, EmailDraft } from "@marlen/shared";
import { isTurnInFlight } from "../agent/turnRecorder.js";
import { moduleLogger } from "../core/logger.js";
import { getDraftConversationLinks, getDraftStatus } from "../db/draftStore.js";
import { closeApproval, openApprovalKeys, syncApproval } from "../db/todos.js";

const log = moduleLogger("approvals");

/**
 * The approval list as the user sees it: each agent draft carries the
 * conversation that wrote it (the refine button), and a draft whose
 * conversation still has a turn running is withheld until the turn ends,
 * since that turn may yet rewrite it. Every mailbox draft belongs on the list:
 * automation-born ones directly, chat-born ones because they only exist once
 * the user kept their proposal.
 */
export async function finalizeDrafts(byAccount: AccountDrafts[]): Promise<AccountDrafts[]> {
  const draftIds = byAccount.flatMap((a) => a.drafts.map((d) => d.id));
  const byDraftId = draftIds.length > 0 ? await getDraftConversationLinks(draftIds) : new Map();
  return byAccount.map((account) => ({
    ...account,
    drafts: account.drafts
      .map((draft): EmailDraft => {
        const conversationId = byDraftId.get(draft.id);
        return conversationId ? { ...draft, conversationId } : draft;
      })
      .filter((draft) => !draft.conversationId || !isTurnInFlight(draft.conversationId)),
  }));
}

export const emailApprovalKey = (accountId: string, draftId: string) =>
  `approval:email:${accountId}:${draftId}`;

/**
 * Reconcile the agenda's email approvals with the mailbox: every listed draft
 * has an open row, and a row whose draft is gone closes with the draft's fate
 * (sent when the snapshot says so, else discarded). An account whose fetch
 * failed is left untouched: its rows are not evidence of anything.
 */
export async function syncEmailApprovals(accounts: AccountDrafts[]): Promise<void> {
  for (const account of accounts) {
    if (account.error) continue;
    const prefix = `${emailApprovalKey(account.accountId, "")}`;
    const live = new Set<string>();
    for (const draft of account.drafts) {
      const key = emailApprovalKey(account.accountId, draft.id);
      live.add(key);
      await syncApproval({
        key,
        title: draft.subject,
        ref: {
          kind: "email_draft",
          accountId: account.accountId,
          account: account.account,
          draftId: draft.id,
          to: draft.to,
          webUrl: draft.webUrl,
          ...(draft.snippet ? { snippet: draft.snippet } : {}),
        },
        conversationId: draft.conversationId ?? null,
        createdAt: draft.date,
      });
    }
    for (const key of await openApprovalKeys(prefix)) {
      if (live.has(key)) continue;
      const draftId = key.slice(prefix.length);
      const status = await getDraftStatus(account.accountId, draftId);
      await closeApproval(key, status?.status === "sent" ? "done" : "dismissed");
    }
  }
}

/** Never fails the caller: the agenda catching up late beats a drafts list that errors. */
export function syncEmailApprovalsInBackground(accounts: AccountDrafts[]): void {
  syncEmailApprovals(accounts).catch((error) =>
    log.warn({ err: error }, "syncing email approvals to the agenda failed"),
  );
}

/** One account's freshly fetched list, straight from the provider, onto the agenda. */
export function syncFetchedDrafts(
  account: { id: string; name: string },
  drafts: EmailDraft[],
): void {
  finalizeDrafts([{ account: account.name, accountId: account.id, drafts }])
    .then(syncEmailApprovals)
    .catch((error) => log.warn({ err: error }, "syncing fetched drafts to the agenda failed"));
}
