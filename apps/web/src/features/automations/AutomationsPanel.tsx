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
import type { Automation, AutomationSuggestion } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Menu, Plus, Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { AutomationCard } from "@/features/automations/AutomationCard";
import { AutomationFormDialog } from "@/features/automations/AutomationFormDialog";
import { scheduleLabel } from "@/features/automations/schedule";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn, midpoint, rowTransition, stagger } from "@/lib/utils";

type FormTarget = { kind: "create" } | { kind: "edit"; automation: Automation };

export function AutomationsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [{ flashSuggestions, focusAutomation }] = React.useState(() => {
    const state = location.state as {
      focusSuggestions?: boolean;
      focusAutomation?: string;
    } | null;
    return {
      flashSuggestions: Boolean(state?.focusSuggestions),
      focusAutomation: state?.focusAutomation ?? null,
    };
  });
  React.useEffect(() => {
    if (flashSuggestions || focusAutomation) navigate(location.pathname, { replace: true });
  }, [flashSuggestions, focusAutomation, navigate, location.pathname]);
  const automationsQuery = useQuery({
    queryKey: ["automations", "list"],
    queryFn: () => api.automations(),
  });
  const suggestionsQuery = useQuery({
    queryKey: ["automations", "suggestions"],
    queryFn: () => api.automationSuggestions(),
  });
  const automations = automationsQuery.data ?? [];
  const suggestions = suggestionsQuery.data ?? [];
  const loading = automationsQuery.isPending || suggestionsQuery.isPending;
  const loadError = automationsQuery.error ?? suggestionsQuery.error;
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

      {suggestions.length > 0 && (
        <div className="mb-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <IconChip size="sm">
              <Sparkles />
            </IconChip>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                {t("automations.suggestions.title")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("automations.suggestions.hint")}</p>
            </div>
          </div>
          {suggestions.map((suggestion, i) => (
            <div key={suggestion.id} className="animate-in-up" style={stagger(i)}>
              <SuggestionCard
                suggestion={suggestion}
                flash={flashSuggestions}
                onDecided={refreshAutomations}
              />
            </div>
          ))}
        </div>
      )}

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

function SuggestionCard({
  suggestion,
  flash,
  onDecided,
}: {
  suggestion: AutomationSuggestion;
  flash: boolean;
  onDecided: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = React.useState(false);
  const [showInstruction, setShowInstruction] = React.useState(false);

  const label = scheduleLabel(suggestion.schedule, t, i18n.language);
  const scheduleText = label ?? t("automations.customSchedule");

  const decide = async (action: "accept" | "dismiss") => {
    setBusy(true);
    try {
      if (action === "accept") await api.acceptAutomationSuggestion(suggestion.id);
      else await api.dismissAutomationSuggestion(suggestion.id);
      await onDecided();
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className={cn(flash && "flash-accent")}>
      <div className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight">
        <IconChip size="sm">
          <Sparkles />
        </IconChip>
        {suggestion.name}
        <Badge variant="muted" className="text-2xs" title={scheduleText}>
          {scheduleText}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{suggestion.rationale}</p>
      <div className="mt-2">
        <DisclosureToggle open={showInstruction} onToggle={() => setShowInstruction((v) => !v)}>
          {t("automations.suggestions.showInstruction")}
        </DisclosureToggle>
        {showInstruction && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-muted-foreground">
            {suggestion.instruction}
          </p>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => void decide("dismiss")} disabled={busy}>
          {t("automations.suggestions.dismiss")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void decide("accept")} loading={busy}>
          {t("automations.suggestions.accept")}
        </Button>
      </div>
    </Card>
  );
}
