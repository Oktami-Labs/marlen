import { OUTBOUND_CHANNEL_LABELS, type Todo, type TodoRef } from "@marlen/shared";
import { MessageCircle, Send, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  DraftActionDialog,
  EditSaveActions,
  RefineInChatButton,
  useDraftActions,
} from "@/components/draftActions";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { SentRow } from "@/components/ui/list-row";
import { Textarea } from "@/components/ui/textarea";
import { NeedsRow } from "@/features/home/NeedsRow";
import { ApprovalNote, firstLine } from "@/features/home/TodoRow";
import { api, isNotFound } from "@/lib/api";
import { whenLabel } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { errorMessage, rowTransition, withViewTransition } from "@/lib/utils";

/** The approval wrapping an outbound message. */
export type OutboundApproval = Todo & { ref: Extract<TodoRef, { kind: "outbound" }> };

/**
 * One outbound message awaiting approval (WhatsApp today), the channel
 * counterpart of the email DraftRow on the same arm→confirm→execute machinery.
 * Pressing the row unfolds the message to edit it in place. Sending
 * dispatches through POST /api/outbound/:id/send, the click is the
 * authorization.
 */
export function OutboundRow({
  todo,
  onChanged,
  onError,
  isNew,
  onAnswer,
}: {
  todo: OutboundApproval;
  /** Called after a send/discard succeeds, so the list refetches without waiting on the event debounce. */
  onChanged: () => void;
  onError: (message: string | null) => void;
  /** Drafted since the user last looked, fronts the title with the new dot. */
  isNew?: boolean;
  onAnswer: (label: string) => void;
}) {
  const { t, i18n } = useTranslation();
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
  // The message itself is the subject line; the person and the channel are the meta.
  const title = firstLine(savedBody) || todo.title;

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
    <NeedsRow
      style={rowTransition(todo.id)}
      mark={
        <IconChip size="sm" tone="tint-success">
          <MessageCircle />
        </IconChip>
      }
      title={title}
      meta={`${t("home.approvalChannelTo", { channel: channelLabel, name: todo.title })} · ${whenLabel(todo.createdAt, i18n.language)}`}
      isNew={isNew}
      onPress={() => withViewTransition(() => setOpen((v) => !v))}
      expanded={open}
      actions={
        <>
          <RefineInChatButton conversationId={todo.conversationId} subject={title} />
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
        </>
      }
    >
      <ApprovalNote todo={todo} disabled={actions.busy} onAnswer={onAnswer} />
      {open && (
        <>
          <Textarea
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            disabled={actions.busy}
            aria-label={t("drafts.bodyLabel")}
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
        </>
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
    </NeedsRow>
  );
}
