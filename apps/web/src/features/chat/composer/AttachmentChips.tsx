import { type ChatAttachment, type ChatAttachmentUpload, formatFileSize } from "@marlen/shared";
import { FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import { api } from "@/lib/api";

function hasPreviewData(
  attachment: ChatAttachment | ChatAttachmentUpload,
): attachment is ChatAttachmentUpload {
  return "data" in attachment;
}

function attachmentUrl(attachment: ChatAttachment | ChatAttachmentUpload): string {
  return hasPreviewData(attachment)
    ? `data:${attachment.mimeType};base64,${attachment.data}`
    : api.chatAttachmentUrl(attachment.id);
}

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: (ChatAttachment | ChatAttachmentUpload)[];
  onRemove?: (attachment: ChatAttachment | ChatAttachmentUpload) => void;
}) {
  const { t } = useTranslation();
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const icon =
          attachment.kind === "image" ? (
            <img
              src={attachmentUrl(attachment)}
              alt=""
              className="h-7 w-7 shrink-0 rounded-md object-cover"
            />
          ) : (
            <FileText className="h-4 w-4 shrink-0" aria-hidden />
          );
        const content = (
          <>
            {icon}
            <span className="min-w-0">
              <span className="block truncate">{attachment.name}</span>
              <span className="block text-3xs text-muted-foreground">
                {formatFileSize(attachment.size)}
              </span>
            </span>
          </>
        );

        return (
          <span
            key={attachment.id}
            className="flex max-w-64 items-center gap-2 rounded-lg bg-secondary px-2 py-1.5 text-xs text-secondary-foreground"
          >
            {onRemove ? (
              content
            ) : (
              <a
                href={attachmentUrl(attachment)}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-2 hover:text-foreground"
              >
                {content}
              </a>
            )}
            {onRemove && (
              <IconButton
                onClick={() => onRemove(attachment)}
                aria-label={t("chat.attachments.remove", { name: attachment.name })}
                title={t("chat.attachments.remove", { name: attachment.name })}
                className="ml-auto"
              >
                <X className="h-3 w-3" />
              </IconButton>
            )}
          </span>
        );
      })}
    </div>
  );
}
