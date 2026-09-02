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
import { CalendarClock, Menu, Plus } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AutomationCard } from "@/features/automations/AutomationCard";
import { AutomationFormDialog } from "@/features/automations/AutomationFormDialog";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn, midpoint, rowTransition, stagger } from "@/lib/utils";

type FormTarget = { kind: "create" } | { kind: "edit"; automation: Automation };

export function AutomationsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [focusAutomation] = React.useState(() => {
    const state = location.state as { focusAutomation?: string } | null;
    return state?.focusAutomation ?? null;
  });
  React.useEffect(() => {
    if (focusAutomation) navigate(location.pathname, { replace: true });
  }, [focusAutomation, navigate, location.pathname]);
  const automationsQuery = useQuery({
    queryKey: ["automations", "list"],
    queryFn: () => api.automations(),
  });
  const automations = automationsQuery.data ?? [];
  const loading = automationsQuery.isPending;
  const loadError = automationsQuery.error;
  React.useEffect(() => {
    if (loadError) toast.error(loadError);
  }, [loadError]);
  const refreshAutomations = () => queryClient.invalidateQueries({ queryKey: ["automations"] });
  const [formTarget, setFormTarget] = React.useState<FormTarget | null>(null);

  const focusRef = React.useRef<HTMLDivElement | null>(null);
  const focusPresent = automations.some((a) => a.id === focusAutomation);
  React.useEffect(() => {
    if (focusPresent) focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusPresent]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The card under the pointer renders in a DragOverlay; the in-list original
  // stays as a dimmed placeholder and the overlay animates into it on drop.
  const [dragId, setDragId] = React.useState<string | null>(null);
  const dragged = automations.find((a) => a.id === dragId) ?? null;

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = automations.findIndex((a) => a.id === active.id);
    const to = automations.findIndex((a) => a.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(automations, from, to);
    const position = midpoint(next[to - 1]?.position, next[to + 1]?.position);
    queryClient.setQueryData<Automation[]>(
      ["automations", "list"],
      next.map((a) => (a.id === active.id ? { ...a, position } : a)),
    );
    api.updateAutomation(String(active.id), { position }).catch((err: unknown) => {
      toast.error(err);
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    });
  };

  const openForEdit = (automation: Automation) => {
    setFormTarget({ kind: "edit", automation });
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setFormTarget({ kind: "create" })}>
          <Plus /> {t("automations.new")}
        </Button>
      </div>

      {formTarget ? (
        <AutomationFormDialog
          key={formTarget.kind === "edit" ? formTarget.automation.id : "create"}
          open
          automation={formTarget.kind === "edit" ? formTarget.automation : null}
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          onChanged={refreshAutomations}
        />
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Card key={i} padding="lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </Card>
          ))}
        </div>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t("automations.emptyTitle")}
          description={t("automations.emptyBody")}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setDragId(String(e.active.id))}
          onDragCancel={() => setDragId(null)}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={automations.map((a) => a.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-3">
              {automations.map((automation, i) => (
                <div
                  key={automation.id}
                  ref={automation.id === focusAutomation ? focusRef : undefined}
                  className="animate-in-up"
                  style={{ ...stagger(i), ...rowTransition(automation.id) }}
                >
                  <SortableAutomationRow id={automation.id}>
                    <AutomationCard
                      automation={automation}
                      flash={automation.id === focusAutomation}
                      onChanged={refreshAutomations}
                      onEdit={() => openForEdit(automation)}
                    />
                  </SortableAutomationRow>
                </div>
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {dragged && (
              <AutomationCard
                automation={dragged}
                onChanged={refreshAutomations}
                onEdit={() => openForEdit(dragged)}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function SortableAutomationRow({ id, children }: { id: string; children: React.ReactNode }) {
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
          "absolute -left-7 top-5 cursor-grab touch-none p-1 text-muted-foreground/50 hover:text-muted-foreground",
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
