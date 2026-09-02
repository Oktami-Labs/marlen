import { randomUUID } from "node:crypto";
import type { OutboundDraft, OutboundStatus } from "@marlen/shared";
import { desc, eq } from "drizzle-orm";
import { emitServerEvent } from "../core/events.js";
import { db, schema } from "./index.js";
import { closeApproval, syncApproval } from "./todos.js";

/**
 * Pending outbound messages for comm channels without a native provider draft
 * (WhatsApp today), the counterpart to draftStore.ts for email. The row is
 * inert until a human clicks Send on its card, or an armed autosend dispatches
 * it; the channel registry (services/outbound) owns the actual sending.
 */

const outboundApprovalKey = (id: string) => `approval:outbound:${id}`;

/** The draft's row on the Home agenda: open while it waits, closed with its fate. */
async function syncAgenda(draft: OutboundDraft): Promise<void> {
  const key = outboundApprovalKey(draft.id);
  if (draft.status !== "open") {
    await closeApproval(key, draft.status === "sent" ? "done" : "dismissed");
    return;
  }
  await syncApproval({
    key,
    title: draft.targetLabel || draft.channel,
    ref: {
      kind: "outbound",
      outboundId: draft.id,
      channel: draft.channel,
      targetLabel: draft.targetLabel,
      body: draft.body,
    },
    conversationId: draft.conversationId,
    createdAt: draft.createdAt,
  });
}

export interface OutboundDraftInput {
  channel: string;
  /** Channel-native recipient address (a WhatsApp jid). */
  target: string;
  targetLabel?: string;
  body: string;
  /** The conversation drafting it, so Home can reopen it to refine. */
  conversationId?: string;
}

export async function createOutboundDraft(input: OutboundDraftInput): Promise<OutboundDraft> {
  const now = new Date().toISOString();
  const draft: OutboundDraft = {
    id: randomUUID(),
    channel: input.channel,
    target: input.target,
    targetLabel: input.targetLabel?.trim() ?? "",
    body: input.body,
    status: "open",
    sentRef: null,
    conversationId: input.conversationId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.outboundDrafts).values(draft);
  emitServerEvent("outbound");
  await syncAgenda(draft);
  return draft;
}

export interface OutboundDraftPatch {
  target?: string;
  targetLabel?: string;
  body?: string;
}

/** Rewrites a draft in place; callers verify the draft is still open first. */
export async function updateOutboundDraft(id: string, patch: OutboundDraftPatch): Promise<void> {
  await db
    .update(schema.outboundDrafts)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(schema.outboundDrafts.id, id));
  emitServerEvent("outbound");
  const draft = await getOutboundDraft(id);
  if (draft) await syncAgenda(draft);
}

export async function getOutboundDraft(id: string): Promise<OutboundDraft | null> {
  const [row] = await db
    .select()
    .from(schema.outboundDrafts)
    .where(eq(schema.outboundDrafts.id, id));
  return (row as OutboundDraft | undefined) ?? null;
}

export async function listOutboundDrafts(status?: OutboundStatus): Promise<OutboundDraft[]> {
  const rows = await db
    .select()
    .from(schema.outboundDrafts)
    .where(status ? eq(schema.outboundDrafts.status, status) : undefined)
    .orderBy(desc(schema.outboundDrafts.createdAt));
  return rows as OutboundDraft[];
}

export async function markOutboundStatus(
  id: string,
  status: OutboundStatus,
  sentRef?: string,
): Promise<boolean> {
  const existing = await getOutboundDraft(id);
  if (!existing) return false;
  await db
    .update(schema.outboundDrafts)
    .set({
      status,
      ...(sentRef !== undefined ? { sentRef } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.outboundDrafts.id, id));
  emitServerEvent("outbound");
  await syncAgenda({ ...existing, status });
  return true;
}
