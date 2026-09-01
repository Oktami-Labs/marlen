import { type AppStatus, isLanguage, isSetupComplete } from "@marlen/shared";
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
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { NotFound } from "@/components/NotFound";
import { SearchPalette } from "@/components/SearchPalette";
import { Sidebar } from "@/components/Sidebar";
import { Button, type ButtonProps } from "@/components/ui/button";
import { CursorTooltip } from "@/components/ui/cursor-tooltip";
import { Dialog } from "@/components/ui/dialog";
import { LoadingRow, LoadingSweep } from "@/components/ui/feedback";
import { Kbd } from "@/components/ui/kbd";
import { SearchField } from "@/components/ui/search-field";
import { Toaster } from "@/components/ui/toaster";
import { AttachmentViewer } from "@/features/chat/AttachmentViewer";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { ChatSearchBar } from "@/features/chat/ChatSearchBar";
import { onRevealChat, sendChatCommand } from "@/features/chat/controller";
import { FocusChip } from "@/features/chat/FocusChip";
import { HistoryList } from "@/features/chat/HistoryList";
import { HomePanel } from "@/features/home/HomePanel";
import { SetupGate } from "@/features/setup/SetupGate";
import { api } from "@/lib/api";
import { rememberLanguage } from "@/lib/i18n";
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
import { useTheme } from "@/lib/useTheme";
import { cn, MOD_LABEL, withViewTransition } from "@/lib/utils";

const SETUP_DISMISSED_KEY = "marlen-setup-dismissed";

const CHAT_WIDTH_MIN = 320;
const CHAT_WIDTH_MAX = 960;

const AutomationsPanel = React.lazy(() =>
  import("@/features/automations/AutomationsPanel").then(({ AutomationsPanel }) => ({
    default: AutomationsPanel,
  })),
);
const KnowledgePanel = React.lazy(() =>
  import("@/features/knowledge/KnowledgePanel").then(({ KnowledgePanel }) => ({
    default: KnowledgePanel,
  })),
);
const LeadsPanel = React.lazy(() =>
  import("@/features/leads/LeadsPanel").then(({ LeadsPanel }) => ({ default: LeadsPanel })),
);
const SettingsPanel = React.lazy(() =>
  import("@/features/settings/SettingsPanel").then(({ SettingsPanel }) => ({
    default: SettingsPanel,
  })),
);
const ShowcasePanel = import.meta.env.DEV
  ? React.lazy(() =>
      import("@/features/showcase/ShowcasePanel").then(({ ShowcasePanel }) => ({
        default: ShowcasePanel,
      })),
    )
  : null;

function isNavView(path: string): path is View {
  return (NAV_VIEWS as readonly string[]).includes(path);
}

function isKnownPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (import.meta.env.DEV && path === SHOWCASE_NAV.path) return true;
  return NAV_ITEMS.some((item) => item.path === path);
}

function useServerLanguage() {
  const { i18n } = useTranslation();
  React.useEffect(() => {
    api
      .language()
      .then(({ language }) => {
        if (!language) {
          const current = i18n.language;
          if (isLanguage(current)) {
            rememberLanguage(current);
            void api.setLanguage(current).catch(() => {});
          }
          return;
        }
        rememberLanguage(language);
        if (language !== i18n.language) void i18n.changeLanguage(language);
      })
      .catch(() => {});
  }, [i18n]);
}

function useServerTimezone() {
  React.useEffect(() => {
    api
      .timezone()
      .then(({ timezone }) => {
        if (timezone) return;
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (detected) void api.setTimezone(detected).catch(() => {});
      })
      .catch(() => {});
  }, []);
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
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(
    () =>
      typeof window !== "undefined" && localStorage.getItem("marlen-sidebar-collapsed") === "true",
  );
  const [chatOpen, setChatOpen] = React.useState(false);
  const [agentCollapsed, setAgentCollapsed] = React.useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("marlen-agent-sidebar-collapsed") === "true",
  );
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [activeConversationId, setActiveConversationId] = React.useState<string | undefined>();
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

  const refreshStatus = React.useCallback(() => {
    api
      .status()
      .then(setStatus)
      .catch(() => {
        setStatus(null);
        setGate((g) => (g === "pending" ? "closed" : g));
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

  React.useEffect(() => {
    localStorage.setItem("marlen-chat-history-collapsed", String(historyCollapsed));
  }, [historyCollapsed]);

  React.useEffect(() => {
    localStorage.setItem("marlen-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  React.useEffect(() => {
    localStorage.setItem("marlen-agent-sidebar-collapsed", String(agentCollapsed));
  }, [agentCollapsed]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;

      if (mod && key === "b") {
        event.preventDefault();
        if (event.shiftKey) setAgentCollapsed((value) => !value);
        else setSidebarCollapsed((value) => !value);
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
  }, [toggleTheme]);

  const select = (next: string) => {
    withViewTransition(() => navigate(next === "home" ? "/" : `/${next}`));
    setMobileOpen(false);
    setChatOpen(false);
  };

  const closeGate = (openSettings: boolean) => {
    localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    setGate("closed");
    select(openSettings ? "settings" : "home");
  };

  if (gate === "open") {
    return (
      <>
        <SetupGate status={status} onStatusChanged={refreshStatus} onFinish={closeGate} />
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

  return (
    <div ref={chatWidthRef} className="flex h-dvh overflow-hidden bg-sidebar">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t("app.skipToContent")}
      </a>

      {mobileOpen && <Backdrop className="md:hidden" onClick={() => setMobileOpen(false)} />}

      <div
        className={cn(
          // Keep collapsed-nav tooltips above the isolated main canvas.
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out md:static md:z-10 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar
          status={status}
          onClose={() => setMobileOpen(false)}
          isCollapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
      </div>

      <main
        id="main-content"
        className={cn(
          "@container relative isolate flex min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-3 md:rounded-2xl",
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
            <h1 className="text-xl font-bold tracking-tight text-foreground">{pageTitle}</h1>
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
              className="shrink-0 @2xl:hidden"
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
                onClick={() => setAgentCollapsed(false)}
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
            currentPath === "knowledge" ? "flex flex-col px-3 pb-3" : "px-5 pb-10 pt-1 sm:px-8",
          )}
        >
          <div
            className={cn(
              currentPath === "knowledge"
                ? "min-h-0 w-full flex-1"
                : // Home is the one two-column page, so its cap steps out of the
                  // way as soon as the canvas can hold two columns.
                  currentPath === "home"
                  ? "mx-auto max-w-3xl @3xl:max-w-4xl @5xl:max-w-5xl"
                  : "mx-auto max-w-3xl @6xl:max-w-4xl @7xl:max-w-5xl",
              import.meta.env.DEV && currentPath === "showcase" && "max-w-none",
            )}
          >
            <React.Suspense fallback={<LoadingRow />}>
              <Routes>
                <Route path="/chat" element={null} />
                <Route
                  path="/settings"
                  element={<SettingsPanel status={status} onStatusChanged={refreshStatus} />}
                />
                {/* Leads exist only alongside a connected onOffice CRM. While status
                    is still loading nothing renders — redirecting then would kick a
                    direct /leads visit home on every reload. */}
                <Route
                  path="/leads"
                  element={
                    status === null ? null : status.onofficeConfigured ? (
                      <LeadsPanel />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route path="/automations" element={<AutomationsPanel />} />
                <Route path="/knowledge" element={<KnowledgePanel />} />
                {ShowcasePanel && <Route path="/showcase" element={<ShowcasePanel />} />}
                <Route
                  path="/"
                  element={
                    <HomePanel
                      setupIncomplete={status !== null && !isSetupComplete(status)}
                      offline={Boolean(status?.pipedreamConfigured) && !status?.emailAccountsKnown}
                      onNavigate={select}
                    />
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </React.Suspense>
          </div>
        </div>
      </main>

      {!onChatRoute && chatOpen && (
        <Backdrop className="lg:hidden" onClick={() => setChatOpen(false)} />
      )}

      {onChatRoute && historyOpen && (
        <Backdrop className="md:hidden" onClick={() => setHistoryOpen(false)} />
      )}

      {/* biome-ignore lint/a11y/useSemanticElements: interactive splitter; <hr> cannot receive focus or contain the grip */}
      <div
        onPointerDown={onChatResizeStart}
        onKeyDown={onChatResizeKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chat.resize")}
        aria-valuenow={chatWidth}
        aria-valuemin={CHAT_WIDTH_MIN}
        aria-valuemax={CHAT_WIDTH_MAX}
        tabIndex={0}
        className={cn(
          "group z-40 hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center lg:flex",
          (onChatRoute || agentCollapsed) && "lg:hidden",
        )}
      >
        <div className="h-8 w-1 rounded-full bg-foreground/10 transition-colors group-hover:bg-foreground/30 group-active:bg-accent/60" />
      </div>

      {/* Keep one chat instance mounted so navigation cannot drop an active stream.
          It docks beside the canvas only from `lg`: rail plus a 320px-minimum panel
          leaves a workable canvas from there, and below it the panel is a drawer. */}
      <div
        className={cn(
          "flex flex-col min-h-0 min-w-0 overflow-hidden",
          onChatRoute
            ? "static z-auto min-w-0 flex-1 translate-x-0 bg-background md:my-3 md:rounded-2xl"
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
            onChatRoute ? "flex-row gap-4 p-4 sm:p-6" : "flex-col bg-sidebar",
            // Prevent text reflow while the panel opens and closes.
            !onChatRoute && "lg:w-[var(--chat-width)]",
          )}
        >
          {onChatRoute && (
            <div
              className={cn(
                "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-background transition-transform duration-200 ease-out md:static md:z-auto md:w-64 md:translate-x-0",
                historyOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
                historyCollapsed && "md:hidden",
              )}
            >
              <div className="flex shrink-0 items-center gap-2.5 px-4 pb-3 pt-6">
                <p className="text-sm font-semibold tracking-tight">{t("chat.history")}</p>
                <HeaderIconButton
                  label={t("chat.newConversation")}
                  onClick={() => {
                    sendChatCommand({ kind: "new" });
                    setHistoryOpen(false);
                  }}
                  className="ml-auto"
                >
                  <Plus />
                </HeaderIconButton>
                <HeaderIconButton
                  label={t("chat.collapseHistory")}
                  onClick={() => setHistoryCollapsed(true)}
                  className="hidden md:inline-flex"
                >
                  <ChevronLeft />
                </HeaderIconButton>
                <HeaderIconButton
                  label={t("common.close")}
                  onClick={() => setHistoryOpen(false)}
                  className="md:hidden"
                >
                  <X />
                </HeaderIconButton>
              </div>
              <div className="px-4 pb-2">
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
            </div>
          )}

          {/* This stable column always owns the ChatPanel instance.
              White surface (a rounded card on the Chat tab, flush chrome in panel mode), so
              its neutral controls (composer, focus chip, code blocks) recess to grey rather
              than rising to white as they would on the canvas. */}
          <div
            className={cn(
              "surface-fills flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container",
              onChatRoute && "rounded-2xl bg-surface",
            )}
          >
            <div className="flex shrink-0 items-center gap-2.5 px-5 pb-4 pt-6">
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
                  className="hidden shrink-0 md:inline-flex"
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
                  <p className="shrink-0 text-sm font-semibold tracking-tight">
                    {t("views.chat.title")}
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
                className={cn(onChatRoute && "md:hidden")}
              >
                <Plus />
              </HeaderIconButton>
              <HeaderIconButton
                label={t("chat.history")}
                onClick={() => setHistoryOpen((open) => !open)}
                className={cn(historyOpen && "text-foreground", onChatRoute && "md:hidden")}
              >
                <History />
              </HeaderIconButton>
              {!onChatRoute && (
                <HeaderIconButton
                  label={t("app.collapseChat")}
                  onClick={() => setAgentCollapsed(true)}
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

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Keyboard shortcuts">
        <div>
          {[
            ["Show keyboard shortcuts", MOD_LABEL, "Shift", "7"],
            ["Swap light / dark theme", MOD_LABEL, "Shift", "L"],
            ["Toggle navigation sidebar", MOD_LABEL, "B"],
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
      <SearchPalette onofficeConfigured={Boolean(status?.onofficeConfigured)} />
      <AttachmentViewer />
    </div>
  );
}
