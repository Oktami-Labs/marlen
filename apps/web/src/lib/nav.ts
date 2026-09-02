import {
  BookOpen,
  CalendarClock,
  Inbox,
  type LucideIcon,
  MessagesSquare,
  Palette,
  Settings2,
  Users,
} from "lucide-react";

export type View = "home" | "chat" | "leads" | "automations" | "knowledge" | "settings";

interface NavItem {
  id: View;
  path: string;
  icon: LucideIcon;
}

/**
 * Primary destinations stay in the main rail. Settings belongs to the local
 * profile menu, while the complete list still drives route validation and the
 * command palette.
 */
export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "home", path: "/", icon: Inbox },
  { id: "chat", path: "/chat", icon: MessagesSquare },
  { id: "leads", path: "/leads", icon: Users },
  { id: "automations", path: "/automations", icon: CalendarClock },
  { id: "knowledge", path: "/knowledge", icon: BookOpen },
];

export const SETTINGS_NAV_ITEM: NavItem = {
  id: "settings",
  path: "/settings",
  icon: Settings2,
};

export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM];

export const NAV_VIEWS: View[] = NAV_ITEMS.map((item) => item.id);

/** Dev-only route metadata for typed palette matches. */
export const SHOWCASE_NAV = {
  id: "showcase",
  path: "/showcase",
  icon: Palette,
  title: "UI Showcase",
} as const;

/**
 * Navigation from non-React code (e.g. a toast's click-through action). App
 * registers its router navigate once; module-level code calls appNavigate.
 */
let navigateListener: ((path: string) => void) | null = null;

export function registerNavigate(listener: (path: string) => void): () => void {
  navigateListener = listener;
  return () => {
    if (navigateListener === listener) navigateListener = null;
  };
}

export function appNavigate(path: string): void {
  navigateListener?.(path);
}

/** Open the Cmd+K search palette; its single instance registers itself. */
let openSearchListener: (() => void) | null = null;

export function registerOpenSearch(listener: () => void): () => void {
  openSearchListener = listener;
  return () => {
    if (openSearchListener === listener) openSearchListener = null;
  };
}

export function openSearch(): void {
  openSearchListener?.();
}
