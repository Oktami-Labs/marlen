import type { AccountDrafts, Automation, Todo } from "@marlen/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, CircleCheck, Plus } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { Input } from "@/components/ui/input";
import { DraftRow } from "@/features/drafts/DraftRow";
import { startOfDayMs } from "@/features/home/agenda";
import { OutboundRow } from "@/features/home/OutboundRow";
import { type Seen, SeenOnInteract, todoSeenKey } from "@/features/home/seen";
import { DoneTodoRow, isQuestion, TodoRow, useTodoPatch } from "@/features/home/TodoRow";
import { api } from "@/lib/api";
import type { View } from "@/lib/nav";
import { openConversationInChat } from "@/lib/quickActions";
import { errorMessage, stagger } from "@/lib/utils";

/** The header row both Home columns open with: one fixed height, so the two labels share a baseline whether or not the row holds icon buttons. */
export const COLUMN_HEAD = "flex h-9 items-center gap-2 px-3";

const byAge = (a: Todo, b: Todo) => a.createdAt.localeCompare(b.createdAt);

/**
 * "Braucht Sie": everything waiting on the user, in three groups by kind.
 * Approvals are the drafts awaiting a send on any channel, questions the
 * todos that carry answers, tasks the rest; oldest first inside a group.
 * Mutations are optimistic and the "todos" server event reconciles the cache.
 */
export function NeedsYouSection({
  automations,
  drafts,
  onOpenDraft,
  onDraftsChanged,
  onNavigate,
  seen,
  newCount,
}: {
  automations: Automation[] | null;
  /** The connected inboxes and their live drafts; null while the (slow, live-mailbox) fetch is in flight. Read for per-inbox errors; the rows come from the todos list. */
  drafts: AccountDrafts[] | null;
  /** Opens one draft on the reading screen that replaces Home. */
  onOpenDraft: (accountId: string, draftId: string, opts?: { rewrite?: boolean }) => void;
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
  const [adding, setAdding] = React.useState(false);
  const [showDone, setShowDone] = React.useState(false);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const todosQuery = useQuery({ queryKey: ["todos"], queryFn: () => api.todos("open") });
  const doneQuery = useQuery({ queryKey: ["todos", "done"], queryFn: () => api.todos("done") });
  const patch = useTodoPatch();

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

  const groups = [
    {
      id: "approvals",
      label: t("home.approvals"),
      todos: todos.filter((td) => td.kind === "approval"),
    },
    { id: "questions", label: t("home.questions"), todos: todos.filter(isQuestion) },
    {
      id: "tasks",
      label: t("home.tasks"),
      todos: todos.filter((td) => td.kind === "todo" && !isQuestion(td)),
    },
  ]
    .map((group) => ({ ...group, todos: [...group.todos].sort(byAge) }))
    .filter((group) => group.todos.length > 0);

  const inboxes = drafts ?? [];
  const loaded = !!todosQuery.data && drafts !== null;
  const allClear = loaded && todos.length === 0 && !inboxes.some((a) => a.error);

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

  const renderRow = (todo: Todo, isNew: boolean) => {
    if (todo.kind === "approval" && todo.ref?.kind === "email_draft") {
      const ref = todo.ref;
      return (
        <DraftRow
          todo={{ ...todo, ref }}
          onOpen={(opts) => onOpenDraft(ref.accountId, ref.draftId, opts)}
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

  let index = 0;
  return (
    <section className="flex flex-col">
      <div className={COLUMN_HEAD}>
        <GroupLabel as="h2" count={todos.length}>
          {t("home.needsYou")}
        </GroupLabel>
        <div className="ml-auto flex shrink-0 items-center gap-1">
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
        </div>
      </div>
      {rowError && <ErrorBanner>{rowError}</ErrorBanner>}
      {inboxes
        .filter((a) => a.error)
        .map((a) => (
          <ErrorBanner key={a.accountId}>{a.error}</ErrorBanner>
        ))}
      {!todosQuery.data ? (
        <LoadingRow className="px-3" />
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col">
              <GroupLabel count={group.todos.length} className="px-3 pb-0.5 pt-2">
                {group.label}
              </GroupLabel>
              {group.todos.map((todo) => (
                <SeenOnInteract
                  key={todo.id}
                  seen={seen}
                  itemKey={todoSeenKey(todo.id)}
                  createdAt={todo.createdAt}
                  className="animate-in-up"
                  style={stagger(index++)}
                >
                  {(isNew) => renderRow(todo, isNew)}
                </SeenOnInteract>
              ))}
            </div>
          ))}
          {adding && (
            <AddTodoRow seen={seen} onClose={() => setAdding(false)} onError={setRowError} />
          )}
          {allClear && !adding && (
            <EmptyState surface={false} icon={CircleCheck} description={t("home.attentionEmpty")} />
          )}
          {done.length > 0 && (
            <div className="flex flex-col pt-3">
              <DisclosureToggle
                open={showDone}
                onToggle={() => setShowDone((v) => !v)}
                className="px-3"
              >
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
        </>
      )}
    </section>
  );
}

/**
 * The manual add row, revealed by the header's plus: Enter files a todo and
 * keeps the field open for the next one; Escape or leaving it empty closes it.
 * Details (date, note, link) are edited on the created row.
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
      className="animate-in-up px-3 pt-2"
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
