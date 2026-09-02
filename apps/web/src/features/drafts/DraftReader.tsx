import type { AccountDrafts, EmailDraft, TextDiff } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  DiscussInChatButton,
  DraftActionDialog,
  EditSaveActions,
  useDraftActions,
} from "@/components/draftActions";
import { ThreadHistory } from "@/components/ThreadHistory";
import { Button } from "@/components/ui/button";
import { ChangeList } from "@/components/ui/change-list";
import { ErrorBanner, LoadingRow, RetryableError } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { OpenExternalButton } from "@/components/ui/open-external-button";
import { Textarea } from "@/components/ui/textarea";
import { REWRITE_BAR_ENABLED, RewriteBar } from "@/features/drafts/RewriteBar";
import { api, isNotFound } from "@/lib/api";
import { dateTimeLabel } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/utils";

/** One draft in the review stack, carrying the inbox it belongs to. */
interface StackEntry {
  accountId: string;
  account: string;
  draft: EmailDraft;
}

/** Every open draft across every inbox, in the order the approval list shows them. */
export function draftStack(drafts: AccountDrafts[] | null): StackEntry[] {
  return (drafts ?? []).flatMap((account) =>
    account.error
      ? []
      : account.drafts.map((draft) => ({
          accountId: account.accountId,
          account: account.account,
          draft,
        })),
  );
}

/** Every editable field of the letter, as one value. */
interface Fields {
  body: string;
  subject: string;
  to: string;
  cc: string;
  bcc: string;
}

/** A rewrite waiting to be kept or dropped. */
interface PendingRewrite {
  diff: TextDiff;
  /** The letter as it stood before it, restored by Revert. */
  previous: Fields;
}

/**
 * One draft, read and edited on its own screen: the letter first, with the
 * decision at the bottom of it, and the conversation it answers folded
 * underneath. The approval list stays one click away and the stack is walked
 * with the arrows, so a queue of drafts is worked through without returning to
 * the list between two of them.
 *
 * Mounted under a key per draft (see HomePanel), so moving through the stack
 * starts each letter clean with no state to reset.
 */
export function DraftReader({
  entry,
  stack,
  onClose,
  onOpen,
  onChanged,
  focusRewrite,
}: {
  entry: StackEntry;
  /** The whole review stack, for the position readout and the arrows. */
  stack: StackEntry[];
  onClose: () => void;
  onOpen: (accountId: string, draftId: string) => void;
  /** Called after a send or discard, so the list behind refetches. */
  onChanged: () => void;
  /** Opened from Home's rewrite action: the instruction line takes the caret. */
  focusRewrite?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { accountId, account, draft } = entry;

  // The saved letter. A rewrite the agent makes elsewhere lands here through
  // the drafts topic, so the reader never shows text the mailbox no longer has.
  const detailQuery = useQuery({
    queryKey: ["drafts", "detail", accountId, draft.id],
    queryFn: () => api.draftDetail(accountId, draft.id),
    retry: false,
  });
  const detail = detailQuery.data;
  const saved: Fields | null = detail
    ? {
        body: detail.body,
        subject: draft.subject,
        to: draft.to,
        cc: detail.cc,
        bcc: detail.bcc,
      }
    : null;

  // Unsaved edits, the user's or a rewrite's; null while the letter stands as
  // saved, so an edit elsewhere shows up instead of being held off by a
  // baseline of its own.
  const [edit, setEdit] = React.useState<Fields | null>(null);
  const [rewrite, setRewrite] = React.useState<PendingRewrite | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Cc and Bcc stay folded away until the draft has one or the user asks. */
  const [copiesAsked, setCopiesAsked] = React.useState(false);
  const copiesOpen = copiesAsked || Boolean(detail?.cc || detail?.bcc);

  const fields = edit ?? saved;
  const dirty = Boolean(saved && fields && !sameFields(fields, saved));
  /** Every field write goes through here, so a first keystroke forks the baseline. */
  const put = (patch: Partial<Fields>) => {
    if (!fields) return;
    setEdit({ ...fields, ...patch });
  };

  const index = stack.findIndex((item) => item.draft.id === draft.id);
  const previous = index > 0 ? stack[index - 1] : undefined;
  const next = index >= 0 ? stack[index + 1] : undefined;

  const save = async () => {
    if (!saved || !fields) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateDraft(accountId, draft.id, patchOf(fields, saved));
      // Released only once the refetched letter carries the new text, so the
      // paper never flashes back to what was on it a moment ago.
      await queryClient.invalidateQueries({ queryKey: ["drafts"] });
      setEdit(null);
      setRewrite(null);
      toast.success(t("common.saved"));
    } catch (err) {
      // Keep the typed text, only the banner reflects the failure.
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  /** A handled draft leaves the stack: move to the next one, or back to the list. */
  const advance = () => {
    onChanged();
    if (next) onOpen(next.accountId, next.draft.id);
    else onClose();
  };

  const actions = useDraftActions({
    // Flushes any unsaved edits first, then sends the draft as-is.
    send: async () => {
      setError(null);
      try {
        if (saved && fields && dirty) {
          await api.updateDraft(accountId, draft.id, patchOf(fields, saved));
        }
        await api.sendDraft(accountId, draft.id);
        toast.success(t("drafts.sentToast"));
        advance();
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      }
    },
    discard: async () => {
      setError(null);
      try {
        await api.deleteDraft(accountId, draft.id);
        advance();
        return true;
      } catch (err) {
        if (isNotFound(err)) {
          advance();
          return true;
        }
        setError(errorMessage(err));
        return false;
      }
    },
  });

  /**
   * The instruction line. The letter as it stands on screen is what gets
   * rewritten, unsaved edits included, and the result only lands in the
   * fields: nothing reaches the mailbox until the user keeps it.
   */
  const askRewrite = async (instruction: string) => {
    if (!fields) return;
    const result = await api.rewriteDraft(accountId, {
      instruction,
      body: fields.body,
      subject: fields.subject,
    });
    if (result.diff.added + result.diff.removed === 0) {
      toast.info(t("drafts.rewriteNoChange"));
      return;
    }
    setError(null);
    setEdit({ ...fields, body: result.body, subject: result.subject });
    // A second rewrite reverts to where the first one started, so Revert always
    // means "the letter I wrote", never "the rewrite before this one".
    setRewrite({ diff: result.diff, previous: rewrite?.previous ?? fields });
  };

  const revertRewrite = () => {
    if (rewrite) setEdit(rewrite.previous);
    setRewrite(null);
  };

  return (
    <div className="flex flex-col gap-5 pt-1">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronLeft />
          {t("drafts.backToList")}
        </Button>
        <div className="flex-1" />
        {stack.length > 1 && index >= 0 && (
          <>
            <span className="font-mono text-2xs tabular-nums text-muted-foreground">
              {t("drafts.position", { index: index + 1, total: stack.length })}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!previous}
              onClick={() => previous && onOpen(previous.accountId, previous.draft.id)}
              title={t("drafts.previous")}
              aria-label={t("drafts.previous")}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!next}
              onClick={() => next && onOpen(next.accountId, next.draft.id)}
              title={t("drafts.next")}
              aria-label={t("drafts.next")}
            >
              <ChevronDown />
            </Button>
          </>
        )}
        <OpenExternalButton url={draft.webUrl} label={t("drafts.open")} />
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {detailQuery.error && (
        <RetryableError onRetry={() => void detailQuery.refetch()}>
          {errorMessage(detailQuery.error)}
        </RetryableError>
      )}

      {/* The letter. Subject and body are the paper itself, with a writing
          line that surfaces on hover and follows the caret, so nothing here
          reads as a form. */}
      <div className="surface flex flex-col gap-4 rounded-[--radius] p-6">
        <Input
          value={fields?.subject ?? draft.subject}
          onChange={(e) => put({ subject: e.target.value })}
          placeholder={t("drafts.noSubject")}
          disabled={actions.busy || !fields}
          aria-label={t("mail.subject")}
          className="field-paper h-auto px-0 py-1 text-base font-semibold tracking-tight"
        />

        {/* The header a mail client gives you: every recipient field is typed
            in, Cc and Bcc folded away until the draft has one or you ask. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-border pb-4 text-sm">
          <span className="text-muted-foreground">{t("mail.to")}</span>
          <Input
            value={fields?.to ?? draft.to}
            onChange={(e) => put({ to: e.target.value })}
            placeholder={t("drafts.recipientsPlaceholder")}
            disabled={actions.busy || !fields}
            aria-label={t("mail.to")}
            className="field-paper h-auto px-0 py-1 text-sm"
          />
          {copiesOpen ? (
            <span />
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setCopiesAsked(true)}>
              {t("drafts.addCopies")}
            </Button>
          )}

          {copiesOpen && (
            <>
              <span className="text-muted-foreground">{t("mail.cc")}</span>
              <Input
                value={fields?.cc ?? ""}
                onChange={(e) => put({ cc: e.target.value })}
                placeholder={t("drafts.recipientsPlaceholder")}
                disabled={actions.busy || !fields}
                aria-label={t("mail.cc")}
                className="field-paper col-span-2 h-auto px-0 py-1 text-sm"
              />
              <span className="text-muted-foreground">{t("mail.bcc")}</span>
              <Input
                value={fields?.bcc ?? ""}
                onChange={(e) => put({ bcc: e.target.value })}
                placeholder={t("drafts.recipientsPlaceholder")}
                disabled={actions.busy || !fields}
                aria-label={t("mail.bcc")}
                className="field-paper col-span-2 h-auto px-0 py-1 text-sm"
              />
            </>
          )}

          <span className="text-muted-foreground">{t("mail.from")}</span>
          <span className="col-span-2 truncate text-muted-foreground">{account}</span>
        </div>

        {!fields ? (
          <LoadingRow className="py-6 text-xs" />
        ) : (
          <>
            <Textarea
              value={fields.body}
              onChange={(e) => put({ body: e.target.value })}
              placeholder={t("drafts.emptyBodyText")}
              disabled={actions.busy}
              aria-label={t("drafts.bodyLabel")}
              className="field-paper field-sizing-content min-h-48 resize-none px-0 py-1 text-sm leading-relaxed"
            />
            {/* The account signature: the server detached it from the body and
                re-appends it on send, so it is shown but never editable here. */}
            {detail?.signature && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {detail.signature}
              </p>
            )}

            {/* What the rewrite changed, so the letter needs no re-reading to
                see it. Counted even when the lines are too many to list. */}
            {rewrite && (
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                  {t("drafts.rewriteChanges", {
                    added: rewrite.diff.added,
                    removed: rewrite.diff.removed,
                  })}
                </span>
                <ChangeList diff={rewrite.diff} />
              </div>
            )}

            {REWRITE_BAR_ENABLED && (
              <RewriteBar
                onSubmit={askRewrite}
                disabled={actions.busy || saving}
                autoFocus={focusRewrite}
              />
            )}
          </>
        )}

        {rewrite ? (
          <EditSaveActions
            saving={saving}
            busy={actions.busy}
            cancelLabel={t("drafts.rewriteRevert")}
            saveLabel={t("drafts.rewriteApply")}
            onCancel={revertRewrite}
            onSave={() => void save()}
          />
        ) : dirty ? (
          <EditSaveActions
            saving={saving}
            busy={actions.busy}
            onCancel={() => setEdit(null)}
            onSave={() => void save()}
          />
        ) : (
          <div className="flex items-center gap-2 pt-1">
            <span className="font-mono text-2xs tabular-nums text-muted-foreground">
              {dateTimeLabel(draft.date, i18n.language)}
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost-danger"
              size="sm"
              className="icon-discard"
              onClick={() => actions.arm("discard")}
              disabled={actions.busy}
              loading={actions.busy && actions.pending === "discard"}
            >
              {t("drafts.discard")}
            </Button>
            <DiscussInChatButton
              conversationId={draft.conversationId}
              label={t("drafts.discussInChat")}
            />
            <Button
              size="sm"
              className="icon-send"
              onClick={() => actions.arm("send")}
              disabled={actions.busy || !fields}
              loading={actions.busy && actions.pending === "send"}
            >
              {t("drafts.send")}
            </Button>
          </div>
        )}
      </div>

      <ThreadHistory accountId={accountId} threadId={draft.threadId} self={account} />

      <DraftActionDialog
        pending={actions.pending}
        busy={actions.busy}
        onClose={actions.close}
        onConfirm={actions.confirm}
        labels={{
          send: { title: t("drafts.send"), description: t("drafts.sendConfirm") },
          discard: { title: t("drafts.discard"), description: t("drafts.discardConfirm") },
        }}
      />
    </div>
  );
}

function sameFields(a: Fields, b: Fields): boolean {
  return (
    a.body === b.body &&
    a.subject === b.subject &&
    a.to === b.to &&
    a.cc === b.cc &&
    a.bcc === b.bcc
  );
}

/** PATCHes only the fields that differ from what is saved. */
function patchOf(fields: Fields, saved: Fields): Partial<Fields> {
  return {
    ...(fields.body !== saved.body && { body: fields.body }),
    ...(fields.subject !== saved.subject && { subject: fields.subject }),
    ...(fields.to !== saved.to && { to: fields.to }),
    ...(fields.cc !== saved.cc && { cc: fields.cc }),
    ...(fields.bcc !== saved.bcc && { bcc: fields.bcc }),
  };
}
