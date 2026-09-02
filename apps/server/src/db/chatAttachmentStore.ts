import type { ChatAttachment } from "@marlen/shared";
import { eq } from "drizzle-orm";
import type { PreparedChatAttachment } from "../services/chatAttachments.js";
import { db, schema } from "./index.js";

type AttachmentRow = typeof schema.chatAttachments.$inferSelect;

export function attachmentMetadata(row: AttachmentRow): ChatAttachment {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    kind: row.kind,
  };
}

export function attachmentFromRow(row: AttachmentRow): PreparedChatAttachment {
  const base = { ...attachmentMetadata(row), data: row.data };
  return row.kind === "image"
    ? { ...base, kind: "image" }
    : { ...base, kind: "document", extractedText: row.extractedText as string };
}

export async function listConversationAttachments(
  conversationId: string,
): Promise<AttachmentRow[]> {
  return db
    .select()
    .from(schema.chatAttachments)
    .where(eq(schema.chatAttachments.conversationId, conversationId))
    .orderBy(schema.chatAttachments.messageId, schema.chatAttachments.position);
}

export async function getChatAttachment(attachmentId: string): Promise<AttachmentRow | null> {
  const [row] = await db
    .select()
    .from(schema.chatAttachments)
    .where(eq(schema.chatAttachments.id, attachmentId));
  return row ?? null;
}
