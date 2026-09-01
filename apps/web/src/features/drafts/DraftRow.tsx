import type { EmailDraft } from "@marlen/shared";
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
import { recipientNames, splitAddresses } from "@/lib/addresses";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { errorMessage, rowTransition, withViewTransition } from "@/lib/utils";

/** One draft in the approval list; click opens it on its own screen to read and edit. */
export function DraftRow({
  accountId,
  account,
  markAccount,
  draft,
  dateLabel,
  onOpen,
  onDeleted,
  onError,
  isNew,
}: {
  accountId: string;
  /** The inbox this draft sits in; its address is what a thread reads as "me". */
  account: { name: string; color?: string };
  /** Set when more than one inbox is in the list: marks the row with its account's dot. */
  markAccount?: boolean;
  draft: EmailDraft;
  dateLabel: (iso: string) => string;
  onOpen: () => void;
  onDeleted: () => void;
  onError: (message: string | null) => void;
  /** Drafted since the user last looked, fronts the subject with the new dot. */
  isNew?: boolean;
}) {
  const { t } = useTranslation();
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
        await api.sendDraft(accountId, draft.id);
        withViewTransition(() => setSent(true));
        toast.success(t("drafts.sentToast"));
        return true;
      } catch (err) {
        onError(errorMessage(err));
        return false;
      }
    },
    discard: async () => {
      onError(null);
      try {
        await api.deleteDraft(accountId, draft.id);
        withViewTransition(() => setDiscarded(true));
        onDeleted();
        return true;
      } catch (err) {
        onError(errorMessage(err));
        return false;
      }
    },
  });

  // The row fronts the person the draft goes to, as a mail client does.
  const to = splitAddresses(draft.to);
  const recipients = recipientNames(to, account.name, t("mail.me"));

  if (discarded) return null;

  if (sent) {
    return (
      <SentRow
        id={draft.id}
        title={draft.subject || t("drafts.noSubject")}
        subtitle={recipients.join(", ")}
        label={t("drafts.sent")}
      />
    );
  }

  return (
    <div
      className="surface surface-hover group scroll-mt-4 rounded-lg"
      style={rowTransition(draft.id)}
    >
      <div className="flex w-full flex-wrap items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 basis-full items-center gap-2 text-left @md:basis-0"
        >
          {markAccount && (
            <span className="shrink-0" data-tooltip={account.name}>
              <AccountDot color={account.color} className="block h-2 w-2" />
              <span className="sr-only">{account.name}</span>
            </span>
          )}
          <AvatarMark name={recipients[0] ?? ""} tone="tint-accent" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {isNew && <NewDot />}
              <span className="truncate">{draft.subject || t("drafts.noSubject")}</span>
            </p>
            {/* The time shares the meta line, not the subject's: the subject is
                why the row exists and gets the whole width. */}
            <div className="flex items-baseline gap-2">
              <RecipientLine kind="to" addresses={to} self={account.name}>
                {draft.snippet && (
                  <span className="text-muted-foreground/70"> · {draft.snippet}</span>
                )}
              </RecipientLine>
              <time
                dateTime={draft.date}
                className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-muted-foreground"
              >
                {dateLabel(draft.date)}
              </time>
            </div>
          </div>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Refining is secondary to the row's own decision, so it stays out
              of the way until the row is hovered. */}
          <HoverActions className="gap-1">
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
