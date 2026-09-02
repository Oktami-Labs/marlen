import type { Todo, TodoRef } from "@marlen/shared";
import { ChevronRight, Send, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DraftActionDialog, RefineInChatButton, useDraftActions } from "@/components/draftActions";
import { RecipientLine } from "@/components/MessageHeader";
import { AccountDot } from "@/components/ui/account-dot";
import { AvatarMark } from "@/components/ui/avatar-mark";
import { Button } from "@/components/ui/button";
import { HoverActions } from "@/components/ui/hover-actions";
import { SentRow } from "@/components/ui/list-row";
import { NewDot } from "@/features/home/seen";
import { ApprovalNote } from "@/features/home/TodoRow";
import { recipientNames, splitAddresses } from "@/lib/addresses";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { errorMessage, rowTransition, withViewTransition } from "@/lib/utils";

/** The agenda item wrapping an email draft. */
export type EmailApproval = Todo & { ref: Extract<TodoRef, { kind: "email_draft" }> };

/** One email draft awaiting approval on the agenda; click opens it on its own screen to read and edit. */
export function DraftRow({
  todo,
  color,
  markAccount,
  dateLabel,
  onOpen,
  onChanged,
  onError,
  isNew,
  onAnswer,
}: {
  todo: EmailApproval;
  /** The inbox's colour; the row wears it as a dot only when more than one inbox is in the list. */
  color?: string;
  markAccount?: boolean;
  dateLabel: (iso: string) => string;
  onOpen: () => void;
  /** The draft was sent or discarded: the agenda refetches without waiting on the event debounce. */
  onChanged: () => void;
  onError: (message: string | null) => void;
  /** Drafted since the user last looked, fronts the subject with the new dot. */
  isNew?: boolean;
  onAnswer: (label: string) => void;
}) {
  const { t } = useTranslation();
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
  const to = splitAddresses(ref.to);
  const recipients = recipientNames(to, ref.account, t("mail.me"));

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
    <div className="surface-hover group scroll-mt-4 rounded-md" style={rowTransition(todo.id)}>
      <div className="flex w-full flex-wrap items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 basis-full items-center gap-2 text-left @md:basis-0"
        >
          {markAccount && (
            <span className="shrink-0" data-tooltip={ref.account}>
              <AccountDot color={color} className="block h-2 w-2" />
              <span className="sr-only">{ref.account}</span>
            </span>
          )}
          <AvatarMark name={recipients[0] ?? ""} tone="tint-accent" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {isNew && <NewDot />}
              <span className="truncate">{subject}</span>
            </p>
            {/* The time shares the meta line, not the subject's: the subject is
                why the row exists and gets the whole width. */}
            <div className="flex items-baseline gap-2">
              <RecipientLine kind="to" addresses={to} self={ref.account}>
                {ref.snippet && <span className="text-muted-foreground/70"> · {ref.snippet}</span>}
              </RecipientLine>
              <time
                dateTime={todo.createdAt}
                className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground"
              >
                {dateLabel(todo.createdAt)}
              </time>
            </div>
          </div>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Refining is secondary to the row's own decision, so it stays out
              of the way until the row is hovered. */}
          <HoverActions className="gap-1">
            <RefineInChatButton
              conversationId={todo.conversationId ?? undefined}
              subject={todo.title}
            />
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
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onOpen}
            title={t("drafts.openReader")}
            aria-label={t("drafts.openReader")}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

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
    </div>
  );
}
