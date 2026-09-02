import { randomUUID } from "node:crypto";
import type { Todo, TodoOption, TodoRef, TodoStatus } from "@marlen/shared";
import { and, asc, eq, like } from "drizzle-orm";
import { emitServerEvent } from "../core/events.js";
import { db, schema } from "./index.js";

type TodoRow = typeof schema.todos.$inferSelect;

function assemble(todo: TodoRow): Todo {
  return {
    id: todo.id,
    kind: todo.kind,
    ref: todo.ref ? (JSON.parse(todo.ref) as TodoRef) : null,
    title: todo.title,
    body: todo.body,
    status: todo.status,
    dueAt: todo.dueAt,
    position: todo.position,
    conversationId: todo.conversationId,
    linkedAutomationId: todo.linkedAutomationId,
    options: JSON.parse(todo.options) as TodoOption[],
    answer: todo.answer,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

function serializeOptions(options: TodoOption[] | undefined): string {
  return JSON.stringify(
    (options ?? [])
      .map((option) => ({
        label: option.label.trim(),
        ...(option.detail?.trim() ? { detail: option.detail.trim() } : {}),
      }))
      .filter((option) => option.label),
  );
}

export async function listTodos(filter: { status?: TodoStatus } = {}): Promise<Todo[]> {
  const base = db.select().from(schema.todos);
  const rows = await (filter.status
    ? base.where(eq(schema.todos.status, filter.status))
    : base
  ).orderBy(asc(schema.todos.position), asc(schema.todos.createdAt));
  return rows.map(assemble);
}

export async function getTodo(id: string): Promise<Todo | null> {
  const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, id));
  return row ? assemble(row) : null;
}

/** An open todo carrying this dedup key, so a repeating run reuses it instead of duplicating. */
async function findOpenTodoByKey(key: string): Promise<Todo | null> {
  if (!key) return null;
  const [row] = await db
    .select()
    .from(schema.todos)
    .where(and(eq(schema.todos.dedupeKey, key), eq(schema.todos.status, "open")));
  return row ? assemble(row) : null;
}

export interface TodoInput {
  title: string;
  body?: string;
  dueAt?: string | null;
  conversationId?: string | null;
  linkedAutomationId?: string | null;
  options?: TodoOption[];
  key?: string;
}

export async function createTodo(input: TodoInput): Promise<{ todo: Todo; created: boolean }> {
  const key = input.key?.trim() ?? "";
  const existing = await findOpenTodoByKey(key);
  if (existing) return { todo: existing, created: false };

  const now = new Date().toISOString();
  const id = randomUUID();
  await db.insert(schema.todos).values({
    id,
    title: input.title.trim(),
    body: input.body?.trim() ?? "",
    status: "open",
    dueAt: input.dueAt ?? null,
    // New todos append to the end of the manual order; drag rewrites it.
    position: Date.now(),
    conversationId: input.conversationId ?? null,
    linkedAutomationId: input.linkedAutomationId ?? null,
    options: serializeOptions(input.options),
    dedupeKey: key,
    createdAt: now,
    updatedAt: now,
  });

  emitServerEvent("todos");
  return { todo: (await getTodo(id)) as Todo, created: true };
}

/**
 * An approval row for the draft `key` names: filed open on first sight, then
 * kept current (the draft's subject, recipients, body) without touching what
 * the agent or user added to it. `createdAt` is the draft's own date, so the
 * agenda measures how long it has waited. Emits only on a change.
 */
export async function syncApproval(input: {
  key: string;
  title: string;
  ref: TodoRef;
  conversationId?: string | null;
  createdAt: string;
}): Promise<void> {
  const existing = await findOpenTodoByKey(input.key);
  const ref = JSON.stringify(input.ref);
  const conversationId = input.conversationId ?? null;
  if (existing) {
    if (
      existing.title === input.title &&
      JSON.stringify(existing.ref) === ref &&
      existing.conversationId === conversationId
    ) {
      return;
    }
    await db
      .update(schema.todos)
      .set({ title: input.title, ref, conversationId, updatedAt: new Date().toISOString() })
      .where(eq(schema.todos.id, existing.id));
    emitServerEvent("todos");
    return;
  }
  await db.insert(schema.todos).values({
    id: randomUUID(),
    kind: "approval",
    ref,
    title: input.title,
    status: "open",
    position: Date.now(),
    conversationId,
    dedupeKey: input.key,
    createdAt: input.createdAt,
    updatedAt: new Date().toISOString(),
  });
  emitServerEvent("todos");
}

/** The draft is gone: sent closes its approval as done, discarded as dismissed. */
export async function closeApproval(key: string, status: "done" | "dismissed"): Promise<boolean> {
  const existing = await findOpenTodoByKey(key);
  if (!existing) return false;
  await db
    .update(schema.todos)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(schema.todos.id, existing.id));
  emitServerEvent("todos");
  return true;
}

/** Keys of the open approvals under one prefix, for reconciling against a draft list. */
export async function openApprovalKeys(prefix: string): Promise<string[]> {
  const rows = await db
    .select({ key: schema.todos.dedupeKey })
    .from(schema.todos)
    .where(
      and(
        eq(schema.todos.kind, "approval"),
        eq(schema.todos.status, "open"),
        like(schema.todos.dedupeKey, `${prefix}%`),
      ),
    );
  return rows.map((row) => row.key);
}

export interface TodoUpdate {
  title?: string;
  body?: string;
  status?: TodoStatus;
  /** ISO due date/time; "" or null clears it. */
  dueAt?: string | null;
  /** Manual sort key within its agenda group (drag-and-drop). */
  position?: number;
  /** Automation fired on completion; null unlinks. */
  linkedAutomationId?: string | null;
  /** Complete replacement; an empty list turns the decision back into a plain todo. */
  options?: TodoOption[];
  /** The option chosen; written together with status "done". */
  answer?: string | null;
}

/** The single maintenance verb (agent tool, routes, and drag all route here). */
export async function updateTodo(id: string, update: TodoUpdate): Promise<Todo | null> {
  const existing = await getTodo(id);
  if (!existing) return null;

  const fields: Partial<TodoRow> = { updatedAt: new Date().toISOString() };
  if (update.title !== undefined) fields.title = update.title.trim();
  if (update.body !== undefined) fields.body = update.body.trim();
  if (update.dueAt !== undefined) fields.dueAt = update.dueAt || null;
  if (update.position !== undefined) fields.position = update.position;
  if (update.linkedAutomationId !== undefined) {
    fields.linkedAutomationId = update.linkedAutomationId || null;
  }
  if (update.options !== undefined) fields.options = serializeOptions(update.options);
  if (update.answer !== undefined) fields.answer = update.answer?.trim() || null;
  if (update.status !== undefined) fields.status = update.status;
  await db.update(schema.todos).set(fields).where(eq(schema.todos.id, id));

  emitServerEvent("todos");
  return getTodo(id);
}
