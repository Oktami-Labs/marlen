import type { EmailDraft } from "@marlen/shared";
import { Send, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  DraftActionDialog,
  EditSaveActions,
  RefineInChatButton,
  useDraftActions,
} from "@/components/draftActions";
import { RecipientLine } from "@/components/MessageHeader";
import { ThreadHistory } from "@/components/ThreadHistory";
import { AccountDot } from "@/components/ui/account-dot";
import { AvatarMark } from "@/components/ui/avatar-mark";
import { Button } from "@/components/ui/button";
import { ExpandButton } from "@/components/ui/disclosure-toggle";
import { LoadingRow } from "@/components/ui/feedback";
import { HoverActions } from "@/components/ui/hover-actions";
import { Input } from "@/components/ui/input";
import { SentRow } from "@/components/ui/list-row";
import { OpenExternalButton } from "@/components/ui/open-external-button";
import { Textarea } from "@/components/ui/textarea";
import { NewDot } from "@/features/home/seen";
import { recipientNames, splitAddresses } from "@/lib/addresses";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { errorMessage, rowTransition, withViewTransition } from "@/lib/utils";

/** One draft, click to read the full content right here, edit its body in place. */
export function DraftRow({
  accountId,
  account,
  markAccount,
  draft,
  dateLabel,
  onDeleted,
  onSaved,
  onError,
  forceOpen,
  isNew,
}: {
  accountId: string;
  /** The inbox this draft sits in; its address is what the thread reads as "me". */
  account: { name: string; color?: string };
  /** Set when more than one inbox is in the list: marks the row with its account's dot. */
  markAccount?: boolean;
  draft: EmailDraft;
  dateLabel: (iso: string) => string;
  onDeleted: () => void;
  /** Called after a body save succeeds, so the list refetches (snippet/date). */
  onSaved: () => void;
  onError: (message: string | null) => void;
  /** True when this draft was opened via the search palette, auto-expand and scroll to it. */
  forceOpen?: boolean;
  /** Drafted since the user last looked, fronts the subject with the new dot. */
  isNew?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<{
    body: string;
    cc: string;
    signature?: string;
  } | null>(null);
  // Editable body/subject state: the `*Draft` values are the live field
  // values, `saved*` are the last-persisted baselines they're compared
  // against for the dirty flag. Subject starts from the list row's value,
  // unlike body it never needs a fetch, there's no separate subject endpoint.
  const [bodyDraft, setBodyDraft] = React.useState("");
  const [savedBody, setSavedBody] = React.useState("");
  const [subjectDraft, setSubjectDraft] = React.useState(draft.subject);
  const [savedSubject, setSavedSubject] = React.useState(draft.subject);
  const [saving, setSaving] = React.useState(false);
  // True right after a successful send, the row shows a brief "Sent" state
  // until the drafts SSE topic fires and the parent list refetch removes it.
  const [sent, setSent] = React.useState(false);
  // Discarded rows leave at once rather than waiting on the refetch, so the
  // view transition has a frame to animate the gap closed.
  const [discarded, setDiscarded] = React.useState(false);
  const rowRef = React.useRef<HTMLDivElement>(null);

  const loadDetail = React.useCallback(async () => {
    try {
      const detailResult = await api.draftDetail(accountId, draft.id);
      setDetail(detailResult);
      setBodyDraft(detailResult.body);
      setSavedBody(detailResult.body);
    } catch (err) {
      onError(errorMessage(err));
      setOpen(false);
    }
  }, [accountId, draft.id, onError]);

  const toggle = async () => {
    const next = !open;
    withViewTransition(() => setOpen(next));
    if (next && !detail) await loadDetail();
  };

  // Opened from the search palette: expand, fetch and scroll to it even if it
  // was already rendered collapsed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the palette re-targets this row, not on every detail/loadDetail change
  React.useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    if (!detail) void loadDetail();
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [forceOpen]);

  const dirty = bodyDraft !== savedBody || subjectDraft !== savedSubject;

  const cancelEdit = () => {
    setBodyDraft(savedBody);
    setSubjectDraft(savedSubject);
  };

  /** PATCHes only the fields that changed from their saved baseline. */
  const savePatch = (): { body?: string; subject?: string } => ({
    ...(bodyDraft !== savedBody && { body: bodyDraft }),
    ...(subjectDraft !== savedSubject && { subject: subjectDraft }),
  });

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await api.updateDraft(accountId, draft.id, savePatch());
      setSavedBody(bodyDraft);
      setSavedSubject(subjectDraft);
      toast.success(t("common.saved"));
      onSaved();
    } catch (err) {
      // Keep the typed text, only the banner reflects the failure.
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const actions = useDraftActions({
    // Flushes any unsaved edits first, then sends the draft as-is.
    send: async () => {
      onError(null);
      try {
        if (dirty) {
          await api.updateDraft(accountId, draft.id, savePatch());
          setSavedBody(bodyDraft);
          setSavedSubject(subjectDraft);
        }
        await api.sendDraft(accountId, draft.id);
        withViewTransition(() => setSent(true));
        toast.success(t("drafts.sentToast"));
      } catch (err) {
        onError(errorMessage(err));
      }
    },
    discard: async () => {
      onError(null);
      try {
        await api.deleteDraft(accountId, draft.id);
        withViewTransition(() => setDiscarded(true));
        onDeleted();
      } catch (err) {
        onError(errorMessage(err));
      }
    },
  });

  // The row fronts the person the draft goes to, as a mail client does.
  const to = splitAddresses(draft.to);
  const recipients = recipientNames(to, account.name, t("mail.me"));
  const ccNames = recipientNames(splitAddresses(detail?.cc ?? ""), account.name, t("mail.me"));

  // Sending removes the draft upstream, the row itself disappears once the
  // drafts SSE topic fires and the parent list refetches. Until then, show a
  // quiet terminal line instead of live controls.
  if (discarded) return null;

  if (sent) {
    return (
      <SentRow
        id={draft.id}
        title={subjectDraft || t("drafts.noSubject")}
        subtitle={recipients.join(", ")}
        label={t("drafts.sent")}
      />
    );
  }

  return (
    <div
      ref={rowRef}
      className="surface surface-hover group scroll-mt-4 rounded-lg"
      style={rowTransition(draft.id)}
    >
      <div className="flex w-full flex-wrap items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => void toggle()}
          className="flex min-w-0 flex-1 basis-full items-center gap-2 text-left @md:basis-auto"
        >
          {markAccount && (
            <span className="shrink-0" data-tooltip={account.name}>
              <AccountDot color={account.color} className="block h-2 w-2" />
              <span className="sr-only">{account.name}</span>
            </span>
          )}
          <AvatarMark name={recipients[0] ?? ""} tone="tint-accent" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
              {isNew && <NewDot />}
              {subjectDraft || t("drafts.noSubject")}
            </p>
            {/* Open, the sheet below carries the full header; the row keeps
                only what identifies it. */}
            {!open && (
              <RecipientLine kind="to" addresses={to} self={account.name}>
                {draft.snippet && (
                  <span className="text-muted-foreground/70"> · {draft.snippet}</span>
                )}
              </RecipientLine>
            )}
          </div>
          <time
            dateTime={draft.date}
            className="shrink-0 self-start pt-0.5 font-mono text-2xs tabular-nums text-muted-foreground"
          >
            {dateLabel(draft.date)}
          </time>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Navigating away and refining are secondary to the row's own
              decision — they stay out of the way until the row is hovered. */}
          <HoverActions className="gap-1">
            <OpenExternalButton url={draft.webUrl} label={t("drafts.open")} />
            <RefineInChatButton conversationId={draft.conversationId} subject={draft.subject} />
          </HoverActions>
          <Button
            variant="ghost"
            size="icon-xs"
            className="icon-send"
            onClick={() => actions.arm("send")}
            disabled={actions.busy}
            loading={actions.busy && actions.pending === "send"}
            title={t("drafts.send")}
            aria-label={t("drafts.send")}
          >
            <Send />
          </Button>
          <Button
            variant="ghost-danger"
            size="icon-xs"
            className="icon-discard"
            onClick={() => actions.arm("discard")}
            disabled={actions.busy}
            loading={actions.busy && actions.pending === "discard"}
            title={t("drafts.discard")}
            aria-label={t("drafts.discard")}
          >
            <Trash2 />
          </Button>
          <ExpandButton open={open} onToggle={() => void toggle()} />
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-3 px-2.5 pb-3">
          {!detail ? (
            <LoadingRow className="py-1 text-xs" />
          ) : (
            <div className="flex flex-col gap-4 pl-8 pt-1">
              {/* The letter itself: mail headers over a hairline, then the
                  prose. The fields carry no fill of their own, they take one on
                  hover and the ring on focus, so a draft reads as a message and
                  only answers as a form once you reach for it. */}
              <div className="flex flex-col">
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 border-b border-border pb-3 pr-2 text-sm">
                  <span className="text-muted-foreground">{t("mail.to")}</span>
                  <span className="truncate" data-tooltip={to.join("\n")}>
                    {recipients.join(", ")}
                  </span>
                  {ccNames.length > 0 && (
                    <>
                      <span className="text-muted-foreground">{t("mail.cc")}</span>
                      <span className="truncate" data-tooltip={detail.cc}>
                        {ccNames.join(", ")}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">{t("mail.subject")}</span>
                  <Input
                    value={subjectDraft}
                    onChange={(e) => setSubjectDraft(e.target.value)}
                    placeholder={t("drafts.noSubject")}
                    disabled={actions.busy}
                    className="-mx-1.5 h-auto rounded-sm bg-transparent px-1.5 py-0.5 text-sm hover:bg-surface-2"
                  />
                </div>
                <Textarea
                  value={bodyDraft}
                  onChange={(e) => setBodyDraft(e.target.value)}
                  placeholder={t("drafts.emptyBodyText")}
                  disabled={actions.busy}
                  className="field-sizing-content -mx-1.5 mt-4 min-h-32 w-[calc(100%+0.75rem)] resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed hover:bg-surface-2"
                />
                {/* The account signature rides below the editable prose: the
                    server detached it from the body and re-appends it on save,
                    so it is shown but never editable here. */}
                {detail.signature && (
                  <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {detail.signature}
                  </p>
                )}
              </div>

              {dirty && (
                <EditSaveActions
                  saving={saving}
                  busy={actions.busy}
                  onCancel={cancelEdit}
                  onSave={() => void save()}
                />
              )}

              <ThreadHistory accountId={accountId} threadId={draft.threadId} self={account.name} />
            </div>
          )}
        </div>
      )}
      <DraftActionDialog
        pending={actions.pending}
        busy={actions.busy}
        onClose={actions.close}
        onConfirm={() => void actions.confirm()}
        labels={{
          send: { title: t("drafts.send"), description: t("drafts.sendConfirm") },
          discard: { title: t("drafts.discard"), description: t("drafts.discardConfirm") },
        }}
      />
    </div>
  );
}
