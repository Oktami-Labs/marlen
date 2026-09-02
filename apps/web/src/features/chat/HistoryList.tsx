import type {
  Conversation,
  ConversationListItem,
  ConversationListResponse,
  ConversationType,
} from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Ellipsis, MessagesSquare, Pencil, Trash2 } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { HoverActions } from "@/components/ui/hover-actions";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { sendChatCommand } from "@/features/chat/controller";
import { api } from "@/lib/api";
import { dateTimeLabel, relativeTime } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { useAnchoredPopover } from "@/lib/useAnchoredPopover";
import { cn, withViewTransition } from "@/lib/utils";

/** First page size for the history rail; "Load more" fetches in the same increments. */
const CONVERSATIONS_PAGE_SIZE = 50;

/** Runs of one automation, newest first. The list arrives newest-first, so
 *  insertion order carries that through per title. */
function groupRuns(runs: ConversationListItem[]): [string, ConversationListItem[]][] {
  const byTitle = new Map<string, ConversationListItem[]>();
  for (const run of runs) {
    const key = run.title || "";
    const group = byTitle.get(key);
    if (group) group.push(run);
    else byTitle.set(key, [run]);
  }
  return [...byTitle.entries()];
}

/** One automation's runs: the newest stands for the group, the rest unfold, so
 *  a job that runs every hour cannot push the conversations out of the rail. */
function RunGroup({
  runs,
  renderRow,
}: {
  runs: ConversationListItem[];
  renderRow: (c: ConversationListItem) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [newest, ...older] = runs;
  if (!newest) return null;
  return (
    <div className="flex flex-col gap-1">
      {renderRow(newest)}
      {open && older.map(renderRow)}
      {older.length > 0 && (
        <DisclosureToggle open={open} onToggle={() => setOpen((v) => !v)} className="px-3">
          {open ? t("chat.runsLess") : t("chat.runsMore", { count: older.length })}
        </DisclosureToggle>
      )}
    </div>
  );
}

function rowTitle(conversation: ConversationListItem, untitled: string): string {
  const title = conversation.title || untitled;
  return conversation.type === "automation" ? title.replace(/^Run:\s*/i, "") : title;
}

function rowPreview(conversation: ConversationListItem, title: string): string | null {
  const preview = conversation.preview?.trim();
  if (!preview || preview.startsWith(title)) return null;
  return preview;
}

function ConversationActions({
  renameable,
  onRename,
  onDelete,
}: {
  renameable: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { open, setOpen, pos, triggerRef, popoverRef } = useAnchoredPopover<HTMLSpanElement>({
    align: "center",
  });

  return (
    <span ref={triggerRef} className="inline-flex">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setOpen((current) => !current)}
        aria-label={t("chat.moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("chat.moreActions")}
      >
        <Ellipsis />
      </Button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            className="surface-pop animate-in-up fixed z-[130] flex w-40 flex-col gap-0.5 p-1"
            style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
          >
            {renameable && (
              <Button
                variant="ghost"
                size="sm"
                role="menuitem"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false);
                  onRename();
                }}
              >
                <Pencil />
                {t("chat.rename")}
              </Button>
            )}
            <Button
              variant="ghost-danger"
              size="sm"
              role="menuitem"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 />
              {t("chat.delete")}
            </Button>
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Past conversations, newest first and fetched whenever the list opens. Search
 * and pagination are server-backed, so this holds only one loaded window. */
export function HistoryList({
  activeId,
  onPick,
  query = "",
}: {
  activeId: string | undefined;
  onPick: (id: string) => void;
  query?: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<ConversationType>("chat");
  const [limit, setLimit] = React.useState(CONVERSATIONS_PAGE_SIZE);
  const [debouncedQuery, setDebouncedQuery] = React.useState(query.trim());
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const renameHandled = React.useRef(false);

  // Server-backed search: wait ~250ms after typing stops before hitting the endpoint.
  React.useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      setDebouncedQuery(trimmed);
      setLimit(CONVERSATIONS_PAGE_SIZE);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const historyQuery = useQuery({
    queryKey: ["conversations", "history", type, debouncedQuery, limit],
    queryFn: () => api.conversations({ type, q: debouncedQuery || undefined, limit, offset: 0 }),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === type && previousQuery.queryKey[3] === debouncedQuery
        ? previous
        : undefined,
    meta: { suppressErrorToast: true },
  });
  const items = historyQuery.data?.items ?? null;
  const total = historyQuery.data?.total ?? 0;

  const updateHistory = (
    update: (current: ConversationListResponse) => ConversationListResponse,
  ) => {
    queryClient.setQueriesData<ConversationListResponse>(
      { queryKey: ["conversations", "history"] },
      (current) => (current ? update(current) : current),
    );
  };

  const startRename = (c: ConversationListItem) => {
    // Enter/Escape set this true and unmount the input without firing blur
    // (browsers don't dispatch focusout for a removed element), so a stale
    // true would swallow the next rename's blur-commit. Clear it up front.
    renameHandled.current = false;
    setRenamingId(c.id);
    setRenameDraft(c.title || "");
  };

  const commitRename = async (id: string) => {
    setRenamingId(null);
    const title = renameDraft.trim();
    if (!title) return; // Cancel an empty edit instead of sending an invalid request.
    updateHistory((current) => ({
      ...current,
      items: current.items.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
    queryClient.setQueryData<Conversation>(["conversations", "detail", id], (current) =>
      current ? { ...current, title } : current,
    );
    try {
      await api.renameConversation(id, title);
    } catch (err) {
      toast.error(err);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return false;
    setDeleting(true);
    try {
      await api.deleteConversation(deleteId);
      if (deleteId === activeId) {
        // Same reset the "New chat" button triggers: clears messages, the open
        // conversation id, and the last-open-conversation localStorage key.
        sendChatCommand({ kind: "new" });
      }
      updateHistory((current) => {
        if (!current.items.some((c) => c.id === deleteId)) return current;
        return {
          items: current.items.filter((c) => c.id !== deleteId),
          total: Math.max(0, current.total - 1),
        };
      });
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setDeleting(false);
    }
  };

  const dateLabel = (iso: string) => dateTimeLabel(iso, i18n.language);

  const renderRow = (c: ConversationListItem) => {
    const active = c.id === activeId;
    const title = rowTitle(c, t("chat.untitled"));
    const preview = rowPreview(c, title);
    const context = c.type === "automation" ? relativeTime(c.updatedAt, i18n.language) : preview;
    return (
      <div
        key={c.id}
        className={cn(
          "group relative flex items-center rounded-lg transition-colors",
          active ? "bg-secondary" : "hover:bg-secondary",
        )}
      >
        {renamingId === c.id ? (
          <Input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameHandled.current = true;
                void commitRename(c.id);
              } else if (e.key === "Escape") {
                renameHandled.current = true;
                setRenamingId(null);
              }
            }}
            onBlur={() => {
              if (renameHandled.current) {
                renameHandled.current = false;
                return;
              }
              void commitRename(c.id);
            }}
            className="mx-1 my-1 h-7 min-w-0 flex-1 px-2"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 pr-10 text-left"
            >
              {c.running && (
                <Spinner
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
                  aria-label={t("chat.working")}
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn("truncate text-sm text-foreground", active && "font-medium")}
                  title={title}
                >
                  {title}
                </span>
                {context && (
                  <span className="truncate text-xs text-muted-foreground">
                    {c.type === "automation" ? (
                      <time dateTime={c.updatedAt} title={dateLabel(c.updatedAt)}>
                        {context}
                      </time>
                    ) : (
                      context
                    )}
                  </span>
                )}
              </span>
            </button>
            <HoverActions className="absolute right-1.5 top-2">
              <ConversationActions
                renameable={c.type !== "automation"}
                onRename={() => startRename(c)}
                onDelete={() => setDeleteId(c.id)}
              />
            </HoverActions>
          </>
        )}
      </div>
    );
  };

  const dialog = (
    <ConfirmDialog
      open={deleteId !== null}
      onOpenChange={(next) => !next && setDeleteId(null)}
      title={t("chat.deleteConfirmTitle")}
      description={t("chat.deleteConfirmBody")}
      confirmLabel={t("chat.delete")}
      busy={deleting}
      onConfirm={confirmDelete}
    />
  );

  const nextType: ConversationType = type === "chat" ? "automation" : "chat";
  const typeSwitch = (
    <div className="flex justify-end px-3 pb-1 pt-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-1 font-normal text-muted-foreground hover:bg-transparent"
        onClick={() => {
          withViewTransition(() => {
            setType(nextType);
            setLimit(CONVERSATIONS_PAGE_SIZE);
            setRenamingId(null);
          });
        }}
      >
        {type === "automation" && <ChevronLeft />}
        {t(type === "chat" ? "chat.automations" : "chat.chats")}
        {type === "chat" && <ChevronRight />}
      </Button>
    </div>
  );

  const loadMoreButton = items !== null && items.length < total && (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLimit((current) => current + CONVERSATIONS_PAGE_SIZE)}
      loading={historyQuery.isPlaceholderData}
      className="w-full text-muted-foreground"
    >
      {t("chat.loadMore")}
    </Button>
  );

  let content: React.ReactNode;
  if (!items) {
    content = historyQuery.error ? (
      <RetryableError onRetry={() => void historyQuery.refetch()}>
        {historyQuery.error.message}
      </RetryableError>
    ) : (
      <LoadingRow />
    );
  } else if (items.length === 0) {
    content = debouncedQuery ? (
      <p className="px-1 py-2 text-xs text-muted-foreground">{t("chat.noSearchResults")}</p>
    ) : (
      <EmptyState
        icon={MessagesSquare}
        description={type === "chat" ? t("chat.noConversations") : t("chat.noAutomationRuns")}
        surface={false}
        className="py-10"
      />
    );
  } else if (debouncedQuery) {
    content = (
      <div className="flex flex-col gap-4 px-1 py-2">
        <div className="flex flex-col gap-1">{items.map(renderRow)}</div>
        {loadMoreButton}
      </div>
    );
  } else if (type === "automation") {
    content = (
      <div className="flex flex-col gap-2 px-1 py-2">
        {groupRuns(items).map(([title, runs]) => (
          <RunGroup key={title} runs={runs} renderRow={renderRow} />
        ))}
        {loadMoreButton}
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-1 px-1 py-2">
        {items.map(renderRow)}
        {loadMoreButton}
      </div>
    );
  }

  return (
    <>
      {typeSwitch}
      {content}
      {dialog}
    </>
  );
}
