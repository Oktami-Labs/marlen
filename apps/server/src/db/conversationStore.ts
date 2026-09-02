import { eq } from "drizzle-orm";
import { emitServerEvent } from "../core/events.js";
import { db, schema } from "./index.js";

/**
 * Create/delete lifecycle for the Conversation row (a chat, id = a uuid, or an
 * automation run mirror, id = the run id) and the "conversations" emits that go
 * with it. Other conversation-table access stays where it is.
 */

export interface EnsureConversationInput {
  type: "chat" | "automation";
  title: string;
}

/**
 * Idempotently create the parent Conversation row (onConflictDoNothing makes
 * repeat calls no-ops). Returns true only when this call created the row, which
 * is also the only case that emits "conversations".
 */
export async function ensureConversation(
  id: string,
  input: EnsureConversationInput,
): Promise<boolean> {
  const result = await db
    .insert(schema.conversations)
    .values({ id, title: input.title, type: input.type, createdAt: new Date().toISOString() })
    .onConflictDoNothing({ target: schema.conversations.id });
  const created = result.changes > 0;
  if (created) emitServerEvent("conversations");
  return created;
}

// Deletes a conversation, its messages, and their attachments in one
// transaction. agent_drafts rows are left alone deliberately: a snapshot's
// conversationId is a navigation link, not an ownership edge, and a dangling
// link degrades to "no link" at read time.
function deleteConversationRows(id: string): void {
  db.transaction((tx) => {
    tx.delete(schema.chatAttachments).where(eq(schema.chatAttachments.conversationId, id)).run();
    tx.delete(schema.messages).where(eq(schema.messages.conversationId, id)).run();
    tx.delete(schema.conversations).where(eq(schema.conversations.id, id)).run();
  });
}

export function deleteConversationCascade(id: string): void {
  deleteConversationRows(id);
  emitServerEvent("conversations");
}
