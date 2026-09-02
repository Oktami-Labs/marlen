import { type AppStatus, isSetupComplete } from "@marlen/shared";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Menu,
  MessagesSquare,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { SearchPalette } from "@/components/SearchPalette";
import { Sidebar } from "@/components/Sidebar";
import { Button, type ButtonProps } from "@/components/ui/button";
import { CursorTooltip } from "@/components/ui/cursor-tooltip";
import { Dialog } from "@/components/ui/dialog";
import { LoadingRow, LoadingSweep } from "@/components/ui/feedback";
import { Kbd } from "@/components/ui/kbd";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { SearchField } from "@/components/ui/search-field";
import { Toaster } from "@/components/ui/toaster";
import { AttachmentViewer } from "@/features/chat/AttachmentViewer";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { ChatSearchBar } from "@/features/chat/ChatSearchBar";
import { onRevealChat, sendChatCommand } from "@/features/chat/controller";
import { FocusChip } from "@/features/chat/FocusChip";
import { HistoryList } from "@/features/chat/HistoryList";
import { api } from "@/lib/api";
import {
  NAV_ITEMS,
  NAV_VIEWS,
  openSearch,
  registerNavigate,
  SHOWCASE_NAV,
  type View,
} from "@/lib/nav";
import { useDesktopChrome, useWaitingBadge } from "@/lib/useDesktopChrome";
import { useResizableWidth } from "@/lib/useResizableWidth";
import { useRunNotifications } from "@/lib/useRunNotifications";
import { useServerLanguage, useServerTimezone } from "@/lib/useServerPreferences";
import { useTheme } from "@/lib/useTheme";
import { cn, MOD_LABEL, withViewTransition } from "@/lib/utils";
import { Pages } from "@/Pages";

const SETUP_DISMISSED_KEY = "marlen-setup-dismissed";

const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 384;
const CHAT_WIDTH_MIN = 320;
const CHAT_WIDTH_MAX = 960;

const SetupGate = React.lazy(() =>
  import("@/features/setup/SetupGate").then(({ SetupGate }) => ({ default: SetupGate })),
);

function isNavView(path: string): path is View {
  return (NAV_VIEWS as readonly string[]).includes(path);
}

function isKnownPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (import.meta.env.DEV && path === SHOWCASE_NAV.path) return true;
  return NAV_ITEMS.some((item) => item.path === path);
}

function HeaderIconButton({
  label,
  ...props
}: Omit<ButtonProps, "variant" | "size" | "aria-label"> & { label: string }) {
  return <Button variant="ghost" size="icon" aria-label={label} data-tooltip={label} {...props} />;
}

function Backdrop({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational scrim, not a control
    <div
      role="presentation"
      className={cn("scrim fixed inset-0 z-40", className)}
      onClick={onClick}
    />
  );
}

export default function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const currentPath = location.pathname.split("/")[1] || "home";
  const onChatRoute = currentPath === "chat";
  const view: View = isNavView(currentPath) ? currentPath : "home";
  const [status, setStatus] = React.useState<AppStatus | null>(null);
  const [gate, setGate] = React.useState<"pending" | "open" | "closed">(() =>
    localStorage.getItem(SETUP_DISMISSED_KEY) ? "closed" : "pending",
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [agentCollapsed, setAgentCollapsed] = React.useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("marlen-agent-sidebar-collapsed") === "true",
  );
  const [navCollapsed, setNavCollapsed] = React.useState(
    () =>
      typeof window !== "undefined" && localStorage.getItem("marlen-sidebar-collapsed") === "true",
  );
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [activeConversationId, setActiveConversationId] = React.useState<string | undefined>();
  const activeConversationQuery = useQuery({
    queryKey: ["conversations", "detail", activeConversationId],
    queryFn: () => api.conversation(activeConversationId as string),
    enabled: Boolean(activeConversationId),
  });
  const [pendingFocusAccountId, setPendingFocusAccountId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!activeConversationId) setPendingFocusAccountId(null);
  }, [activeConversationId]);
  const [historyCollapsed, setHistoryCollapsed] = React.useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("marlen-chat-history-collapsed") === "true",
  );
  const [historyQuery, setHistoryQuery] = React.useState("");
  const [chatSearch, setChatSearch] = React.useState<{ query: string; hit: number } | null>(null);
  const [chatHits, setChatHits] = React.useState(0);
  const [, theme, setThemePref] = useTheme();
  useDesktopChrome(theme);
  useWaitingBadge();
  const toggleTheme = React.useCallback(() => {
    setThemePref(theme === "dark" ? "light" : "dark");
  }, [theme, setThemePref]);
  const toggleDockedChat = React.useCallback(() => {
    setAgentCollapsed((collapsed) => !collapsed);
  }, []);
  const {
    ref: sidebarWidthRef,
    width: sidebarWidth,
    dragging: sidebarResizing,
    onPointerDown: onSidebarResizeStart,
    onKeyDown: onSidebarResizeKeyDown,
  } = useResizableWidth({
    storageKey: "marlen-sidebar-width",
    cssVar: "--sidebar-width",
    defaultWidth: 256,
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    edge: "left",
    onOverdrag: () => setNavCollapsed(true),
  });
  // Grabbing the collapsed rail's edge reopens it at its last width and the
  // drag carries on from there; ArrowRight/End on the grip reopen it too.
  const onCollapsedNavPointerDown = (event: React.PointerEvent) => {
    setNavCollapsed(false);
    onSidebarResizeStart(event);
  };
  const onCollapsedNavKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "End") return;
    event.preventDefault();
    setNavCollapsed(false);
  };
  const {
    ref: chatWidthRef,
    width: chatWidth,
    dragging: chatResizing,
    onPointerDown: onChatResizeStart,
    onKeyDown: onChatResizeKeyDown,
  } = useResizableWidth({
    storageKey: "marlen-chat-width",
    cssVar: "--chat-width",
    defaultWidth: 384,
    min: CHAT_WIDTH_MIN,
    max: CHAT_WIDTH_MAX,
    edge: "right",
    onOverdrag: () => setAgentCollapsed(true),
  });
  useServerLanguage();
  useServerTimezone();
  useRunNotifications();

  // One request at a time: focus and visibilitychange fire together when the
  // window comes back, and both ask for a refresh.
  const statusRequest = React.useRef<Promise<void> | null>(null);
  const refreshStatus = React.useCallback(() => {
    if (statusRequest.current) return;
    statusRequest.current = api
      .status()
      .then(setStatus)
      .catch(() => {
        setStatus(null);
        setGate((g) => (g === "pending" ? "closed" : g));
      })
      .finally(() => {
        statusRequest.current = null;
      });
  }, []);

  React.useEffect(() => {
    refreshStatus();
    const onFocus = () => refreshStatus();
    const onVisible = () => {
      if (!document.hidden) refreshStatus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribeReveal = onRevealChat(() => setChatOpen(true));
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribeReveal();
    };
  }, [refreshStatus]);

  React.useEffect(() => {
    return registerNavigate((path) => {
      if (path.startsWith("/")) withViewTransition(() => navigate(path));
    });
  }, [navigate]);

  React.useEffect(() => {
    if (!status) return;
    const complete = isSetupComplete(status);
    if (complete) localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    setGate((g) => (g === "pending" ? (complete ? "closed" : "open") : g));
  }, [status]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onChatRoute is the trigger, not a value read in the body, it must re-run on every route change
  React.useEffect(() => {
    setHistoryOpen(false);
    setHistoryQuery("");
  }, [onChatRoute]);

  // Closing route-local drawers on navigation keeps them from covering the next view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentPath is the navigation signal.
  React.useEffect(() => {
    setChatOpen(false);
  }, [currentPath]);

  React.useEffect(() => {
    localStorage.setItem("marlen-chat-history-collapsed", String(historyCollapsed));
  }, [historyCollapsed]);

  React.useEffect(() => {
    localStorage.setItem("marlen-agent-sidebar-collapsed", String(agentCollapsed));
  }, [agentCollapsed]);

  React.useEffect(() => {
    localStorage.setItem("marlen-sidebar-collapsed", String(navCollapsed));
  }, [navCollapsed]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.shiftKey && key === "b") {
        event.preventDefault();
        toggleDockedChat();
        return;
      }
      if (mod && event.shiftKey && event.code === "Digit7") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (mod && event.shiftKey && event.code === "KeyL") {
        event.preventDefault();
        toggleTheme();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleDockedChat, toggleTheme]);

  const select = React.useCallback(
    (next: string) => {
      withViewTransition(() => navigate(next === "home" ? "/" : `/${next}`));
      setMobileOpen(false);
      setChatOpen(false);
    },
    [navigate],
  );

  const closeGate = (openSettings: boolean) => {
    localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    setGate("closed");
    select(openSettings ? "settings" : "home");
  };

  if (gate === "open") {
    return (
      <>
        <React.Suspense
          fallback={
            <div className="grid h-dvh place-items-center">
              <LoadingRow />
            </div>
          }
        >
          <SetupGate status={status} onStatusChanged={refreshStatus} onFinish={closeGate} />
        </React.Suspense>
        <Toaster />
      </>
    );
  }

  if (gate === "pending") {
    return (
      <div className="grid h-dvh place-items-center">
        <LoadingRow />
      </div>
    );
  }

  const pageTitle = !isKnownPath(location.pathname)
    ? t("notFound.title")
    : import.meta.env.DEV && currentPath === "showcase"
      ? SHOWCASE_NAV.title
      : t(`views.${view}.title`);
  const chatTitle = onChatRoute
    ? activeConversationId
      ? (activeConversationQuery.data?.title ?? t("views.chat.title"))
      : t("chat.newConversation")
    : t("views.chat.title");

  return (
    <div ref={chatWidthRef} className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t("app.skipToContent")}
      </a>

      {mobileOpen && <Backdrop className="md:hidden" onClick={() => setMobileOpen(false)} />}

      <div
        ref={sidebarWidthRef}
        className={cn(
          "fixed inset-y-0 left-0 z-50 duration-200 ease-out md:static md:z-10 md:shrink-0 md:translate-x-0",
          // Width animation would make the rail trail the pointer during a drag.
          sidebarResizing ? "transition-none" : "transition-[transform,width]",
          navCollapsed ? "md:w-16" : "md:w-[var(--sidebar-width)]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar status={status} collapsed={navCollapsed} onClose={() => setMobileOpen(false)} />
      </div>

      <ResizeHandle
        label={t("sidebar.resize")}
        value={sidebarWidth}
        min={SIDEBAR_WIDTH_MIN}
        max={SIDEBAR_WIDTH_MAX}
        onPointerDown={navCollapsed ? onCollapsedNavPointerDown : onSidebarResizeStart}
        onKeyDown={navCollapsed ? onCollapsedNavKeyDown : onSidebarResizeKeyDown}
        className="z-40 hidden md:flex"
      />

      {/* The workspace: the page and the docked chat on one white surface, inset from
          the grey window on desktop and edge to edge below `md`. The chat's resize
          handle draws the one line between them. */}
      <div className="workspace-frame surface-fills flex min-w-0 flex-1 overflow-hidden bg-surface md:my-3 md:mr-3 md:rounded-2xl">
        <main
          id="main-content"
          className={cn(
            "@container relative isolate flex min-w-0 flex-1 flex-col overflow-hidden",
            onChatRoute && "hidden",
          )}
        >
          <div aria-hidden className="aurora" />
          <LoadingSweep />
          <header className="flex shrink-0 items-center gap-4 px-5 py-5 sm:px-8">
            <HeaderIconButton
              label={t("app.openMenu")}
              onClick={() => {
                setChatOpen(false);
                setMobileOpen(true);
              }}
              className="shrink-0 md:hidden"
            >
              <Menu />
            </HeaderIconButton>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight text-foreground">
                {pageTitle}
              </h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openSearch()}
                className="hidden h-9 w-56 shrink-0 items-center gap-2 rounded-md bg-surface-2 px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background @2xl:flex"
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t("search.openButton")}</span>
                <Kbd className="bg-background/70 px-1.5">{MOD_LABEL}K</Kbd>
              </button>
              <HeaderIconButton
                label={t("search.openButton")}
                onClick={() => openSearch()}
                className="hidden shrink-0 @md:inline-flex @2xl:hidden"
              >
                <Search />
              </HeaderIconButton>
              <HeaderIconButton
                label={theme === "dark" ? t("sidebar.lightMode") : t("sidebar.darkMode")}
                onClick={toggleTheme}
                className="shrink-0"
              >
                {theme === "dark" ? <Sun /> : <Moon />}
              </HeaderIconButton>
              {!onChatRoute && agentCollapsed && (
                <HeaderIconButton
                  label={t("app.expandChat")}
                  onClick={toggleDockedChat}
                  className="hidden shrink-0 lg:inline-flex"
                >
                  <ChevronLeft />
                </HeaderIconButton>
              )}
              <HeaderIconButton
                label={t("app.openChat")}
                onClick={() => {
                  setMobileOpen(false);
                  setChatOpen(true);
                }}
                className="shrink-0 lg:hidden"
              >
                <MessagesSquare />
              </HeaderIconButton>
            </div>
          </header>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto scroll-stable @container",
              // Tailwind Merge cannot cancel the breakpoint variants here.
              currentPath === "knowledge"
                ? "flex flex-col px-3 pb-3"
                : // Home's and Automations' rows carry their own 12px inset, so the
                  // column pads less and the group labels land beside the page title.
                  currentPath === "home" || currentPath === "automations"
                  ? "px-3 pb-10 pt-1 sm:px-6"
                  : "px-5 pb-10 pt-1 sm:px-8",
            )}
          >
            <div
              className={cn(
                currentPath === "knowledge"
                  ? "min-h-0 w-full flex-1"
                  : currentPath === "settings"
                    ? "w-full max-w-7xl"
                    : // Home is the one two-column page, so its cap steps out of the
                      // way as soon as the canvas can hold two columns.
                      currentPath === "home"
                      ? "mx-auto w-full max-w-3xl @3xl:max-w-4xl @5xl:max-w-6xl @7xl:max-w-7xl"
                      : "mx-auto w-full max-w-3xl @5xl:max-w-4xl @6xl:max-w-5xl @7xl:max-w-6xl",
                import.meta.env.DEV && currentPath === "showcase" && "max-w-none",
              )}
            >
              <Pages status={status} onStatusChanged={refreshStatus} onNavigate={select} />
            </div>
          </div>
        </main>

        {!onChatRoute && chatOpen && (
          <Backdrop className="lg:hidden" onClick={() => setChatOpen(false)} />
        )}

        {onChatRoute && historyOpen && (
          <Backdrop className="lg:hidden" onClick={() => setHistoryOpen(false)} />
        )}

        <ResizeHandle
          label={t("chat.resize")}
          value={chatWidth}
          min={CHAT_WIDTH_MIN}
          max={CHAT_WIDTH_MAX}
          onPointerDown={onChatResizeStart}
          onKeyDown={onChatResizeKeyDown}
          seam
          className={cn("z-40 hidden lg:flex", (onChatRoute || agentCollapsed) && "lg:hidden")}
        />

        {/* Keep one chat instance mounted so navigation cannot drop an active stream.
          It docks beside the canvas only from `lg`: rail plus a 320px-minimum panel
          leaves a workable canvas from there, and below it the panel is a drawer. */}
        <div
          className={cn(
            "flex flex-col min-h-0 min-w-0 overflow-hidden",
            onChatRoute
              ? "static z-auto min-w-0 flex-1"
              : cn(
                  "fixed inset-y-0 right-0 w-full max-w-sm lg:static lg:z-auto lg:max-w-none lg:translate-x-0",
                  // Width animation would make the panel trail the pointer during a drag.
                  chatResizing
                    ? "transition-none"
                    : "transition-[transform,width] duration-200 ease-out",
                  agentCollapsed ? "lg:w-0" : "lg:w-[var(--chat-width)]",
                  chatOpen ? "z-50 translate-x-0" : "z-40 translate-x-full lg:translate-x-0",
                ),
          )}
        >
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 overflow-hidden pointer-events-auto",
              onChatRoute ? "flex-row" : "flex-col bg-surface",
              // Prevent text reflow while the panel opens and closes.
              !onChatRoute && "lg:w-[var(--chat-width)]",
            )}
          >
            {onChatRoute && (
              <aside
                aria-label={t("chat.history")}
                className={cn(
                  "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:translate-x-0 xl:w-72",
                  historyOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
                  historyCollapsed && "lg:hidden",
                )}
              >
                <div className="flex shrink-0 items-center gap-2.5 px-3 pb-1 pt-4">
                  <p className="text-sm font-semibold tracking-tight">{t("chat.history")}</p>
                  <HeaderIconButton
                    label={t("chat.collapseHistory")}
                    onClick={() => setHistoryCollapsed(true)}
                    className="ml-auto hidden lg:inline-flex"
                  >
                    <ChevronLeft />
                  </HeaderIconButton>
                  <HeaderIconButton
                    label={t("common.close")}
                    onClick={() => setHistoryOpen(false)}
                    className="lg:hidden"
                  >
                    <X />
                  </HeaderIconButton>
                </div>
                <div className="px-3 pb-1">
                  <Button
                    variant="ghost"
                    className="w-full justify-start px-3 text-foreground"
                    onClick={() => {
                      sendChatCommand({ kind: "new" });
                      setHistoryOpen(false);
                    }}
                  >
                    <Plus />
                    {t("chat.newConversation")}
                  </Button>
                </div>
                <div className="px-3 pb-2">
                  <SearchField
                    value={historyQuery}
                    onChange={setHistoryQuery}
                    placeholder={t("chat.searchPlaceholder")}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scroll-stable px-2 pb-4">
                  <HistoryList
                    activeId={activeConversationId}
                    query={historyQuery}
                    onPick={(id) => {
                      sendChatCommand({ kind: "open", conversationId: id });
                      setHistoryOpen(false);
                    }}
                  />
                </div>
              </aside>
            )}
            {onChatRoute && !historyCollapsed && (
              <div aria-hidden className="seam hidden w-px shrink-0 lg:block" />
            )}

            {/* This stable column always owns the ChatPanel instance. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container">
              {/* In panel mode the header pads like the page header, so the chat title
                sits on the page title's baseline. */}
              <div
                className={cn(
                  "flex shrink-0 items-center gap-2.5 px-5",
                  onChatRoute ? "py-4" : "py-5",
                )}
              >
                {/* Full-page tab has no app header, so mobile users still need a way into the nav drawer. */}
                {onChatRoute && (
                  <HeaderIconButton
                    label={t("app.openMenu")}
                    onClick={() => setMobileOpen(true)}
                    className="shrink-0 md:hidden"
                  >
                    <Menu />
                  </HeaderIconButton>
                )}
                {/* Reopen the collapsed history rail (desktop). */}
                {onChatRoute && historyCollapsed && (
                  <HeaderIconButton
                    label={t("chat.showHistory")}
                    onClick={() => setHistoryCollapsed(false)}
                    className="hidden shrink-0 lg:inline-flex"
                  >
                    <ChevronRight />
                  </HeaderIconButton>
                )}
                {chatSearch ? (
                  <ChatSearchBar
                    query={chatSearch.query}
                    hit={chatSearch.hit}
                    hits={chatHits}
                    onQueryChange={(query) => setChatSearch({ query, hit: 0 })}
                    onHitChange={(hit) => setChatSearch((s) => (s ? { ...s, hit } : s))}
                    onClose={() => setChatSearch(null)}
                  />
                ) : (
                  <>
                    <p
                      className="shrink-0 truncate text-sm font-semibold tracking-tight sm:min-w-0 sm:shrink"
                      title={chatTitle}
                    >
                      {onChatRoute ? (
                        <>
                          <span className="sm:hidden">{t("views.chat.title")}</span>
                          <span className="hidden sm:inline">{chatTitle}</span>
                        </>
                      ) : (
                        chatTitle
                      )}
                    </p>
                    <FocusChip
                      conversationId={activeConversationId}
                      pendingFocusAccountId={pendingFocusAccountId}
                      onPendingFocusChange={setPendingFocusAccountId}
                    />
                  </>
                )}
                {onChatRoute && !chatSearch && (
                  <HeaderIconButton
                    label={theme === "dark" ? t("sidebar.lightMode") : t("sidebar.darkMode")}
                    onClick={toggleTheme}
                    className="ml-auto shrink-0"
                  >
                    {theme === "dark" ? <Sun /> : <Moon />}
                  </HeaderIconButton>
                )}
                {!chatSearch && (
                  <HeaderIconButton
                    label={t("chat.search.open")}
                    onClick={() => {
                      setChatSearch({ query: "", hit: 0 });
                      setHistoryOpen(false);
                    }}
                    className={cn(!onChatRoute && "ml-auto")}
                  >
                    <Search />
                  </HeaderIconButton>
                )}
                <HeaderIconButton
                  label={t("chat.newConversation")}
                  onClick={() => sendChatCommand({ kind: "new" })}
                  className={cn(onChatRoute && "lg:hidden")}
                >
                  <Plus />
                </HeaderIconButton>
                <HeaderIconButton
                  label={t("chat.history")}
                  onClick={() => setHistoryOpen((open) => !open)}
                  className={cn(historyOpen && "text-foreground", onChatRoute && "lg:hidden")}
                >
                  <History />
                </HeaderIconButton>
                {!onChatRoute && (
                  <HeaderIconButton
                    label={t("app.collapseChat")}
                    onClick={toggleDockedChat}
                    className="hidden lg:inline-flex"
                  >
                    <ChevronRight />
                  </HeaderIconButton>
                )}
                {!onChatRoute && (
                  <HeaderIconButton
                    label={t("app.closeChat")}
                    onClick={() => setChatOpen(false)}
                    className="lg:hidden"
                  >
                    <X />
                  </HeaderIconButton>
                )}
              </div>
              <div className="flex flex-col min-h-0 flex-1 px-5 pb-5 overflow-hidden">
                <ChatPanel
                  historyOpen={historyOpen}
                  setHistoryOpen={setHistoryOpen}
                  layout={onChatRoute ? "page" : "panel"}
                  onConversationChange={setActiveConversationId}
                  pendingFocusAccountId={pendingFocusAccountId}
                  search={chatSearch ?? undefined}
                  onSearchHits={setChatHits}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Keyboard shortcuts">
        <div>
          {[
            ["Show keyboard shortcuts", MOD_LABEL, "Shift", "7"],
            ["Swap light / dark theme", MOD_LABEL, "Shift", "L"],
            ["Toggle agent chat sidebar", MOD_LABEL, "Shift", "B"],
            ["Open search", MOD_LABEL, "K"],
          ].map(([label, ...keys]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span>{label}</span>
              <span className="flex gap-1">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Dialog>
      <Toaster />
      <CursorTooltip />
      <SearchPalette />
      <AttachmentViewer />
    </div>
  );
}
