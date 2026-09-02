import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AccountColor, AccountDrafts, Automation, Todo } from "@marlen/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, CircleCheck, Menu, Plus } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AccountDot } from "@/components/ui/account-dot";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/section-header";
import { Select } from "@/components/ui/select";
import { DraftRow } from "@/features/drafts/DraftRow";
import { agendaMs, DAY_MS, dayIso, startOfDayMs } from "@/features/home/agenda";
import { OutboundRow } from "@/features/home/OutboundRow";
import { type Seen, SeenOnInteract, todoSeenKey } from "@/features/home/seen";
import { DoneTodoRow, TodoRow, useTodoPatch } from "@/features/home/TodoRow";
import { accountColor } from "@/lib/accounts";
import { api } from "@/lib/api";
import { dayLabel, waitingLabel } from "@/lib/dates";
import type { View } from "@/lib/nav";
import { openConversationInChat } from "@/lib/quickActions";
import { cn, errorMessage, midpoint, rowTransition, stagger } from "@/lib/utils";

const OVERDUE = "overdue";
const ANYTIME = "anytime";
const dayGroupId = (ms: number) => `day:${ms}`;

type Group = {
  id: string;
  heading: string;
  overdue: boolean;
  droppable: boolean;
  /** The sortable items, in display order. */
  todos: Todo[];
};

/**
 * "Zu erledigen", everything waiting on the user on one time axis: what was
 * missed, then the days ahead, then undated todos. Todos, decisions and
 * drafts awaiting approval are one list (kind tells the row apart); an
 * undated approval counts as due the day it was drafted, so it sits under
 * Today until it has waited a few days. Drag an item onto another day to
 * reschedule, or onto "Anytime" to undate it; mutations are optimistic and
 * the "todos" server event reconciles the cache.
 */
export function AttentionSection({
  automations,
  drafts,
  colors,
  onOpenDraft,
  onDraftsChanged,
  onNavigate,
  seen,
  newCount,
}: {
  automations: Automation[] | null;
  /** The connected inboxes and their live drafts; null while the (slow, live-mailbox) fetch is in flight. Read for the account filter and per-inbox errors; the rows come from the todos list. */
  drafts: AccountDrafts[] | null;
  colors: AccountColor[];
  /** Opens one draft on the reading screen that replaces this panel. */
  onOpenDraft: (accountId: string, draftId: string) => void;
  /** A draft row was sent/discarded: refresh the drafts list without waiting on the event debounce. */
  onDraftsChanged: () => void;
  onNavigate: (view: View) => void;
  seen: Seen;
  /** Items filed since the user last looked, page-wide; lights the mark-all-seen action. */
  newCount: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const _navigate = useNavigate();
  const [adding, setAdding] = React.useState(false);
  const [showDone, setShowDone] = React.useState(false);
  /** Account id, or "all", narrows the email approvals only. */
  const [accountFilter, setAccountFilter] = React.useState("all");
  const [rowError, setRowError] = React.useState<string | null>(null);

  const todosQuery = useQuery({ queryKey: ["todos"], queryFn: () => api.todos("open") });
  const doneQuery = useQuery({ queryKey: ["todos", "done"], queryFn: () => api.todos("done") });
  const patch = useTodoPatch();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const todos = todosQuery.data ?? [];
  // Sent drafts close as done too, but only a todo can be reopened from the history.
  const done = (doneQuery.data ?? [])
    .filter((td) => td.kind === "todo")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const restoreTodo = (id: string) =>
    patch(id, { status: "open" }, (list) => list.filter((td) => td.id !== id), {
      key: ["todos", "done"],
    });
  const todayStart = startOfDayMs(new Date());

  // With one mailbox connected a color says nothing, so the dots and the filter
  // that reads as their legend both appear only from the second one on.
  const inboxes = drafts ?? [];
  const manyAccounts = inboxes.length > 1;
  const visible = todos.filter(
    (td) =>
      accountFilter === "all" ||
      td.ref?.kind !== "email_draft" ||
      td.ref.accountId === accountFilter,
  );

  // Partition onto the time axis: missed / dated-by-day / anytime.
  const at = new Map(visible.map((td) => [td.id, agendaMs(td, todayStart)] as const));
  const dayOf = (td: Todo) => {
    const ms = at.get(td.id) ?? null;
    return ms === null ? null : startOfDayMs(new Date(ms));
  };
  const byTime = (a: Todo, b: Todo) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0);
  const overdueTodos = visible
    .filter((td) => {
      const day = dayOf(td);
      return day !== null && day < todayStart;
    })
    .sort(byTime);
  const anytimeTodos = visible.filter((td) => dayOf(td) === null);
  const datedTodos = visible.filter((td) => {
    const day = dayOf(td);
    return day !== null && day >= todayStart;
  });

  const dayKeys = new Set<number>();
  for (const td of datedTodos) dayKeys.add(dayOf(td) as number);

  const dayHeading = (ms: number): string => {
    if (ms === todayStart) return t("home.todosToday");
    if (ms === todayStart + DAY_MS) return t("home.todosTomorrow");
    return dayLabel(new Date(ms).toISOString(), lang);
  };

  const groups: Group[] = [];
  if (overdueTodos.length > 0) {
    groups.push({
      id: OVERDUE,
      heading: t("home.todosOverdue"),
      overdue: true,
      droppable: false,
      todos: overdueTodos,
    });
  }
  for (const ms of [...dayKeys].sort((a, b) => a - b)) {
    groups.push({
      id: dayGroupId(ms),
      heading: dayHeading(ms),
      overdue: false,
      droppable: true,
      todos: datedTodos.filter((td) => dayOf(td) === ms).sort(byTime),
    });
  }
  if (anytimeTodos.length > 0) {
    groups.push({
      id: ANYTIME,
      heading: t("home.todosAnytime"),
      overdue: false,
      droppable: true,
      todos: anytimeTodos,
    });
  }

  // Approvals wear how long they have waited once that is longer than a few days.
  const dateLabel = (iso: string) => waitingLabel(iso, lang);

  const loaded = !!todosQuery.data && drafts !== null;
  const allClear = loaded && todos.length === 0 && !inboxes.some((a) => a.error);

  const groupOfTodo = new Map<string, Group>();
  for (const g of groups) for (const td of g.todos) groupOfTodo.set(td.id, g);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // The row under the pointer renders in a DragOverlay; the in-list original
  // stays as a dimmed placeholder. On a same-group drop the overlay glides
  // into the placeholder (so those patches skip the view transition dnd-kit
  // would fight). A cross-group drop remounts the row in another list, where
  // the overlay's drop animation has no valid target: there the overlay is
  // dropped instantly and the view transition morphs the row over instead.
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropCross, setDropCross] = React.useState(false);
  const draggedTodo = todos.find((td) => td.id === dragId) ?? null;

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const src = groupOfTodo.get(activeId);
    if (!src) return;
    const overId = String(over.id);
    const dst = groupById.get(overId) ?? groupOfTodo.get(overId);
    if (!dst?.droppable) return;
    const cross = src.id !== dst.id;
    setDropCross(cross);

    const overTodo = groupOfTodo.get(overId) ? overId : null;
    const dropIndex = overTodo ? dst.todos.findIndex((td) => td.id === overTodo) : dst.todos.length;

    if (dst.id === ANYTIME) {
      // Reorder within / move into Anytime: clear any date, land at the drop slot.
      const others = dst.todos.filter((td) => td.id !== activeId);
      const pos = midpoint(others[dropIndex - 1]?.position, others[dropIndex]?.position);
      patch(
        activeId,
        { dueAt: null, position: pos },
        (list) =>
          list.map((td) => (td.id === activeId ? { ...td, dueAt: null, position: pos } : td)),
        { transition: cross },
      );
      return;
    }
    if (src.id === dst.id) return; // within a dated day: time-ordered, nothing to persist.
    // Reschedule onto another day.
    const iso = dayIso(Number(dst.id.slice(4)));
    patch(
      activeId,
      { dueAt: iso },
      (list) => list.map((td) => (td.id === activeId ? { ...td, dueAt: iso } : td)),
      { transition: true },
    );
  };

  // An approval's answer records and, when linked, fires the automation; the
  // row stays until its draft is sent or discarded.
  const answerApproval = (todo: Todo) => (answer: string) =>
    patch(
      todo.id,
      { answer },
      (list) => list.map((td) => (td.id === todo.id ? { ...td, answer } : td)),
      { transition: false },
    );
  const approvalChanged = () => {
    void queryClient.invalidateQueries({ queryKey: ["todos"] });
    onDraftsChanged();
  };

  const renderRow = (todo: Todo, overdue: boolean, isNew?: boolean) => {
    if (todo.kind === "approval" && todo.ref?.kind === "email_draft") {
      const ref = todo.ref;
      return (
        <DraftRow
          todo={{ ...todo, ref }}
          color={accountColor(colors, ref.accountId)}
          markAccount={manyAccounts}
          dateLabel={dateLabel}
          onOpen={() => onOpenDraft(ref.accountId, ref.draftId)}
          onChanged={approvalChanged}
          onError={setRowError}
          isNew={isNew}
          onAnswer={answerApproval(todo)}
        />
      );
    }
    if (todo.kind === "approval" && todo.ref?.kind === "outbound") {
      return (
        <OutboundRow
          todo={{ ...todo, ref: todo.ref }}
          dateLabel={dateLabel}
          onChanged={approvalChanged}
          onError={setRowError}
          isNew={isNew}
          onAnswer={answerApproval(todo)}
        />
      );
    }
    return (
      <TodoRow
        todo={todo}
        overdue={overdue}
        lang={lang}
        todayStart={todayStart}
        onPatch={patch}
        automations={automations}
        isNew={isNew}
        onOpenChat={
          todo.conversationId
            ? () => openConversationInChat(todo.conversationId as string, () => onNavigate("chat"))
            : undefined
        }
      />
    );
  };

  const renderGroup = (group: Group) => (
    <GroupBlock key={group.id} group={group}>
      <SortableContext
        items={group.todos.map((td) => td.id)}
        strategy={verticalListSortingStrategy}
      >
        {group.todos.map((todo) => (
          <SeenOnInteract
            key={todo.id}
            seen={seen}
            itemKey={todoSeenKey(todo.id)}
            createdAt={todo.createdAt}
          >
            {(isNew) => (
              <SortableRow id={todo.id}>{renderRow(todo, group.overdue, isNew)}</SortableRow>
            )}
          </SeenOnInteract>
        ))}
      </SortableContext>
    </GroupBlock>
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title={t("home.attentionTitle")}>
        {manyAccounts && (
          <Select
            id="draft-account"
            value={accountFilter}
            onChange={setAccountFilter}
            aria-label={t("home.approvalsFilterAccount")}
            className="mr-1 w-auto max-w-48"
            options={[
              { value: "all", label: t("home.approvalsAllAccounts") },
              // The dot per option is the legend for the dots the rows wear.
              ...inboxes.map((a) => ({
                value: a.accountId,
                label: a.account,
                mark: (
                  <AccountDot color={accountColor(colors, a.accountId)} className="mr-2 h-2 w-2" />
                ),
              })),
            ]}
          />
        )}
        {newCount > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("home.markAllSeen")}
            data-tooltip={t("home.markAllSeen")}
            onClick={seen.seeAll}
          >
            <CheckCheck />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          title={t("home.todosAdd")}
          aria-label={t("home.todosAdd")}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus />
        </Button>
      </SectionTitle>
      {rowError && <ErrorBanner>{rowError}</ErrorBanner>}
      {inboxes
        .filter((a) => a.error)
        .map((a) => (
          <ErrorBanner key={a.accountId}>{a.error}</ErrorBanner>
        ))}
      {!todosQuery.data ? (
        <LoadingRow />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => {
            setDragId(String(e.active.id));
            setDropCross(false);
          }}
          onDragCancel={() => setDragId(null)}
          onDragEnd={onDragEnd}
        >
          {/* One raised panel holding plain rows, the work log's shape: never a card per item (DESIGN.md). */}
          <div className="surface flex flex-col gap-0.5 rounded-lg p-1.5">
            {groups.map(renderGroup)}
            {adding && (
              <AddTodoRow seen={seen} onClose={() => setAdding(false)} onError={setRowError} />
            )}
            {allClear && !adding && (
              <EmptyState
                surface={false}
                icon={CircleCheck}
                description={t("home.attentionEmpty")}
              />
            )}
            {done.length > 0 && (
              <div className="flex flex-col gap-0.5 pt-1">
                <DisclosureToggle open={showDone} onToggle={() => setShowDone((v) => !v)}>
                  {t("home.todosDone", { count: done.length })}
                </DisclosureToggle>
                {showDone &&
                  done.map((td, i) => (
                    <div key={td.id} className="animate-in-up" style={stagger(i)}>
                      <DoneTodoRow todo={td} onRestore={() => restoreTodo(td.id)} />
                    </div>
                  ))}
              </div>
            )}
          </div>
          <DragOverlay dropAnimation={dropCross ? null : undefined}>
            {draggedTodo && (
              <div className="surface rounded-md">
                {renderRow(draggedTodo, groupOfTodo.get(draggedTodo.id)?.overdue ?? false)}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </section>
  );
}

/**
 * The manual add row, revealed by the header's plus: Enter files an anytime
 * todo and keeps the field open for the next one; Escape or leaving it empty
 * closes it. Details (date, note, link) are edited on the created row.
 */
function AddTodoRow({
  seen,
  onClose,
  onError,
}: {
  seen: Seen;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState("");
  const create = useMutation({
    mutationFn: (title: string) => api.createTodo({ title }),
    onSuccess: (todo) => {
      // The user filed this one themselves, so it never wears the new dot.
      seen.see(todoSeenKey(todo.id));
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: (e) => onError(errorMessage(e)),
    meta: { suppressErrorToast: true },
  });

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    create.mutate(trimmed);
    setTitle("");
  };

  return (
    <form
      className="animate-in-up"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("home.todosAddPlaceholder")}
        aria-label={t("home.todosAdd")}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        onBlur={() => {
          if (!title.trim()) onClose();
        }}
      />
    </form>
  );
}

/** Sortable wrapper: gutter drag handle left of the row, dimmed as the in-list
 *  placeholder while its DragOverlay copy follows the pointer. */
function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, ...rowTransition(id) }}
      className={cn("group/todo relative", isDragging && "opacity-50")}
    >
      <button
        type="button"
        className={cn(
          "absolute -left-7 top-2 cursor-grab touch-none p-1 text-muted-foreground/50 hover:text-muted-foreground",
          // The gutter it sits in only exists once the column has margins.
          "max-sm:hidden opacity-0 transition-opacity focus-visible:opacity-100 group-hover/todo:opacity-100",
        )}
        aria-label={t("home.todosReorder")}
        {...attributes}
        {...listeners}
      >
        <Menu className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

function GroupBlock({ group, children }: { group: Group; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id, disabled: !group.droppable });
  return (
    <div
      ref={setNodeRef}
      className={cn("flex flex-col gap-0.5 rounded-md pt-2 first:pt-0.5", isOver && "bg-accent/5")}
    >
      <GroupLabel
        count={group.todos.length}
        className={cn("px-2.5 pb-1", group.overdue && "text-warning")}
      >
        {group.heading}
      </GroupLabel>
      {children}
    </div>
  );
}
