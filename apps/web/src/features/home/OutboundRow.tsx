import { OUTBOUND_CHANNEL_LABELS, type Todo, type TodoRef } from "@marlen/shared";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  DraftActionDialog,
  EditSaveActions,
  RefineInChatButton,
  useDraftActions,
} from "@/components/draftActions";
import { Button } from "@/components/ui/button";
import { ExpandButton } from "@/components/ui/disclosure-toggle";
import { HoverActions } from "@/components/ui/hover-actions";
import { IconChip } from "@/components/ui/icon-chip";
import { SentRow } from "@/components/ui/list-row";
import { Textarea } from "@/components/ui/textarea";
import { NewDot } from "@/features/home/seen";
import { ApprovalNote } from "@/features/home/TodoRow";
import { api, isNotFound } from "@/lib/api";
import { toast } from "@/lib/toast";
import { errorMessage, rowTransition, withViewTransition } from "@/lib/utils";

/**
 * One outbound message awaiting approval (WhatsApp today) in the attention
 * list, the channel counterpart of the email DraftRow, on the same
 * arm→confirm→execute machinery, and editable in place the same way. Sending
 * dispatches through POST /api/outbound/:id/send, the click is the
 * authorization.
 */
/** The agenda item wrapping an outbound message. */
export type OutboundApproval = Todo & { ref: Extract<TodoRef, { kind: "outbound" }> };

export function OutboundRow({
  todo,
  dateLabel,
  onChanged,
  onError,
  isNew,
  onAnswer,
}: {
  todo: OutboundApproval;
  dateLabel: (iso: string) => string;
  /** Called after a send/discard succeeds, so the list refetches without waiting on the event debounce. */
  onChanged: () => void;
  onError: (message: string | null) => void;
  /** Drafted since the user last looked, fronts the title with the new dot. */
  isNew?: boolean;
  onAnswer: (label: string) => void;
}) {
  const { t } = useTranslation();
  const { ref } = todo;
  const [open, setOpen] = React.useState(false);
  // Editable body: `bodyDraft` is the live field value, `savedBody` the
  // last-persisted baseline it's compared against for the dirty flag.
  const [bodyDraft, setBodyDraft] = React.useState(ref.body);
  const [savedBody, setSavedBody] = React.useState(ref.body);
  const [saving, setSaving] = React.useState(false);
  // True right after a send, a quiet terminal line until the "outbound"
  // server event removes the row from the open list.
  const [sent, setSent] = React.useState(false);
  // Discarded rows leave at once rather than waiting on the refetch, so the
  // view transition has a frame to animate the gap closed.
  const [discarded, setDiscarded] = React.useState(false);

  const dirty = bodyDraft !== savedBody;

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await api.updateOutbound(ref.outboundId, { body: bodyDraft });
      setSavedBody(bodyDraft);
      toast.success(t("common.saved"));
      onChanged();
    } catch (err) {
      // Keep the typed text, only the banner reflects the failure.
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const actions = useDraftActions({
    // Flushes any unsaved edits first: the channel sends the stored body.
    send: async () => {
      onError(null);
      try {
        if (dirty) {
          await api.updateOutbound(ref.outboundId, { body: bodyDraft });
          setSavedBody(bodyDraft);
        }
        await api.sendOutbound(ref.outboundId);
        withViewTransition(() => setSent(true));
        toast.success(t("home.outboundSentToast"));
        onChanged();
        return true;
      } catch (err) {
        if (isNotFound(err)) {
          onChanged();
          return true;
        }
        onError(errorMessage(err));
        return false;
      }
    },
    discard: async () => {
      onError(null);
      try {
        await api.discardOutbound(ref.outboundId);
        withViewTransition(() => setDiscarded(true));
        onChanged();
        return true;
      } catch (err) {
        if (isNotFound(err)) {
          onChanged();
          return true;
        }
        onError(errorMessage(err));
        return false;
      }
    },
  });

  const channelLabel = OUTBOUND_CHANNEL_LABELS[ref.channel] ?? ref.channel;
  const title = ref.targetLabel || channelLabel;

  if (discarded) return null;

  if (sent) {
    return (
      <SentRow
        id={todo.id}
        title={title}
        subtitle={channelLabel}
        label={t("chat.cards.messageDraft.sentLabel")}
      />
    );
  }

  return (
    <div className="surface-hover group rounded-md" style={rowTransition(todo.id)}>
      <div className="flex w-full flex-wrap items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 basis-full items-center gap-2 text-left @md:basis-0"
        >
          <IconChip size="sm" tone="tint-success">
            <MessageSquare />
          </IconChip>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {isNew && <NewDot />}
              <span className="truncate">{title}</span>
            </p>
            {/* The waiting-since time sits where the email rows carry theirs, so
                one approval list reads as one list. */}
            <div className="flex items-baseline gap-2">
              <p className="truncate text-xs text-muted-foreground">
                {channelLabel}
                {!open && <span className="text-muted-foreground/70"> · {savedBody}</span>}
              </p>
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
          {/* Keep the secondary refine action hidden until hover. */}
          <HoverActions className="gap-1">
            <RefineInChatButton conversationId={todo.conversationId} subject={title} />
          </HoverActions>
          <Button
            variant="ghost"
            size="icon-xs"
            className="icon-send"
            onClick={() => actions.arm("send")}
            disabled={actions.busy}
            loading={actions.busy && actions.pending === "send"}
            title={t("chat.cards.draft.send")}
            aria-label={t("chat.cards.draft.send")}
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
            title={t("chat.cards.draft.discard")}
            aria-label={t("chat.cards.draft.discard")}
          >
            <Trash2 />
          </Button>
          <ExpandButton open={open} onToggle={() => setOpen((v) => !v)} />
        </div>
      </div>

      <ApprovalNote todo={todo} disabled={actions.busy} onAnswer={onAnswer} />

      {open && (
        <div className="px-2.5 pb-3">
          <div className="flex flex-col gap-2 pl-8 pt-1">
            <Textarea
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              disabled={actions.busy}
              className="field-sizing-content min-h-[4.5rem] resize-none text-sm leading-relaxed text-foreground/90"
            />
            {dirty && (
              <EditSaveActions
                saving={saving}
                busy={actions.busy}
                onCancel={() => setBodyDraft(savedBody)}
                onSave={() => void save()}
              />
            )}
          </div>
        </div>
      )}

      <DraftActionDialog
        pending={actions.pending}
        busy={actions.busy}
        onClose={actions.close}
        onConfirm={actions.confirm}
        labels={{
          send: {
            title: t("chat.cards.draft.send"),
            description: t("chat.cards.messageDraft.sendConfirm"),
          },
          discard: {
            title: t("chat.cards.draft.discard"),
            description: t("chat.cards.messageDraft.discardConfirm"),
          },
        }}
      />
    </div>
  );
}
