import type { Todo, TodoRef } from "@marlen/shared";
import { Send, Sparkles, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DiscussInChatButton, DraftActionDialog, useDraftActions } from "@/components/draftActions";
import { AvatarMark } from "@/components/ui/avatar-mark";
import { Button } from "@/components/ui/button";
import { SentRow } from "@/components/ui/list-row";
import { REWRITE_BAR_ENABLED } from "@/features/drafts/RewriteBar";
import { NeedsRow } from "@/features/home/NeedsRow";
import { ApprovalNote } from "@/features/home/TodoRow";
import { recipientNames, splitAddresses } from "@/lib/addresses";
import { api } from "@/lib/api";
import { whenLabel } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { errorMessage, rowTransition, withViewTransition } from "@/lib/utils";

/** The approval wrapping an email draft. */
export type EmailApproval = Todo & { ref: Extract<TodoRef, { kind: "email_draft" }> };

/** One email draft awaiting approval; pressing it opens the letter on its own screen to read and edit. */
export function DraftRow({
  todo,
  onOpen,
  onChanged,
  onError,
  isNew,
  onAnswer,
}: {
  todo: EmailApproval;
  /** Opens the letter; `rewrite` puts the caret in its instruction line. */
  onOpen: (opts?: { rewrite?: boolean }) => void;
  /** The draft was sent or discarded: the list refetches without waiting on the event debounce. */
  onChanged: () => void;
  onError: (message: string | null) => void;
  /** Drafted since the user last looked, fronts the subject with the new dot. */
  isNew?: boolean;
  onAnswer: (label: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { ref } = todo;
  const subject = todo.title || t("drafts.noSubject");
  // True right after a successful send, the row shows a brief "Sent" state
  // until the drafts SSE topic fires and the parent list refetch removes it.
  const [sent, setSent] = React.useState(false);
  // Discarded rows leave at once rather than waiting on the refetch, so the
  // view transition has a frame to animate the gap closed.
  const [discarded, setDiscarded] = React.useState(false);

  const actions = useDraftActions({
    send: async () => {
      onError(null);
      try {
        await api.sendDraft(ref.accountId, ref.draftId);
        withViewTransition(() => setSent(true));
        toast.success(t("drafts.sentToast"));
        onChanged();
        return true;
      } catch (err) {
        onError(errorMessage(err));
        return false;
      }
    },
    discard: async () => {
      onError(null);
      try {
        await api.deleteDraft(ref.accountId, ref.draftId);
        withViewTransition(() => setDiscarded(true));
        onChanged();
        return true;
      } catch (err) {
        onError(errorMessage(err));
        return false;
      }
    },
  });

  // The row fronts the person the draft goes to, as a mail client does.
  const recipients = recipientNames(splitAddresses(ref.to), ref.account, t("mail.me"));
  const name = recipients[0] ?? ref.to;

  if (discarded) return null;

  if (sent) {
    return (
      <SentRow
        id={todo.id}
        title={subject}
        subtitle={recipients.join(", ")}
        label={t("drafts.sent")}
      />
    );
  }

  return (
    <NeedsRow
      style={rowTransition(todo.id)}
      mark={<AvatarMark name={name} tone="tint-accent" size="sm" />}
      title={subject}
      meta={`${t("home.approvalEmailTo", { name })} · ${whenLabel(todo.createdAt, i18n.language)}`}
      isNew={isNew}
      onPress={() => onOpen()}
      actions={
        <>
          {/* Rewording happens in the letter, so this opens it rather than
              carrying an instruction line into every row. */}
          {REWRITE_BAR_ENABLED && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="icon-refine hover:bg-accent/10 hover:text-accent-text"
              onClick={(e) => {
                e.stopPropagation();
                onOpen({ rewrite: true });
              }}
              disabled={actions.busy}
              title={t("drafts.rewrite")}
              aria-label={t("drafts.rewrite")}
            >
              <Sparkles />
            </Button>
          )}
          <DiscussInChatButton conversationId={todo.conversationId} />
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
        </>
      }
    >
      <ApprovalNote todo={todo} disabled={actions.busy} onAnswer={onAnswer} />
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
    </NeedsRow>
  );
}
