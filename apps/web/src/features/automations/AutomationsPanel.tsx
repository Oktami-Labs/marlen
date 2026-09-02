import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Automation } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ParseKeys } from "i18next";
import { CalendarClock, Menu, Plus } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { AutomationFormDialog } from "@/features/automations/AutomationFormDialog";
import { AutomationRow } from "@/features/automations/AutomationRow";
import { type TriggerKind, triggerKind } from "@/features/automations/schedule";
import { COLUMN_HEAD } from "@/features/home/NeedsYouSection";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn, errorMessage, midpoint, rowTransition, stagger } from "@/lib/utils";

const GROUPS: { kind: TriggerKind; label: ParseKeys }[] = [
  { kind: "schedule", label: "automations.groupSchedule" },
  { kind: "mail", label: "automations.groupMail" },
  { kind: "manual", label: "automations.groupManual" },
];

/**
 * The automations list: bare rows grouped by what starts them, in the
 * user's own order inside a group. `?automation=<id>` opens that
 * automation's settings dialog (`new` for one not yet saved), so Home can
 * link to one and back closes it.
 */
export function AutomationsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const automationsQuery = useQuery({
    queryKey: ["automations", "list"],
    queryFn: () => api.automations(),
    meta: { suppressErrorToast: true },
  });
  const automations = automationsQuery.data ?? null;

  const automationParam = searchParams.get("automation");
  const openAutomation = (id: string) => setSearchParams({ automation: id });
  const closeDialog = () => setSearchParams({}, { replace: true });
  const selected = automationParam
    ? (automations?.find((a) => a.id === automationParam) ?? null)
    : null;

  // Selected but not in the list: it was deleted elsewhere, so the dialog has
  // nothing to show and the list is the honest answer, said out loud.
  const gone =
    automationParam !== null && automationParam !== "new" && automations !== null && !selected;
  React.useEffect(() => {
    if (!gone) return;
    toast.info(t("automations.gone"));
    setSearchParams({}, { replace: true });
  }, [gone, setSearchParams, t]);

  const dialog = (automationParam === "new" || selected) && (
    <AutomationFormDialog
      key={selected?.id ?? "new"}
      open
      automation={selected}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    />
  );
  const newButton = (
    <Button size="sm" onClick={() => openAutomation("new")}>
      <Plus /> {t("automations.new")}
    </Button>
  );

  if (automations === null) {
    return (
      <div className="flex flex-col">
        <div className={cn(COLUMN_HEAD, "justify-end")}>{newButton}</div>
        {automationsQuery.error ? (
          <RetryableError onRetry={() => void automationsQuery.refetch()}>
            {errorMessage(automationsQuery.error)}
          </RetryableError>
        ) : (
          <LoadingRow className="px-3" />
        )}
        {dialog}
      </div>
    );
  }

  if (automations.length === 0) {
    return (
      <>
        <EmptyState
          surface={false}
          icon={CalendarClock}
          title={t("automations.emptyTitle")}
          description={t("automations.emptyBody")}
          action={newButton}
        />
        {dialog}
      </>
    );
  }

  return (
    <>
      <AutomationList
        automations={automations}
        onOpen={openAutomation}
        newButton={newButton}
        onReorder={(next, moved, position) => {
          queryClient.setQueryData<Automation[]>(
            ["automations", "list"],
            next.map((a) => (a.id === moved ? { ...a, position } : a)),
          );
          api.updateAutomation(moved, { position }).catch((err: unknown) => {
            toast.error(err);
            void queryClient.invalidateQueries({ queryKey: ["automations"] });
          });
        }}
      />
      {dialog}
    </>
  );
}

function AutomationList({
  automations,
  onOpen,
  newButton,
  onReorder,
}: {
  automations: Automation[];
  onOpen: (id: string) => void;
  newButton: React.ReactNode;
  onReorder: (next: Automation[], movedId: string, position: number) => void;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragId, setDragId] = React.useState<string | null>(null);
  const dragged = automations.find((a) => a.id === dragId) ?? null;

  const groups = GROUPS.map((group) => ({
    ...group,
    items: automations.filter((a) => triggerKind(a) === group.kind),
  })).filter((group) => group.items.length > 0);

  // A drop lands between its new neighbours within the group; the sort key
  // is global, so the row also keeps its place relative to other groups.
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const group = groups.find((g) => g.items.some((a) => a.id === active.id));
    if (!group?.items.some((a) => a.id === over.id)) return;
    const from = group.items.findIndex((a) => a.id === active.id);
    const to = group.items.findIndex((a) => a.id === over.id);
    const nextGroup = arrayMove(group.items, from, to);
    const position = midpoint(nextGroup[to - 1]?.position, nextGroup[to + 1]?.position);
    const next = automations
      .map((a) => (a.id === active.id ? { ...a, position } : a))
      .sort((a, b) => a.position - b.position);
    onReorder(next, String(active.id), position);
  };

  let index = 0;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setDragId(String(e.active.id))}
      onDragCancel={() => setDragId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="flex flex-col">
        {groups.map((group, groupIndex) => (
          <section key={group.kind} className="flex flex-col">
            {groupIndex === 0 ? (
              <div className={COLUMN_HEAD}>
                <GroupLabel as="h2" count={group.items.length}>
                  {t(group.label)}
                </GroupLabel>
                <div className="ml-auto">{newButton}</div>
              </div>
            ) : (
              <GroupLabel as="h2" count={group.items.length} className="px-3 pb-0.5 pt-3">
                {t(group.label)}
              </GroupLabel>
            )}
            <SortableContext
              items={group.items.map((a) => a.id)}
              strategy={verticalListSortingStrategy}
            >
              {group.items.map((automation) => (
                <div
                  key={automation.id}
                  className="animate-in-up"
                  style={{ ...stagger(index++), ...rowTransition(automation.id) }}
                >
                  <SortableRow id={automation.id}>
                    <AutomationRow automation={automation} onOpen={() => onOpen(automation.id)} />
                  </SortableRow>
                </div>
              ))}
            </SortableContext>
          </section>
        ))}
      </div>
      <DragOverlay>
        {dragged && <AutomationRow automation={dragged} onOpen={() => onOpen(dragged.id)} />}
      </DragOverlay>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group/auto relative", isDragging && "opacity-50")}
    >
      <button
        type="button"
        className={cn(
          "absolute -left-6 top-3.5 cursor-grab touch-none p-1 text-muted-foreground/50 hover:text-muted-foreground",
          // The gutter it sits in only exists once the column has margins.
          "max-sm:hidden opacity-0 transition-opacity focus-visible:opacity-100 group-hover/auto:opacity-100",
        )}
        aria-label={t("automations.reorder")}
        {...attributes}
        {...listeners}
      >
        <Menu className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}
