import { useTranslation } from "react-i18next";
import { Chip } from "@/components/ui/chip";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DEFAULT_PRESET,
  daysInMonth,
  monthName,
  type ScheduleDraft,
  type SchedulePreset,
  weekdayName,
  weekdayShortName,
} from "@/features/automations/schedule";
import { dayTimeLabel } from "@/lib/dates";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The "when it runs" editor: a frequency chip row over the fields that
 * frequency needs. A cron the chips cannot express stays as it is, said
 * once under the chips, until a chip replaces it.
 */
export function ScheduleFields({
  draft,
  onChange,
  nextRunAt,
}: {
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  /** The server's next fire time for the saved schedule; read beside the time field. */
  nextRunAt?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const preset = draft.kind === "preset" ? draft.preset : null;

  const updatePreset = (update: (current: SchedulePreset) => SchedulePreset) =>
    onChange({
      kind: "preset",
      preset: update(preset ?? { ...DEFAULT_PRESET, weekdays: [...DEFAULT_PRESET.weekdays] }),
    });

  const frequencyOptions: Array<{ value: SchedulePreset["frequency"]; label: string }> = [
    { value: "daily", label: t("automations.frequency.daily") },
    { value: "weekdays", label: t("automations.frequency.weekdays") },
    { value: "custom", label: t("automations.frequency.custom") },
    { value: "date", label: t("automations.frequency.date") },
    { value: "manual", label: t("automations.frequency.manual") },
  ];

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">{t("automations.timingSection")}</legend>
        {frequencyOptions.map((option) => (
          <Chip
            key={option.value}
            active={preset?.frequency === option.value}
            className="h-8"
            onClick={() => updatePreset((current) => ({ ...current, frequency: option.value }))}
          >
            {option.label}
          </Chip>
        ))}
      </fieldset>

      {!preset && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("automations.customSchedule")}</span>{" "}
          {t("automations.customScheduleHint")}
        </p>
      )}

      {preset?.frequency === "custom" && (
        <FormField
          id="automation-weekdays"
          label={t("automations.days")}
          error={preset.weekdays.length === 0 ? t("automations.customDaysRequired") : undefined}
        >
          <WeekdayToggle
            value={preset.weekdays}
            onChange={(weekdays) => updatePreset((current) => ({ ...current, weekdays }))}
            locale={i18n.language}
          />
        </FormField>
      )}

      {preset?.frequency === "date" && (
        <div className="grid max-w-xs grid-cols-[minmax(0,1fr)_5rem] gap-2">
          <FormField id="automation-month" label={t("automations.month")}>
            <Select
              id="automation-month"
              value={String(preset.month)}
              onChange={(value) => {
                const month = Number(value);
                updatePreset((current) => ({
                  ...current,
                  month,
                  day: Math.min(current.day, daysInMonth(month)),
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
              onChange={(value) => updatePreset((current) => ({ ...current, day: Number(value) }))}
              options={Array.from({ length: daysInMonth(preset.month) }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              }))}
            />
          </FormField>
        </div>
      )}

      {preset && preset.frequency !== "manual" && (
        <div className="flex flex-wrap items-end gap-3.5">
          <FormField id="automation-time" label={t("automations.time")}>
            <Input
              id="automation-time"
              type="time"
              value={preset.time}
              onChange={(event) =>
                updatePreset((current) => ({ ...current, time: event.target.value || "08:00" }))
              }
              className="w-32 tabular-nums"
            />
          </FormField>
          {nextRunAt && (
            <p className="pb-2.5 text-xs text-muted-foreground">
              {t("automations.nextRun", { when: dayTimeLabel(nextRunAt, i18n.language, "long") })}
            </p>
          )}
        </div>
      )}
      {preset?.frequency === "date" && (
        <p className="text-xs text-muted-foreground">{t("automations.dateOnceHint")}</p>
      )}
      {preset?.frequency === "manual" && (
        <p className="text-xs text-muted-foreground">{t("automations.manualHint")}</p>
      )}
    </div>
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
