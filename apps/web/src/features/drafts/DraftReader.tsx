import type { AccountDrafts, EmailDraft } from "@marlen/shared";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  DraftActionDialog,
  EditSaveActions,
  RefineInChatButton,
  useDraftActions,
} from "@/components/draftActions";
import { ThreadHistory } from "@/components/ThreadHistory";
import { Button } from "@/components/ui/button";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { OpenExternalButton } from "@/components/ui/open-external-button";
import { Textarea } from "@/components/ui/textarea";
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

/**
 * One draft, read and edited on its own screen: the letter first, with the
 * decision at the bottom of it, and the conversation it answers folded
 * underneath. The approval list stays one click away and the stack is walked
 * with the arrows, so a queue of drafts is worked through without returning to
 * the list between two of them.
 */
export function DraftReader({
  entry,
  stack,
  onClose,
  onOpen,
  onChanged,
}: {
  entry: StackEntry;
  /** The whole review stack, for the position readout and the arrows. */
  stack: StackEntry[];
  onClose: () => void;
  onOpen: (accountId: string, draftId: string) => void;
  /** Called after a send, discard or save, so the list behind refetches. */
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { accountId, account, draft } = entry;

  const [detail, setDetail] = React.useState<{
    body: string;
    cc: string;
    bcc: string;
    signature?: string;
  } | null>(null);
  // `*Draft` are the live field values, `saved*` the last-persisted baselines
  // they are compared against for the dirty flag.
  const [bodyDraft, setBodyDraft] = React.useState("");
  const [savedBody, setSavedBody] = React.useState("");
  const [subjectDraft, setSubjectDraft] = React.useState(draft.subject);
  const [savedSubject, setSavedSubject] = React.useState(draft.subject);
  const [toDraft, setToDraft] = React.useState(draft.to);
  const [savedTo, setSavedTo] = React.useState(draft.to);
  const [ccDraft, setCcDraft] = React.useState("");
  const [savedCc, setSavedCc] = React.useState("");
  const [bccDraft, setBccDraft] = React.useState("");
  const [savedBcc, setSavedBcc] = React.useState("");
  /** Cc and Bcc stay folded away until the draft has one or the user asks. */
  const [copiesOpen, setCopiesOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const index = stack.findIndex((item) => item.draft.id === draft.id);
  const previous = index > 0 ? stack[index - 1] : undefined;
  const next = index >= 0 ? stack[index + 1] : undefined;

  // Reload whenever the reader moves to another draft; the fields are reset
  // from the fetched body so a half-typed edit never leaks across drafts.
  React.useEffect(() => {
    let current = true;
    setDetail(null);
    setError(null);
    setSubjectDraft(draft.subject);
    setSavedSubject(draft.subject);
    setToDraft(draft.to);
    setSavedTo(draft.to);
    setCopiesOpen(false);
    api
      .draftDetail(accountId, draft.id)
      .then((result) => {
        if (!current) return;
        setDetail(result);
        setBodyDraft(result.body);
        setSavedBody(result.body);
        setCcDraft(result.cc);
        setSavedCc(result.cc);
        setBccDraft(result.bcc);
        setSavedBcc(result.bcc);
        if (result.cc || result.bcc) setCopiesOpen(true);
      })
      .catch((err) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, [accountId, draft.id, draft.subject, draft.to]);

  const dirty =
    bodyDraft !== savedBody ||
    subjectDraft !== savedSubject ||
    toDraft !== savedTo ||
    ccDraft !== savedCc ||
    bccDraft !== savedBcc;

  /** PATCHes only the fields that changed from their saved baseline. */
  const savePatch = () => ({
    ...(bodyDraft !== savedBody && { body: bodyDraft }),
    ...(subjectDraft !== savedSubject && { subject: subjectDraft }),
    ...(toDraft !== savedTo && { to: toDraft }),
    ...(ccDraft !== savedCc && { cc: ccDraft }),
    ...(bccDraft !== savedBcc && { bcc: bccDraft }),
  });

  const markSaved = () => {
    setSavedBody(bodyDraft);
    setSavedSubject(subjectDraft);
    setSavedTo(toDraft);
    setSavedCc(ccDraft);
    setSavedBcc(bccDraft);
  };

  const revertEdits = () => {
    setBodyDraft(savedBody);
    setSubjectDraft(savedSubject);
    setToDraft(savedTo);
    setCcDraft(savedCc);
    setBccDraft(savedBcc);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateDraft(accountId, draft.id, savePatch());
      markSaved();
      toast.success(t("common.saved"));
      onChanged();
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
        if (dirty) await api.updateDraft(accountId, draft.id, savePatch());
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

      {/* The letter. Subject and body are the paper itself, with a writing
          line that surfaces on hover and follows the caret, so nothing here
          reads as a form. */}
      <div className="surface flex flex-col gap-4 rounded-[--radius] p-6">
        <Input
          value={subjectDraft}
          onChange={(e) => setSubjectDraft(e.target.value)}
          placeholder={t("drafts.noSubject")}
          disabled={actions.busy}
          aria-label={t("mail.subject")}
          className="field-paper h-auto px-0 py-1 text-base font-semibold tracking-tight"
        />

        {/* The header a mail client gives you: every recipient field is typed
            in, Cc and Bcc folded away until the draft has one or you ask. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-border pb-4 text-sm">
          <span className="text-muted-foreground">{t("mail.to")}</span>
          <Input
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            placeholder={t("drafts.recipientsPlaceholder")}
            disabled={actions.busy}
            aria-label={t("mail.to")}
            className="field-paper h-auto px-0 py-1 text-sm"
          />
          {copiesOpen ? (
            <span />
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setCopiesOpen(true)}>
              {t("drafts.addCopies")}
            </Button>
          )}

          {copiesOpen && (
            <>
              <span className="text-muted-foreground">{t("mail.cc")}</span>
              <Input
                value={ccDraft}
                onChange={(e) => setCcDraft(e.target.value)}
                placeholder={t("drafts.recipientsPlaceholder")}
                disabled={actions.busy || !detail}
                aria-label={t("mail.cc")}
                className="field-paper col-span-2 h-auto px-0 py-1 text-sm"
              />
              <span className="text-muted-foreground">{t("mail.bcc")}</span>
              <Input
                value={bccDraft}
                onChange={(e) => setBccDraft(e.target.value)}
                placeholder={t("drafts.recipientsPlaceholder")}
                disabled={actions.busy || !detail}
                aria-label={t("mail.bcc")}
                className="field-paper col-span-2 h-auto px-0 py-1 text-sm"
              />
            </>
          )}

          <span className="text-muted-foreground">{t("mail.from")}</span>
          <span className="col-span-2 truncate text-muted-foreground">{account}</span>
        </div>

        {!detail ? (
          <LoadingRow className="py-6 text-xs" />
        ) : (
          <>
            <Textarea
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              placeholder={t("drafts.emptyBodyText")}
              disabled={actions.busy}
              aria-label={t("drafts.bodyLabel")}
              className="field-paper field-sizing-content min-h-48 resize-none px-0 py-1 text-sm leading-relaxed"
            />
            {/* The account signature: the server detached it from the body and
                re-appends it on send, so it is shown but never editable here. */}
            {detail.signature && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {detail.signature}
              </p>
            )}
          </>
        )}

        {dirty ? (
          <EditSaveActions
            saving={saving}
            busy={actions.busy}
            onCancel={revertEdits}
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
            <RefineInChatButton
              conversationId={draft.conversationId}
              subject={draft.subject}
              label={t("drafts.refineLabel")}
            />
            <Button
              size="sm"
              className="icon-send"
              onClick={() => actions.arm("send")}
              disabled={actions.busy || !detail}
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
