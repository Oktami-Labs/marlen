import {
  type AppStatus,
  isLanguage,
  isSetupComplete,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
} from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cable,
  Check,
  Database,
  Download,
  type LucideIcon,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section-header";
import { Select } from "@/components/ui/select";
import { SettingRow } from "@/components/ui/setting-row";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ConnectionsPanel } from "@/features/connections/ConnectionsPanel";
import { useOnOfficeStatus } from "@/features/connections/OnOffice";
import { useWhatsAppStatus } from "@/features/connections/WhatsApp";
import { AboutPanel } from "@/features/settings/About";
import { FileAccessSection } from "@/features/settings/FileAccessSection";
import { Providers } from "@/features/settings/Providers";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";
import { rememberLanguage } from "@/lib/i18n";
import { type QuickActionMode, useQuickActionMode } from "@/lib/quickActions";
import { toast } from "@/lib/toast";
import { useTheme } from "@/lib/useTheme";
import { cn, errorMessage, withViewTransition } from "@/lib/utils";

const SETTINGS_VIEWS = [
  { id: "general", icon: SlidersHorizontal },
  { id: "connections", icon: Cable },
  { id: "permissions", icon: ShieldCheck },
  { id: "data", icon: Database },
] as const satisfies readonly { id: string; icon: LucideIcon }[];
type SettingsView = (typeof SETTINGS_VIEWS)[number]["id"];

function isSettingsView(value: string | null): value is SettingsView {
  return SETTINGS_VIEWS.some((view) => view.id === value);
}

export function SettingsPanel({
  status,
  onStatusChanged,
}: {
  status: AppStatus | null;
  onStatusChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("section");
  const defaultView: SettingsView =
    status !== null && !isSetupComplete(status) ? "connections" : "general";
  const view = isSettingsView(requestedView) ? requestedView : defaultView;

  React.useEffect(() => {
    if (isSettingsView(requestedView) || status === null) return;
    setSearchParams({ section: defaultView }, { replace: true });
  }, [defaultView, requestedView, setSearchParams, status]);

  const selectView = (next: SettingsView) => {
    if (next === view) return;
    withViewTransition(() => setSearchParams({ section: next }));
  };

  const content =
    view === "general" ? (
      <GeneralSettings />
    ) : view === "connections" ? (
      <ConnectionSettings status={status} onStatusChanged={onStatusChanged} />
    ) : view === "permissions" ? (
      <FileAccessSection index={0} />
    ) : (
      <DataSettings />
    );

  return (
    <div
      data-testid="settings-workspace"
      className="grid gap-6 pt-2 @3xl:grid-cols-[11rem_minmax(0,1fr)] @3xl:gap-10"
    >
      <nav
        aria-label={t("settings.nav.label")}
        className="hidden self-start @3xl:sticky @3xl:top-2 @3xl:flex @3xl:flex-col @3xl:gap-1"
      >
        {SETTINGS_VIEWS.map(({ id, icon: Icon }) => {
          const active = id === view;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => selectView(id)}
              className={cn(
                "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:bg-accent/[0.08] hover:text-foreground",
              )}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              <span>{t(`settings.nav.${id}`)}</span>
            </button>
          );
        })}
      </nav>

      <Select
        id="settings-category"
        aria-label={t("settings.nav.label")}
        className="@3xl:hidden"
        value={view}
        onChange={(next) => {
          if (isSettingsView(next)) selectView(next);
        }}
        options={SETTINGS_VIEWS.map(({ id }) => ({
          value: id,
          label: t(`settings.nav.${id}`),
        }))}
      />

      <div className="@container min-w-0 @3xl:col-start-2 @3xl:row-start-1">{content}</div>
    </div>
  );
}

function ConnectionSettings({
  status,
  onStatusChanged,
}: {
  status: AppStatus | null;
  onStatusChanged?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { accounts } = useAccountColors();
  const { status: onOffice } = useOnOfficeStatus();
  const { status: whatsApp } = useWhatsAppStatus();
  const providersQuery = useQuery({
    queryKey: ["llm", "providers"],
    queryFn: api.llmProviders,
  });
  const providers = providersQuery.data ?? null;

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["llm"] });
    onStatusChanged?.();
  }, [onStatusChanged, queryClient]);

  const connectedIds = React.useMemo(
    () => providers?.filter((p) => p.auth !== null).map((p) => p.id) ?? [],
    [providers],
  );

  const connectedCount =
    accounts.length + (onOffice?.configured ? 1 : 0) + (whatsApp?.linked ? 1 : 0);

  const accountsChip = (() => {
    if (!status) return null;
    if (!status.pipedreamConfigured) {
      return (
        <Badge variant="warning">
          <TriangleAlert /> {t("settings.sections.accounts.chipSetup")}
        </Badge>
      );
    }
    if (!status.emailAccountsKnown) return null;
    if (connectedCount > 0) {
      return (
        <Badge variant="success">
          <Check /> {t("settings.sections.accounts.chipConnected", { count: connectedCount })}
        </Badge>
      );
    }
    return <Badge variant="muted">{t("settings.sections.accounts.chipNoAccounts")}</Badge>;
  })();

  return (
    <div className="flex flex-col gap-10">
      <Section
        index={0}
        className="animate-in-up"
        title={t("settings.sections.ai.title")}
        aside={
          status &&
          (status.modelConfigured ? (
            <Badge variant="success">
              <Check /> {t("settings.sections.ai.chipReady")}
            </Badge>
          ) : (
            <Badge variant="warning">
              <TriangleAlert /> {t("settings.sections.ai.chipSignIn")}
            </Badge>
          ))
        }
      >
        <div className="flex flex-col gap-5">
          <Providers providers={providers} onChanged={refresh} />
          <Card padding="md">
            <ModelPicker connectedIds={connectedIds} onSaved={refresh} />
          </Card>
        </div>
      </Section>

      <Section
        index={1}
        className="animate-in-up"
        title={t("settings.sections.accounts.title")}
        aside={accountsChip}
      >
        <ConnectionsPanel onStatusChanged={() => void refresh()} />
      </Section>
    </div>
  );
}

function GeneralSettings() {
  const { t } = useTranslation();
  return (
    <Section index={0} className="animate-in-up" title={t("settings.sections.preferences.title")}>
      <Card padding="sm" className="flex flex-col gap-1">
        <AppearanceRow />
        <LanguageRow />
        <TimezoneRow />
        <QuickActionsRow />
        <LaunchAtLoginRow />
      </Card>
    </Section>
  );
}

function DataSettings() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-10">
      <Section index={0} className="animate-in-up" title={t("settings.sections.data.title")}>
        <Card padding="sm">
          <DataExportRow />
        </Card>
      </Section>
      <Section index={1} className="animate-in-up" title={t("settings.sections.about.title")}>
        <AboutPanel />
      </Section>
    </div>
  );
}

function DataExportRow() {
  const { t } = useTranslation();
  return (
    <SettingRow
      bare
      className="rounded-lg px-2 py-2.5"
      label={t("settings.export.label")}
      description={t("settings.export.description")}
    >
      <Button variant="secondary" size="sm" onClick={() => api.downloadDataExport()}>
        <Download />
        {t("settings.export.cta")}
      </Button>
    </SettingRow>
  );
}

function useSaveState() {
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
  return { state, error, run };
}

function PreferenceRow({
  id,
  label,
  description,
  error,
  saving,
  saved,
  value,
  onChange,
  options,
  searchable,
}: {
  id: string;
  label: string;
  description: React.ReactNode;
  error?: string | null;
  saving?: boolean;
  saved?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  searchable?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SettingRow
      bare
      htmlFor={id}
      label={label}
      description={description}
      error={error}
      className="rounded-lg px-2 py-2.5"
    >
      {saving ? (
        <Spinner className="h-3.5 w-3.5 text-muted-foreground" />
      ) : saved ? (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5" />
          {t("common.saved")}
        </span>
      ) : null}
      <Select
        id={id}
        aria-label={label}
        className="w-full @md:w-52"
        value={value}
        onChange={onChange}
        options={options}
        searchable={searchable}
      />
    </SettingRow>
  );
}

function AppearanceRow() {
  const { t } = useTranslation();
  const [pref, , setPref] = useTheme();

  return (
    <PreferenceRow
      id="settings-appearance"
      label={t("settings.appearance.label")}
      description={t("settings.appearance.description")}
      value={pref}
      onChange={(value) => {
        if (value === "light" || value === "dark" || value === "system") setPref(value);
      }}
      options={[
        { value: "light", label: t("settings.appearance.light") },
        { value: "dark", label: t("settings.appearance.dark") },
        { value: "system", label: t("settings.appearance.system") },
      ]}
    />
  );
}

function LanguageRow() {
  const { t, i18n } = useTranslation();
  const { state, error, run } = useSaveState();

  const persist = async (value: string) => {
    if (!isLanguage(value) || value === i18n.language) return;
    await run(async () => {
      const { language } = await api.setLanguage(value);
      await i18n.changeLanguage(language);
      rememberLanguage(language);
    });
  };

  return (
    <PreferenceRow
      id="settings-language"
      label={t("settings.sections.language.title")}
      description={t("settings.sections.language.description")}
      error={state === "error" ? error : null}
      saving={state === "saving"}
      saved={state === "saved"}
      value={i18n.language}
      onChange={(value) => void persist(value)}
      options={SUPPORTED_LANGUAGES.map((code) => ({
        value: code,
        label: LANGUAGE_LABELS[code],
      }))}
      searchable
    />
  );
}

function timezoneOffset(tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

// Build the expensive timezone list only when Settings needs it.
let timezoneOptionsCache: { value: string; label: string }[] | null = null;

function getTimezoneOptions(): { value: string; label: string }[] {
  if (timezoneOptionsCache) return timezoneOptionsCache;
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [Intl.DateTimeFormat().resolvedOptions().timeZone];
  }
  timezoneOptionsCache = zones.map((tz) => {
    const name = tz.replace(/_/g, " ");
    const offset = timezoneOffset(tz);
    return { value: tz, label: offset ? `${name} (${offset})` : name };
  });
  return timezoneOptionsCache;
}

function TimezoneRow() {
  const { t, i18n } = useTranslation();
  const options = React.useMemo(getTimezoneOptions, []);
  const [timezone, setTimezone] = React.useState<string | null>(null);
  const { state, error, run } = useSaveState();

  React.useEffect(() => {
    api
      .timezone()
      .then((r) => setTimezone(r.timezone))
      .catch(() => {});
  }, []);

  const fallback = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const value = timezone ?? fallback;

  const persist = async (next: string) => {
    if (next === value) return;
    await run(async () => {
      const { timezone: saved } = await api.setTimezone(next);
      setTimezone(saved);
    });
  };

  let localTime = "";
  try {
    localTime = new Intl.DateTimeFormat(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: value,
    }).format(new Date());
  } catch {
    // Some runtimes do not know every IANA zone.
  }

  const description = localTime
    ? `${t("settings.timezone.description")} · ${t("settings.timezone.localTime", { time: localTime })}`
    : t("settings.timezone.description");

  return (
    <PreferenceRow
      id="settings-timezone"
      label={t("settings.timezone.label")}
      description={description}
      error={state === "error" ? error : null}
      saving={state === "saving"}
      saved={state === "saved"}
      value={value}
      onChange={(next) => void persist(next)}
      options={options}
      searchable
    />
  );
}

function QuickActionsRow() {
  const { t } = useTranslation();
  const [mode, setMode] = useQuickActionMode();
  const choices: { value: QuickActionMode; label: string }[] = [
    { value: "send", label: t("settings.sections.quickActions.send") },
    { value: "prefill", label: t("settings.sections.quickActions.prefill") },
  ];

  return (
    <SettingRow
      bare
      label={t("settings.sections.quickActions.title")}
      description={t("settings.sections.quickActions.description")}
      className="rounded-lg px-2 py-2.5"
    >
      <fieldset className="flex w-full min-w-0 rounded-lg border-0 bg-surface-2 p-1 @md:w-auto">
        <legend className="sr-only">{t("settings.sections.quickActions.title")}</legend>
        {choices.map((choice) => {
          const selected = choice.value === mode;
          return (
            <label
              key={choice.value}
              className="relative min-w-0 flex-1 cursor-pointer @md:flex-none"
            >
              <input
                type="radio"
                name="settings-quick-actions"
                value={choice.value}
                checked={selected}
                onChange={() => setMode(choice.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex h-7 items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-2",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {choice.label}
              </span>
            </label>
          );
        })}
      </fieldset>
    </SettingRow>
  );
}

function LaunchAtLoginRow() {
  const { t } = useTranslation();
  const bridge = desktopBridge();
  const [enabled, setEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!bridge) return;
    bridge
      .getLaunchAtLogin()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, [bridge]);

  if (!bridge || enabled === null) return null;

  const toggle = async (next: boolean) => {
    setEnabled(next);
    try {
      setEnabled(await bridge.setLaunchAtLogin(next));
    } catch (err) {
      setEnabled(!next);
      toast.error(err);
    }
  };

  return (
    <SettingRow
      bare
      htmlFor="settings-launch-at-login"
      label={t("settings.launchAtLogin.label")}
      description={t("settings.launchAtLogin.description")}
      className="rounded-lg px-2 py-2.5"
    >
      <Switch
        id="settings-launch-at-login"
        checked={enabled}
        onCheckedChange={(next) => void toggle(next)}
        aria-label={t("settings.launchAtLogin.label")}
      />
    </SettingRow>
  );
}

function ModelPicker({
  connectedIds,
  onSaved,
}: {
  connectedIds: string[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings, error: loadError } = useQuery({
    queryKey: ["llm", "model"],
    queryFn: api.modelSettings,
    meta: { suppressErrorToast: true },
  });
  const [provider, setProvider] = React.useState("");
  const [model, setModel] = React.useState("");
  const { state, error, run } = useSaveState();

  React.useEffect(() => {
    if (settings) {
      setProvider(settings.provider);
      setModel(settings.model);
    }
  }, [settings]);

  if (!settings) {
    return loadError ? <ErrorBanner>{errorMessage(loadError)}</ErrorBanner> : <LoadingRow />;
  }

  const connectedSet = new Set(connectedIds);
  const usable = settings.catalog.filter(
    (c) => c.models.length > 0 && (connectedSet.has(c.id) || c.id === settings.provider),
  );

  if (connectedIds.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("settings.signInFirst")}</p>;
  }

  const activeCatalog = usable.find((c) => c.id === provider);

  const persist = async (nextProvider: string, nextModel: string) => {
    setProvider(nextProvider);
    setModel(nextModel);
    if (!nextModel) return;
    await run(async () => {
      const next = await api.setModel(nextProvider, nextModel);
      queryClient.setQueryData(["llm", "model"], next);
      await onSaved();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-provider">{t("settings.provider")}</Label>
          <Select
            id="settings-provider"
            value={provider}
            onChange={(value) =>
              void persist(value, usable.find((c) => c.id === value)?.models[0]?.id ?? "")
            }
            options={usable.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-model">{t("settings.model")}</Label>
          <Select
            id="settings-model"
            value={model}
            onChange={(value) => void persist(provider, value)}
            options={(activeCatalog?.models ?? []).map((m) => ({ value: m.id, label: m.name }))}
            searchable
          />
        </div>
      </div>
      <div className="flex h-4 items-center justify-end gap-1.5 text-xs text-muted-foreground">
        {state === "saving" ? (
          <>
            <Spinner className="h-3.5 w-3.5" /> {t("common.saving")}
          </>
        ) : state === "error" ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 text-success" />
            <span>
              <Trans
                i18nKey="settings.usingModel"
                values={{ model: settings.model }}
                components={{ model: <span className="font-mono" /> }}
              />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
