import { MessagesSquare } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revealChat, sendChatCommand } from "@/features/chat/controller";

/** A draft action pending confirmation in the shared armed dialog. */
export type DraftAction = "send" | "discard";

/**
 * The arm → confirm → execute machinery every surface that sends or discards
 * a draft shares (Home's DraftRow, the chat's EmailDraftCard). The callbacks
 * own their surface's API call and error semantics, inline banner on one,
 * card status/toast on the other, while the hook owns arming, the busy
 * flag, and closing the dialog afterwards, so the two surfaces cannot drift
 * in how an action is confirmed.
 */
export function useDraftActions(callbacks: {
  send: () => Promise<boolean>;
  discard: () => Promise<boolean>;
}): {
  pending: DraftAction | null;
  busy: boolean;
  arm: (action: DraftAction) => void;
  close: () => void;
  confirm: () => Promise<boolean>;
} {
  const [pending, setPending] = React.useState<DraftAction | null>(null);
  const [busy, setBusy] = React.useState(false);

  const confirm = async () => {
    if (!pending) return false;
    setBusy(true);
    try {
      return await (pending === "send" ? callbacks.send() : callbacks.discard());
    } finally {
      setBusy(false);
    }
  };

  return {
    pending,
    busy,
    arm: (action: DraftAction) => setPending(action),
    close: () => setPending(null),
    confirm,
  };
}

/** The armed confirm dialog for those actions; each surface supplies its own labels. */
export function DraftActionDialog({
  pending,
  busy,
  onClose,
  onConfirm,
  labels,
}: {
  pending: DraftAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
  /** Title doubles as the confirm-button label, matching both surfaces today. */
  labels: Record<DraftAction, { title: string; description: string }>;
}) {
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={pending ? labels[pending].title : ""}
      description={pending ? labels[pending].description : ""}
      confirmLabel={pending ? labels[pending].title : ""}
      variant={pending === "send" ? "default" : "destructive"}
      busy={busy}
      onConfirm={onConfirm}
    />
  );
}

/**
 * Reopens the conversation that wrote a message, for the asks its own row
 * cannot serve: looking something up, checking the thread, attaching a file.
 * Nothing to open on a message written outside a chat, so the action is absent
 * there rather than starting cold.
 */
export function DiscussInChatButton({
  conversationId,
  label,
}: {
  conversationId?: string | null;
  /** Renders the action as a labelled button; without it, a bare row icon. */
  label?: string;
}) {
  const { t } = useTranslation();
  const title = t("drafts.discussInChat");
  if (!conversationId) return null;
  return (
    <Button
      variant="ghost"
      size={label ? "sm" : "icon-xs"}
      className="hover:bg-accent/10 hover:text-accent-text"
      onClick={(e) => {
        e.stopPropagation();
        revealChat();
        sendChatCommand({ kind: "open", conversationId });
      }}
      title={title}
      aria-label={label ?? title}
    >
      <MessagesSquare />
      {label}
    </Button>
  );
}

/**
 * The cancel/save footer an in-place draft edit reveals once it is dirty, and
 * the keep/drop decision a pending rewrite reveals, which is the same pair of
 * buttons under different words.
 */
export function EditSaveActions({
  saving,
  busy,
  cancelLabel,
  saveLabel,
  onCancel,
  onSave,
}: {
  saving: boolean;
  busy: boolean;
  cancelLabel?: string;
  saveLabel?: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving || busy}>
        {cancelLabel ?? t("common.cancel")}
      </Button>
      <Button size="sm" onClick={onSave} disabled={busy} loading={saving}>
        {saving ? t("common.saving") : (saveLabel ?? t("drafts.save"))}
      </Button>
    </div>
  );
}
