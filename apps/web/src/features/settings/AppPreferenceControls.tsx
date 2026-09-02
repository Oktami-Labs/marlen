import {
  ACCENT_COLOR_PREFERENCES,
  type AccentColorPreference,
  isLanguage,
  LANGUAGE_LABELS,
  QUICK_ACTION_PREFERENCES,
  SUPPORTED_LANGUAGES,
} from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { applyLanguagePreference } from "@/lib/i18n";
import { useLaunchAtLoginPreference } from "@/lib/launchAtLogin";
import { type QuickActionMode, useQuickActionMode } from "@/lib/quickActions";
import { toast } from "@/lib/toast";
import { ACCENT_COLOR_PRESETS, useAccentColor } from "@/lib/useTheme";
import { errorMessage } from "@/lib/utils";

const TIMEZONE_QUERY_KEY = ["settings", "timezone"] as const;

type ControlProps = { id?: string; className?: string };

function useControlId(id: string | undefined, prefix: string): string {
  const generated = React.useId();
  return id ?? `${prefix}-${generated}`;
}

function isAccentColorPreference(value: string): value is AccentColorPreference {
  return (ACCENT_COLOR_PREFERENCES as readonly string[]).includes(value);
}

function isQuickActionMode(value: string): value is QuickActionMode {
  return (QUICK_ACTION_PREFERENCES as readonly string[]).includes(value);
}

export function useSaveState() {
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const resetTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const run = async (save: () => Promise<void>) => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    setState("saving");
    setError(null);
    try {
      await save();
      setState("saved");
      resetTimer.current = window.setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  };

  return { state, error, run } as const;
}

export function SaveStatus({
  state,
  error,
}: {
  state: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  const { t } = useTranslation();
  if (state === "saving") return <Spinner className="h-3.5 w-3.5 text-muted-foreground" />;
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check className="h-3.5 w-3.5" />
        {t("common.saved")}
      </span>
    );
  }
  return error ? <span className="text-xs text-destructive">{error}</span> : null;
}

function SelectWithStatus({
  state,
  error,
  ...props
}: React.ComponentProps<typeof Select> & {
  state: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <SaveStatus state={state} error={error} />
      <Select {...props} />
    </div>
  );
}

export function AccentColorControl({ id, className }: ControlProps) {
  const { t } = useTranslation();
  const controlId = useControlId(id, "accent-color");
  const [accentColor, setAccentColor] = useAccentColor();

  return (
    <Select
      id={controlId}
      aria-label={t("settings.accentColor.label")}
      className={className}
      value={accentColor}
      onChange={(value) => {
        if (isAccentColorPreference(value)) setAccentColor(value);
      }}
      options={ACCENT_COLOR_PRESETS.map((preset) => ({
        value: preset.id,
        label: t(preset.labelKey),
      }))}
    />
  );
}

export function LanguageControl({ id, className }: ControlProps) {
  const { t, i18n } = useTranslation();
  const controlId = useControlId(id, "language");
  const { state, error, run } = useSaveState();

  return (
    <SelectWithStatus
      id={controlId}
      aria-label={t("settings.sections.language.title")}
      className={className}
      state={state}
      error={error}
      value={i18n.language}
      onChange={(value) => {
        if (!isLanguage(value) || value === i18n.language) return;
        void run(async () => {
          const { language } = await api.setLanguage(value);
          await applyLanguagePreference(language);
        });
      }}
      options={SUPPORTED_LANGUAGES.map((code) => ({
        value: code,
        label: LANGUAGE_LABELS[code],
      }))}
      searchable
    />
  );
}

function timezoneOffset(timezone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en", { timeZone: timezone, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

let timezoneOptionsCache: { value: string; label: string }[] | null = null;

function timezoneLabel(timezone: string): string {
  const offset = timezoneOffset(timezone);
  return offset ? `${timezone} (${offset})` : timezone;
}

function getTimezoneOptions(): { value: string; label: string }[] {
  if (timezoneOptionsCache) return timezoneOptionsCache;
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [Intl.DateTimeFormat().resolvedOptions().timeZone];
  }
  timezoneOptionsCache = zones.map((timezone) => ({
    value: timezone,
    label: timezoneLabel(timezone),
  }));
  return timezoneOptionsCache;
}

export function useCurrentTimezone(): string {
  const fallback = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const { data } = useQuery({
    queryKey: TIMEZONE_QUERY_KEY,
    queryFn: api.timezone,
  });
  return data?.timezone ?? fallback;
}

export function TimezoneControl({ id, className }: ControlProps) {
  const { t } = useTranslation();
  const controlId = useControlId(id, "timezone");
  const queryClient = useQueryClient();
  const timezone = useCurrentTimezone();
  const { state, error, run } = useSaveState();
  const baseOptions = React.useMemo(getTimezoneOptions, []);
  const options = React.useMemo(
    () =>
      baseOptions.some((option) => option.value === timezone)
        ? baseOptions
        : [{ value: timezone, label: timezoneLabel(timezone) }, ...baseOptions],
    [baseOptions, timezone],
  );

  return (
    <SelectWithStatus
      id={controlId}
      aria-label={t("settings.timezone.label")}
      className={className}
      state={state}
      error={error}
      value={timezone}
      onChange={(next) => {
        if (next === timezone) return;
        const previous = queryClient.getQueryData<{ timezone: string | null }>(TIMEZONE_QUERY_KEY);
        queryClient.setQueryData(TIMEZONE_QUERY_KEY, { timezone: next });
        void run(async () => {
          try {
            const saved = await api.setTimezone(next);
            queryClient.setQueryData(TIMEZONE_QUERY_KEY, saved);
          } catch (err) {
            queryClient.setQueryData(TIMEZONE_QUERY_KEY, previous);
            throw err;
          }
        });
      }}
      options={options}
      searchable
    />
  );
}

export function QuickActionsControl({ id, className }: ControlProps) {
  const { t } = useTranslation();
  const controlId = useControlId(id, "quick-actions");
  const [mode, setMode] = useQuickActionMode();

  return (
    <Select
      id={controlId}
      aria-label={t("settings.sections.quickActions.title")}
      className={className}
      value={mode}
      onChange={(value) => {
        if (isQuickActionMode(value)) setMode(value);
      }}
      options={QUICK_ACTION_PREFERENCES.map((value) => ({
        value,
        label: t(`settings.sections.quickActions.${value}`),
      }))}
    />
  );
}

export function LaunchAtLoginControl({ id }: Pick<ControlProps, "id">) {
  const { t } = useTranslation();
  const controlId = useControlId(id, "launch-at-login");
  const { supported, enabled, apply } = useLaunchAtLoginPreference();
  const [saving, setSaving] = React.useState(false);

  if (!supported) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("settings.launchAtLogin.desktopOnly")}
      </span>
    );
  }
  if (enabled === null) return <Spinner className="h-3.5 w-3.5 text-muted-foreground" />;

  return (
    <Switch
      id={controlId}
      checked={enabled}
      disabled={saving}
      onCheckedChange={(next) => {
        setSaving(true);
        void apply(next)
          .catch(toast.error)
          .finally(() => setSaving(false));
      }}
      aria-label={t("settings.launchAtLogin.label")}
    />
  );
}
