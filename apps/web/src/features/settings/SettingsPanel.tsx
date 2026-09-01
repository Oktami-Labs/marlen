import {
  type AppStatus,
  isLanguage,
  LANGUAGE_LABELS,
  type LlmProviderInfo,
  SUPPORTED_LANGUAGES,
} from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  DatabaseBackup,
  Download,
  Info,
  Mail,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { type ThemePref, useTheme } from "@/lib/useTheme";
import { errorMessage } from "@/lib/utils";

export function SettingsPanel({ onStatusChanged }: { onStatusChanged?: () => void }) {
  const { t } = useTranslation();
  const [providers, setProviders] = React.useState<LlmProviderInfo[] | null>(null);
  const [status, setStatus] = React.useState<AppStatus | null>(null);
  const { accounts } = useAccountColors();
  const { status: onOffice } = useOnOfficeStatus();
  const { status: whatsApp } = useWhatsAppStatus();

  const refresh = React.useCallback(async () => {
    try {
      const [nextProviders, nextStatus] = await Promise.all([api.llmProviders(), api.status()]);
      setProviders(nextProviders);
      setStatus(nextStatus);
      onStatusChanged?.();
    } catch (err) {
      toast.error(err);
    }
  }, [onStatusChanged]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

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
    <div className="flex flex-col gap-10 pt-4">
      <Section
        index={0}
        className="animate-in-up"
        icon={<Sparkles />}
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
          <ModelPicker connectedIds={connectedIds} onSaved={refresh} />
        </div>
      </Section>

      <Section
        index={1}
        className="animate-in-up"
        icon={<Mail />}
        title={t("settings.sections.accounts.title")}
        aside={accountsChip}
      >
        <ConnectionsPanel onStatusChanged={() => void refresh()} />
      </Section>

      <FileAccessSection index={2} />

      <Section
        index={3}
        className="animate-in-up"
        icon={<SlidersHorizontal />}
        title={t("settings.sections.preferences.title")}
      >
        <div className="flex flex-col gap-2">
          <AppearanceRow />
          <LanguageRow />
          <TimezoneRow />
          <QuickActionsRow />
          <LaunchAtLoginRow />
        </div>
      </Section>

      <Section
        index={4}
        className="animate-in-up"
        icon={<DatabaseBackup />}
        title={t("settings.sections.data.title")}
      >
        <BackupRow />
      </Section>

      <Section
        index={5}
        className="animate-in-up"
        icon={<Info />}
        title={t("settings.sections.about.title")}
      >
        <AboutPanel />
      </Section>
    </div>
  );
}

function BackupRow() {
  const { t } = useTranslation();
  return (
    <SettingRow label={t("settings.backup.label")} description={t("settings.backup.description")}>
      <Button variant="secondary" size="sm" onClick={() => api.downloadBackup()}>
        <Download />
        {t("settings.backup.cta")}
      </Button>
    </SettingRow>
  );
}

function useSaveState() {
  const [state, setState] = React.useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const run = async (save: () => Promise<void>) => {
    setState("saving");
    setError(null);
    try {
      await save();
      setState("idle");
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
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  searchable?: boolean;
}) {
  return (
    <SettingRow htmlFor={id} label={label} description={description} error={error}>
      {saving && <Spinner className="h-3.5 w-3.5 text-muted-foreground" />}
      <Select
        id={id}
        aria-label={label}
        className="w-40 sm:w-52"
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
      onChange={(value) => setPref(value as ThemePref)}
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

  return (
    <PreferenceRow
      id="settings-quick-actions"
      label={t("settings.sections.quickActions.title")}
      description={t("settings.sections.quickActions.description")}
      value={mode}
      onChange={(value) => setMode(value as QuickActionMode)}
      options={[
        { value: "send", label: t("settings.sections.quickActions.send") },
        { value: "prefill", label: t("settings.sections.quickActions.prefill") },
      ]}
    />
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
      htmlFor="settings-launch-at-login"
      label={t("settings.launchAtLogin.label")}
      description={t("settings.launchAtLogin.description")}
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
      <div className="grid gap-4 sm:grid-cols-2">
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
