import type { Automation } from "@marlen/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Ellipsis,
  Inbox,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Trash2,
  Zap,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { OptionRow } from "@/components/ui/option-row";
import { firstSentence, scheduleLabel, triggerKind } from "@/features/automations/schedule";
import { NeedsRow } from "@/features/home/NeedsRow";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useAnchoredPopover } from "@/lib/useAnchoredPopover";
import { cn, withViewTransition } from "@/lib/utils";

const TRIGGER_ICON = { schedule: CalendarClock, mail: Inbox, manual: Zap } as const;

/**
 * One automation in the list: its trigger's chip, the name (with the pin when
 * it leads Home), the instruction's first sentence, and at the right what
 * state it is in and when it runs. The row opens the automation's page; the
 * hover menu holds the verbs.
 */
export function AutomationRow({
  automation,
  onOpen,
}: {
  automation: Automation;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const menu = useAnchoredPopover<HTMLSpanElement>({ align: "end" });
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const Icon = TRIGGER_ICON[triggerKind(automation)];
  const schedule =
    scheduleLabel(automation.schedule, t, i18n.language) ?? t("automations.customSchedule");
  const running = automation.lastRun?.status === "running";
  const failed = automation.lastRun?.status === "error";

  const act = async (work: () => Promise<unknown>) => {
    menu.setOpen(false);
    setBusy(true);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ["automations"] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  // The row leaves in the same frame the delete lands; the refetch the
  // server event triggers finds it already gone.
  const remove = async () => {
    try {
      await api.deleteAutomation(automation.id);
    } catch (err) {
      toast.error(err);
      return false;
    }
    withViewTransition(() =>
      queryClient.setQueryData<Automation[]>(["automations", "list"], (list) =>
        list?.filter((item) => item.id !== automation.id),
      ),
    );
    return true;
  };

  const items = [
    {
      icon: Play,
      label: t("automations.runNow"),
      disabled: running,
      onSelect: () => act(() => api.runAutomation(automation.id)),
    },
    {
      icon: automation.pinned ? PinOff : Pin,
      label: t(automation.pinned ? "automations.unpin" : "automations.pinShort"),
      onSelect: () => act(() => api.setAutomationPinned(automation.id, !automation.pinned)),
    },
    {
      icon: automation.enabled ? Pause : Play,
      label: t(automation.enabled ? "automations.pause" : "automations.resume"),
      onSelect: () =>
        act(() => api.updateAutomation(automation.id, { enabled: !automation.enabled })),
    },
    {
      icon: Pencil,
      label: t("automations.edit"),
      onSelect: () => {
        menu.setOpen(false);
        onOpen();
      },
    },
    {
      icon: Trash2,
      label: t("automations.delete"),
      danger: true,
      onSelect: () => {
        menu.setOpen(false);
        setConfirmDelete(true);
      },
    },
  ];

  return (
    <>
      <NeedsRow
        mark={
          <IconChip size="sm" tone="tint-neutral">
            <Icon />
          </IconChip>
        }
        title={
          <>
            <span className={cn("truncate", !automation.enabled && "text-muted-foreground")}>
              {automation.name}
            </span>
            {automation.pinned && (
              <Pin
                aria-label={t("automations.pinned")}
                className="h-3.5 w-3.5 shrink-0 fill-accent/25 text-accent-text"
              />
            )}
          </>
        }
        meta={firstSentence(automation.instruction)}
        onPress={onOpen}
        actionsOpen={menu.open}
        actions={
          <span ref={menu.triggerRef} className="flex">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("automations.actions")}
              aria-haspopup="menu"
              aria-expanded={menu.open}
              disabled={busy}
              onClick={() => menu.setOpen((open) => !open)}
            >
              <Ellipsis />
            </Button>
          </span>
        }
        trailing={
          <span className="flex items-center gap-2 pr-1 text-xs text-muted-foreground">
            {running && (
              <span className="flex items-center gap-1.5">
                <AccountDot tone="accent" className="dot-breathe h-2 w-2" />
                <span className="text-shimmer">{t("automations.running")}</span>
              </span>
            )}
            {failed && <Badge variant="destructive">{t("automations.runStatus.error")}</Badge>}
            <span className="whitespace-nowrap tabular-nums">
              {automation.enabled ? schedule : t("automations.paused")}
            </span>
          </span>
        }
      />

      {menu.open &&
        createPortal(
          <div
            ref={menu.popoverRef}
            role="menu"
            aria-label={t("automations.actions")}
            className="surface-pop animate-in-up fixed z-50 flex w-52 flex-col gap-0.5 p-1"
            style={menu.pos ?? { left: 0, top: 0, visibility: "hidden" }}
          >
            {items.map(({ icon: ItemIcon, label, danger, disabled, onSelect }) => (
              <OptionRow
                key={label}
                role="menuitem"
                icon={<ItemIcon className="h-4 w-4 shrink-0" />}
                label={label}
                disabled={disabled}
                className={cn(
                  "gap-2 rounded-md px-2 py-1.5",
                  danger && "text-destructive hover:bg-destructive/10",
                )}
                onClick={onSelect}
              />
            ))}
          </div>,
          document.body,
        )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("automations.delete")}
        description={t("automations.deleteConfirm", { name: automation.name })}
        confirmLabel={t("automations.delete")}
        onConfirm={remove}
      />
    </>
  );
}
