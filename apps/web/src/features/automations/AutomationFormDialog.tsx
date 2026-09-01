import type { Automation } from "@marlen/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { GroupLabel } from "@/components/ui/group-label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SettingRow } from "@/components/ui/setting-row";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  buildCron,
  DEFAULT_PRESET,
  daysInMonth,
  monthName,
  parseCron,
  type SchedulePreset,
  scheduleLabel,
  weekdayName,
  weekdayShortName,
} from "@/features/automations/schedule";
import { api } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";
import { toast } from "@/lib/toast";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface AutomationFormState {
  name: string;
  instruction: string;
  showInActivity: boolean;
  runOnNewMail: boolean;
  notifyOnCompletion: boolean;
}

function initialForm(automation: Automation | null): AutomationFormState {
  if (!automation) {
    return {
      name: "",
      instruction: "",
      showInActivity: true,
      runOnNewMail: false,
      notifyOnCompletion: false,
    };
  }
  return {
    name: automation.name,
    instruction: automation.instruction,
    showInActivity: automation.showInActivity,
    runOnNewMail: automation.runOnNewMail,
    notifyOnCompletion: automation.notifyOnCompletion,
  };
}

type ScheduleDraft =
  | { kind: "preset"; preset: SchedulePreset }
  | { kind: "preserved"; schedule: string };

function defaultPreset(): SchedulePreset {
  return { ...DEFAULT_PRESET, weekdays: [...DEFAULT_PRESET.weekdays] };
}

function initialSchedule(automation: Automation | null): ScheduleDraft {
  if (!automation) return { kind: "preset", preset: defaultPreset() };
  const parsed = parseCron(automation.schedule);
  return parsed
    ? { kind: "preset", preset: parsed }
    : { kind: "preserved", schedule: automation.schedule };
}

export function AutomationFormDialog({
  open,
  automation,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  automation: Automation | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = React.useState(() => initialForm(automation));
  const [scheduleDraft, setScheduleDraft] = React.useState(() => initialSchedule(automation));
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const preset = scheduleDraft.kind === "preset" ? scheduleDraft.preset : null;
  const schedule =
    scheduleDraft.kind === "preset" ? buildCron(scheduleDraft.preset) : scheduleDraft.schedule;
  const scheduleValid =
    scheduleDraft.kind === "preserved" ||
    scheduleDraft.preset.frequency !== "custom" ||
    scheduleDraft.preset.weekdays.length > 0;
  const scheduleSummary = preset
    ? (scheduleLabel(schedule, t, i18n.language) ?? t("automations.customSchedule"))
    : t("automations.customSchedule");

  const updatePreset = (update: (current: SchedulePreset) => SchedulePreset) => {
    setScheduleDraft((current) => ({
      kind: "preset",
      preset: update(current.kind === "preset" ? current.preset : defaultPreset()),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      if (automation) {
        await api.updateAutomation(automation.id, { ...form, schedule });
      } else {
        await api.createAutomation({ ...form, schedule });
      }
      await onChanged();
      setSaving(false);
      onOpenChange(false);
    } catch (error) {
      toast.error(error);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!automation) return false;
    setSaving(true);
    try {
      await api.deleteAutomation(automation.id);
      await onChanged();
      setSaving(false);
      onOpenChange(false);
      return true;
    } catch (error) {
      toast.error(error);
      setSaving(false);
      return false;
    }
  };

  const frequencyOptions: Array<{
    value: SchedulePreset["frequency"];
    label: string;
  }> = [
    { value: "daily", label: t("automations.frequency.daily") },
    { value: "weekdays", label: t("automations.frequency.weekdays") },
    { value: "custom", label: t("automations.frequency.custom") },
    { value: "date", label: t("automations.frequency.date") },
    { value: "manual", label: t("automations.frequency.manual") },
  ];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={automation ? t("automations.editTitle") : t("automations.formTitle")}
        className="h-[calc(100dvh-1.5rem)] max-h-[52rem] max-w-5xl gap-5 p-5 sm:w-[calc(100%-3rem)] sm:p-6"
        bodyClassName="min-h-0 flex-1 gap-0 overflow-y-auto md:overflow-hidden"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {automation ? (
              <Button
                variant="ghost-danger"
                className="text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                {t("automations.delete")}
              </Button>
            ) : (
              <div />
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => void save()}
                disabled={!form.name.trim() || !form.instruction.trim() || !scheduleValid}
                loading={saving}
              >
                {automation ? t("automations.save") : t("automations.create")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-6 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
          <section className="flex flex-col gap-4 md:min-h-0 md:overflow-y-auto md:pr-1">
            <GroupLabel>{t("automations.taskSection")}</GroupLabel>
            <FormField id="automation-name" label={t("automations.name")}>
              <Input
                id="automation-name"
                autoFocus
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder={t("automations.namePlaceholder")}
              />
            </FormField>

            <FormField
              id="automation-instruction"
              label={t("automations.instruction")}
              hint={t("automations.instructionHint")}
              className="md:min-h-0 md:flex-1"
            >
              <Textarea
                id="automation-instruction"
                value={form.instruction}
                onChange={(event) => setForm({ ...form, instruction: event.target.value })}
                placeholder={t("automations.instructionPlaceholder")}
                rows={14}
                className="min-h-64 flex-1 resize-none md:min-h-0"
              />
            </FormField>
          </section>

          <div className="flex flex-col gap-6 md:min-h-0 md:overflow-y-auto md:pr-1">
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <GroupLabel>{t("automations.timingSection")}</GroupLabel>
                </div>
                {scheduleSummary ? (
                  <Badge variant="muted" className="max-w-48 truncate text-2xs">
                    {scheduleSummary}
                  </Badge>
                ) : null}
              </div>

              <fieldset className="flex flex-wrap gap-1.5">
                <legend className="sr-only">{t("automations.timingSection")}</legend>
                {frequencyOptions.map((option) => (
                  <Chip
                    key={option.value}
                    active={preset?.frequency === option.value}
                    className="h-8"
                    onClick={() =>
                      updatePreset((current) => ({ ...current, frequency: option.value }))
                    }
                  >
                    {option.label}
                  </Chip>
                ))}
              </fieldset>

              {!preset ? (
                <p className="text-xs text-muted-foreground">
                  {t("automations.customScheduleHint")}
                </p>
              ) : null}

              {preset?.frequency === "custom" ? (
                <FormField
                  id="automation-weekdays"
                  label={t("automations.days")}
                  error={
                    preset.weekdays.length === 0 ? t("automations.customDaysRequired") : undefined
                  }
                >
                  <WeekdayToggle
                    value={preset.weekdays}
                    onChange={(weekdays) => updatePreset((current) => ({ ...current, weekdays }))}
                    locale={i18n.language}
                  />
                </FormField>
              ) : null}

              {preset?.frequency === "date" ? (
                <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                  <FormField id="automation-month" label={t("automations.month")}>
                    <Select
                      id="automation-month"
                      value={String(preset.month)}
                      onChange={(value) => {
                        const month = Number(value);
                        const maxDay = daysInMonth(month);
                        updatePreset((current) => ({
                          ...current,
                          month,
                          day: Math.min(current.day, maxDay),
                        }));
                      }}
                      options={Array.from({ length: 12 }, (_, index) => index + 1).map((month) => ({
                        value: String(month),
                        label: monthName(month, i18n.language),
                      }))}
                    />
                  </FormField>
                  <FormField id="automation-day" label={t("automations.day")}>
                    <Select
                      id="automation-day"
                      value={String(preset.day)}
                      onChange={(value) =>
                        updatePreset((current) => ({ ...current, day: Number(value) }))
                      }
                      options={Array.from({ length: daysInMonth(preset.month) }, (_, index) => ({
                        value: String(index + 1),
                        label: String(index + 1),
                      }))}
                    />
                  </FormField>
                </div>
              ) : null}

              {preset && preset.frequency !== "manual" ? (
                <FormField id="automation-time" label={t("automations.time")}>
                  <Input
                    id="automation-time"
                    type="time"
                    value={preset.time}
                    onChange={(event) =>
                      updatePreset((current) => ({
                        ...current,
                        time: event.target.value || "08:00",
                      }))
                    }
                    className="w-32 tabular-nums"
                  />
                </FormField>
              ) : null}
              {preset?.frequency === "date" ? (
                <p className="text-xs text-muted-foreground">{t("automations.dateOnceHint")}</p>
              ) : null}
              {preset?.frequency === "manual" ? (
                <p className="text-xs text-muted-foreground">{t("automations.manualHint")}</p>
              ) : null}
            </section>

            <section className="flex flex-col gap-3">
              <GroupLabel>{t("automations.runSettings")}</GroupLabel>
              <div className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4">
                <SettingRow
                  bare
                  htmlFor="automation-activity"
                  label={t("automations.showInActivity")}
                  description={t("automations.showInActivityHint")}
                >
                  <Switch
                    id="automation-activity"
                    checked={form.showInActivity}
                    onCheckedChange={(showInActivity) => setForm({ ...form, showInActivity })}
                    aria-label={t("automations.showInActivity")}
                  />
                </SettingRow>

                <SettingRow
                  bare
                  htmlFor="automation-run-on-new-mail"
                  label={t("automations.runOnNewMail")}
                  description={t("automations.runOnNewMailHint")}
                >
                  <Switch
                    id="automation-run-on-new-mail"
                    checked={form.runOnNewMail}
                    onCheckedChange={(runOnNewMail) => setForm({ ...form, runOnNewMail })}
                    aria-label={t("automations.runOnNewMail")}
                  />
                </SettingRow>

                <SettingRow
                  bare
                  htmlFor="automation-notify"
                  label={t("automations.notifyOnCompletion")}
                  description={t("automations.notifyOnCompletionHint")}
                >
                  <Switch
                    id="automation-notify"
                    checked={form.notifyOnCompletion}
                    onCheckedChange={(notifyOnCompletion) => {
                      setForm({ ...form, notifyOnCompletion });
                      if (
                        notifyOnCompletion &&
                        !desktopBridge() &&
                        "Notification" in window &&
                        Notification.permission === "default"
                      ) {
                        void Notification.requestPermission();
                      }
                    }}
                    aria-label={t("automations.notifyOnCompletion")}
                  />
                </SettingRow>
              </div>
            </section>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("automations.delete")}
        description={t("automations.deleteConfirm", { name: form.name })}
        confirmLabel={t("automations.delete")}
        busy={saving}
        onConfirm={remove}
      />
    </>
  );
}

function WeekdayToggle({
  value,
  onChange,
  locale,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  locale: string;
}) {
  const toggle = (day: number) => {
    onChange(
      value.includes(day)
        ? value.filter((current) => current !== day)
        : [...value, day].sort((left, right) => left - right),
    );
  };
  return (
    <div id="automation-weekdays" className="flex flex-wrap gap-1.5">
      {WEEKDAY_ORDER.map((day) => (
        <Chip
          key={day}
          active={value.includes(day)}
          onClick={() => toggle(day)}
          aria-label={weekdayName(day, locale)}
          className="h-8 min-w-8 justify-center"
        >
          {weekdayShortName(day, locale)}
        </Chip>
      ))}
    </div>
  );
}
