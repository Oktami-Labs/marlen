import { type AppStatus, isSetupComplete } from "@marlen/shared";
import { useQuery } from "@tanstack/react-query";
import { type LucideIcon, TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { UpdatePill, useUpdateState } from "@/components/UpdatePill";
import { AvatarMark } from "@/components/ui/avatar-mark";
import { Button } from "@/components/ui/button";
import { OptionRow } from "@/components/ui/option-row";
import { PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM } from "@/lib/nav";
import { useAnchoredPopover } from "@/lib/useAnchoredPopover";
import { profileQuery } from "@/lib/useServerPreferences";
import { cn, withViewTransition } from "@/lib/utils";

interface SidebarProps {
  status: AppStatus | null;
  /** Icon rail from `md` up; the mobile drawer always shows labels. */
  collapsed: boolean;
  onClose: () => void;
}

/** One row of the rail. Nav links and the profile trigger share it so their
 *  hover tint, focus ring and collapsed centring stay identical. */
const railItemClass = cn(
  "group relative flex w-full items-center rounded-lg text-sm font-medium transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);
const railItemCollapsedClass = "md:justify-center md:px-0";

interface SidebarNavLinkProps {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  onClick: () => void;
  active?: boolean;
  /** "warning" is the "finish setup" nudge, always warning-toned, never tracks route match. */
  tone?: "default" | "warning";
}

/** Icon + label nav link shared by the primary rail and its footer. */
function SidebarNavLink({
  to,
  icon: Icon,
  label,
  collapsed,
  onClick,
  active = false,
  tone = "default",
}: SidebarNavLinkProps) {
  const isWarning = tone === "warning";
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      onClick={(event) => {
        onClick();
        // A modified click still means "open elsewhere", so leave those to the
        // browser and keep the real href. A plain one navigates here instead,
        // inside a view transition: BrowserRouter is not a data router, so
        // react-router's own `viewTransition` never fires.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        withViewTransition(() => navigate(to));
      }}
      aria-current={!isWarning && active ? "page" : undefined}
      // The label leaves the rail when it collapses; this keeps the name and
      // doubles as the cursor tooltip.
      aria-label={collapsed ? label : undefined}
      className={cn(
        railItemClass,
        "gap-3 px-3 py-2",
        collapsed && railItemCollapsedClass,
        isWarning
          ? "text-warning hover:bg-accent/[0.08]"
          : active
            ? "text-accent-text"
            : "text-muted-foreground hover:bg-accent/[0.08] hover:text-foreground",
      )}
    >
      {!isWarning && active && (
        <span
          aria-hidden="true"
          className="sidebar-active-indicator pointer-events-none absolute inset-0 rounded-lg bg-accent/10"
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span className={cn("min-w-0 truncate", collapsed && "md:hidden")}>{label}</span>
    </Link>
  );
}

function ProfileMenu({
  active,
  collapsed,
  onNavigate,
}: {
  active: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { open, setOpen, pos, triggerRef, popoverRef } = useAnchoredPopover<HTMLDivElement>();
  const { data: profile } = useQuery(profileQuery);
  const label = profile?.name || t("sidebar.localProfile");
  const SettingsIcon = SETTINGS_NAV_ITEM.icon;

  return (
    <div ref={triggerRef} className="w-full">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={t("sidebar.openProfileMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          railItemClass,
          "gap-2 px-3 py-1 text-left hover:bg-accent/[0.08]",
          collapsed && railItemCollapsedClass,
          active ? "text-accent-text" : "text-foreground",
        )}
      >
        <AvatarMark
          name={label}
          src={profile?.avatar}
          tone={active ? "tint-accent" : "tint-neutral"}
          size="md"
          className="h-10 w-10 text-xs"
        />
        <span className={cn("min-w-0 flex-1 truncate", collapsed && "md:hidden")}>{label}</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            aria-label={t("sidebar.profileMenu")}
            className="surface-pop animate-in-up fixed z-[130] flex w-56 flex-col gap-0.5 p-1"
            style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
          >
            <OptionRow
              icon={<SettingsIcon className="h-4 w-4 shrink-0" />}
              label={t("views.settings.title")}
              selected={active}
              role="menuitem"
              aria-current={active ? "page" : undefined}
              className="gap-2 rounded-md px-2 py-1.5"
              onClick={() => {
                setOpen(false);
                onNavigate();
                withViewTransition(() => navigate(SETTINGS_NAV_ITEM.path));
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

export function Sidebar({ status, collapsed, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const update = useUpdateState();
  const setupIncomplete = status !== null && !isSetupComplete(status);

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col overflow-hidden bg-background md:w-full">
      <div
        // titlebar-pad/drag are inert unless the desktop shell floats the
        // window controls over this corner (macOS); then this row clears them
        // and doubles as the window drag handle.
        className={cn(
          "titlebar-pad titlebar-drag flex items-center gap-2 px-3 pb-3 pt-4",
          collapsed && "md:justify-center",
        )}
      >
        <Link
          to="/"
          onClick={onClose}
          className="flex min-w-0 shrink-0 items-center gap-2"
          title="Go to Homepage"
        >
          <BrandMark
            label="Marlene Logo"
            className="h-9 w-auto text-accent transition-opacity duration-150 hover:opacity-80 motion-reduce:transition-none"
          />
          <span
            className={cn(
              "truncate text-lg font-semibold tracking-tight",
              collapsed && "md:hidden",
            )}
          >
            Marlene
          </span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="ml-auto shrink-0 md:hidden"
          aria-label={t("sidebar.closeMenu")}
          data-tooltip={t("sidebar.closeMenu")}
        >
          <X />
        </Button>
      </div>

      <nav
        aria-label={t("sidebar.primaryNavigation")}
        className="flex flex-1 flex-col gap-1 px-3 pt-3"
      >
        {PRIMARY_NAV_ITEMS.map(({ id, path, icon }) => {
          const isActive =
            location.pathname === path || (path !== "/" && location.pathname.startsWith(path));
          return (
            <SidebarNavLink
              key={id}
              to={path}
              icon={icon}
              label={t(`views.${id}.title`)}
              collapsed={collapsed}
              onClick={onClose}
              active={isActive}
            />
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 p-3">
        {setupIncomplete && (
          <SidebarNavLink
            to="/settings"
            icon={TriangleAlert}
            label={t("sidebar.finishSetup")}
            collapsed={collapsed}
            onClick={onClose}
            tone="warning"
          />
        )}

        {update && <UpdatePill state={update} compact={collapsed} />}

        <ProfileMenu
          active={location.pathname.startsWith(SETTINGS_NAV_ITEM.path)}
          collapsed={collapsed}
          onNavigate={onClose}
        />
      </div>
    </aside>
  );
}
