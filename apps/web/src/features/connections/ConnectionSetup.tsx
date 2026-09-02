import type { ConnectedAccount, PipedreamApp } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Workflow } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { LoadingRow, Notice, RetryableError } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { Input } from "@/components/ui/input";
import { OptionRow } from "@/components/ui/option-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { accountListQuery, isEmailApp } from "@/lib/accounts";
import { api, isPipedreamMissing } from "@/lib/api";
import { toast } from "@/lib/toast";
import { openExternal } from "@/lib/utils";
import { OnOfficeForm, OnOfficePickerButton, useOnOfficeStatus } from "./OnOffice";
import { PipedreamWizard } from "./PipedreamWizard";
import { useWhatsAppStatus, WhatsAppPairingCard, WhatsAppPickerButton } from "./WhatsApp";

const CONNECT_POLL_INTERVAL_MS = 3000;
const CONNECT_WATCH_TIMEOUT_MS = 10 * 60_000;
const ONOFFICE_KEYWORDS = ["onoffice", "crm", "immobilien", "makler", "real estate"];
const WHATSAPP_KEYWORDS = ["whatsapp", "messaging", "nachrichten", "chat", "business", "baileys"];

export interface ConnectionResult {
  kind: "pipedream" | "onoffice" | "whatsapp";
  name: string;
}

type ConnectionStep =
  | { kind: "picker" }
  | { kind: "pipedream" }
  | { kind: "onoffice" }
  | { kind: "whatsapp" }
  | { kind: "waiting"; service: string }
  | { kind: "complete"; result: ConnectionResult };

function matchesNative(query: string, keywords: string[]): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => keywords.some((keyword) => keyword.includes(token)));
}

function initialStep(query: string): ConnectionStep {
  if (query.trim() && matchesNative(query, ONOFFICE_KEYWORDS)) return { kind: "onoffice" };
  const normalized = query.trim().toLowerCase();
  if (normalized.includes("whatsapp") && !normalized.includes("business")) {
    return { kind: "whatsapp" };
  }
  return { kind: "picker" };
}

function matchesConnectedAccount(query: string, account: ConnectedAccount): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searchable = [account.app.replaceAll("_", " "), account.appName, account.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.length > 0 && tokens.every((token) => searchable.includes(token));
}

function PickerRow({
  app,
  busy,
  onConnect,
}: {
  app: PipedreamApp;
  busy: string | null;
  onConnect: (app: PipedreamApp) => void;
}) {
  return (
    <OptionRow
      fill="recessed"
      onClick={() => onConnect(app)}
      disabled={busy !== null}
      icon={<AppIcon src={app.imgSrc} className="h-5 w-5" />}
      label={app.name}
      trailing={
        busy === app.slug ? (
          <Spinner className="shrink-0 text-muted-foreground" />
        ) : (
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )
      }
    />
  );
}

function PickerSkeleton() {
  return [0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />);
}

function PickerSection({
  heading,
  apps,
  busy,
  onConnect,
}: {
  heading: string;
  apps: PipedreamApp[];
  busy: string | null;
  onConnect: (app: PipedreamApp) => void;
}) {
  if (apps.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <GroupLabel as="p" size="sm" className="px-1">
        {heading}
      </GroupLabel>
      {apps.map((app) => (
        <PickerRow key={app.slug} app={app} busy={busy} onConnect={onConnect} />
      ))}
    </div>
  );
}

export function ConnectionSetup({
  initialQuery = "",
  onComplete,
  onContinue,
}: {
  initialQuery?: string;
  onComplete?: (result: ConnectionResult) => void;
  onContinue?: (result: ConnectionResult) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = React.useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = React.useState(initialQuery.trim());
  const [step, setStep] = React.useState<ConnectionStep>(() => initialStep(initialQuery));
  const [busy, setBusy] = React.useState<string | null>(null);
  const completedRef = React.useRef(false);
  const stopWatchRef = React.useRef<(() => void) | null>(null);
  const { status: onOffice, refresh: refreshOnOffice } = useOnOfficeStatus();
  const { status: whatsApp, refresh: refreshWhatsApp } = useWhatsAppStatus();
  const accountsQuery = useQuery(accountListQuery);
  const pipedreamQuery = useQuery({
    queryKey: ["accounts", "pipedream-status"],
    queryFn: () => api.pipedreamStatus(),
  });
  const pipedream = pipedreamQuery.data ?? null;

  React.useEffect(() => {
    if (step.kind !== "picker") return;
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(trimmed), trimmed ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, step.kind]);

  React.useEffect(() => () => stopWatchRef.current?.(), []);

  const appsQuery = useQuery({
    queryKey: ["accounts", "apps", debouncedQuery],
    queryFn: async () => {
      try {
        return await api.pipedreamApps(debouncedQuery);
      } catch (error) {
        if (isPipedreamMissing(error)) return [];
        throw error;
      }
    },
    enabled: step.kind === "picker" && pipedream?.configured === true,
  });
  const results = debouncedQuery === query.trim() ? (appsQuery.data ?? null) : null;

  const finish = React.useCallback(
    (result: ConnectionResult) => {
      if (completedRef.current) return;
      completedRef.current = true;
      setStep({ kind: "complete", result });
      onComplete?.(result);
    },
    [onComplete],
  );

  React.useEffect(() => {
    if (step.kind === "onoffice" && onOffice?.configured) {
      finish({ kind: "onoffice", name: "onOffice" });
    }
    if (step.kind === "whatsapp" && whatsApp?.linked) {
      finish({ kind: "whatsapp", name: "WhatsApp" });
    }
  }, [finish, onOffice?.configured, step.kind, whatsApp?.linked]);

  React.useEffect(() => {
    if (step.kind !== "picker" || !initialQuery.trim() || !accountsQuery.data) return;
    const account = accountsQuery.data.find((candidate) =>
      matchesConnectedAccount(initialQuery, candidate),
    );
    if (account) {
      finish({ kind: "pipedream", name: account.appName || account.name });
    }
  }, [accountsQuery.data, finish, initialQuery, step.kind]);

  const stopWatching = React.useCallback(() => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    setStep({ kind: "picker" });
  }, []);

  const watchForNewAccount = React.useCallback(
    (priorIds: Set<string>, expiresAt: string, service: string) => {
      stopWatchRef.current?.();
      let stopped = false;
      stopWatchRef.current = () => {
        stopped = true;
      };
      const expiry = Date.parse(expiresAt);
      const deadline = Math.min(
        Number.isNaN(expiry) ? Infinity : expiry,
        Date.now() + CONNECT_WATCH_TIMEOUT_MS,
      );
      void (async () => {
        while (!stopped && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, CONNECT_POLL_INTERVAL_MS));
          if (stopped) return;
          const next = await api.pipedreamAccounts().catch(() => null);
          const added = next?.find((account) => !priorIds.has(account.id));
          if (!next || !added) continue;
          const synced = await api.syncPipedreamAccounts().catch(() => null);
          if (!synced) continue;
          stopWatchRef.current = null;
          queryClient.setQueryData(accountListQuery.queryKey, synced);
          if (isEmailApp(added.app)) {
            void api
              .learnAccountVoice(added.id)
              .then(() => toast.success(t("connections.learnVoiceStarted", { name: added.name })))
              .catch((error: unknown) => toast.error(error));
          }
          finish({ kind: "pipedream", name: added.appName || added.name || service });
          return;
        }
        if (!stopped) {
          stopWatchRef.current = null;
          setStep({ kind: "picker" });
          toast.error(t("connections.connectTimedOut"));
        }
      })();
    },
    [finish, queryClient, t],
  );

  const connect = async (app: PipedreamApp) => {
    setBusy(app.slug);
    try {
      const current = accountsQuery.data ?? (await queryClient.fetchQuery(accountListQuery));
      const priorIds = new Set(current.map((account) => account.id));
      const token = await api.pipedreamConnectToken(app.slug);
      openExternal(token.connectLinkUrl);
      setStep({ kind: "waiting", service: app.name });
      watchForNewAccount(priorIds, token.expiresAt, app.name);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(null);
    }
  };

  const completeWhatsApp = React.useCallback(async () => {
    await refreshWhatsApp();
    finish({ kind: "whatsapp", name: "WhatsApp" });
  }, [finish, refreshWhatsApp]);

  if (step.kind === "complete") {
    return (
      <Notice tone="success" className="flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">
              {t("connections.connected", { service: step.result.name })}
            </p>
            <p className="text-xs">{t("connections.connectedHint")}</p>
          </div>
        </div>
        {onContinue && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => onContinue(step.result)}>
              {t("connections.continue")}
            </Button>
          </div>
        )}
      </Notice>
    );
  }

  if (step.kind === "waiting") {
    return (
      <Notice tone="accent" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Spinner className="h-3.5 w-3.5" />
          <p>{t("connections.finishConnecting", { service: step.service })}</p>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={stopWatching}>
            {t("common.cancel")}
          </Button>
        </div>
      </Notice>
    );
  }

  if (step.kind === "onoffice") {
    return onOffice ? (
      <OnOfficeForm
        presentation="embedded"
        status={onOffice}
        onSaved={async () => {
          await refreshOnOffice();
          finish({ kind: "onoffice", name: "onOffice" });
        }}
        onClose={() => setStep({ kind: "picker" })}
      />
    ) : (
      <LoadingRow />
    );
  }

  if (step.kind === "whatsapp") {
    return whatsApp ? (
      <WhatsAppPairingCard
        presentation="embedded"
        status={whatsApp}
        onPaired={completeWhatsApp}
        onClose={() => setStep({ kind: "picker" })}
      />
    ) : (
      <LoadingRow />
    );
  }

  if (pipedreamQuery.isError) {
    return (
      <RetryableError onRetry={() => void pipedreamQuery.refetch()}>
        {pipedreamQuery.error.message}
      </RetryableError>
    );
  }
  if (!pipedream) return <LoadingRow />;

  const showOnOffice =
    onOffice !== null && !onOffice.configured && matchesNative(query, ONOFFICE_KEYWORDS);
  const showWhatsApp =
    whatsApp !== null && !whatsApp.linked && matchesNative(query, WHATSAPP_KEYWORDS);
  const asksForNative = initialStep(query).kind !== "picker";

  if (step.kind === "pipedream" || (!pipedream.configured && query.trim() && !asksForNative)) {
    return (
      <PipedreamWizard
        presentation="embedded"
        status={pipedream}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ["accounts", "pipedream-status"] });
          setStep({ kind: "picker" });
        }}
        onClose={() => {
          setQuery("");
          setStep({ kind: "picker" });
        }}
      />
    );
  }

  const emailResults = (results ?? []).filter((app) => isEmailApp(app.slug));
  const moreResults = (results ?? []).filter((app) => !isEmailApp(app.slug));
  const noResults = query.trim() && results?.length === 0 && !showOnOffice && !showWhatsApp;

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("connections.searchProviders")}
        autoFocus
      />
      {appsQuery.isError && debouncedQuery === query.trim() ? (
        <RetryableError onRetry={() => void appsQuery.refetch()}>
          {appsQuery.error.message}
        </RetryableError>
      ) : noResults ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          {t("connections.noProvidersFound", { q: query.trim() })}
        </p>
      ) : query.trim() ? (
        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto py-0.5">
          {showOnOffice && <OnOfficePickerButton onClick={() => setStep({ kind: "onoffice" })} />}
          {showWhatsApp && <WhatsAppPickerButton onClick={() => setStep({ kind: "whatsapp" })} />}
          {results ? (
            results.map((app) => (
              <PickerRow key={app.slug} app={app} busy={busy} onConnect={connect} />
            ))
          ) : pipedream.configured ? (
            <PickerSkeleton />
          ) : null}
        </div>
      ) : (
        <div className="flex max-h-80 flex-col gap-4 overflow-y-auto py-0.5">
          {pipedream.configured ? (
            results ? (
              <>
                <PickerSection
                  heading={t("connections.suggestedHeading")}
                  apps={emailResults}
                  busy={busy}
                  onConnect={connect}
                />
                <PickerSection
                  heading={t("connections.moreAppsHeading")}
                  apps={moreResults}
                  busy={busy}
                  onConnect={connect}
                />
              </>
            ) : (
              <PickerSkeleton />
            )
          ) : (
            <OptionRow
              fill="recessed"
              onClick={() => setStep({ kind: "pipedream" })}
              icon={<Workflow className="h-5 w-5 shrink-0 text-muted-foreground" />}
              label={t("connections.pipedreamSetupOption")}
              detail={t("connections.pipedreamSetupDetail")}
              trailing={<Plus className="h-4 w-4 shrink-0 text-muted-foreground" />}
            />
          )}
          {showOnOffice && (
            <div className="flex flex-col gap-1.5">
              <GroupLabel as="p" size="sm" className="px-1">
                {t("connections.crmHeading")}
              </GroupLabel>
              <OnOfficePickerButton onClick={() => setStep({ kind: "onoffice" })} />
            </div>
          )}
          {showWhatsApp && (
            <div className="flex flex-col gap-1.5">
              <GroupLabel as="p" size="sm" className="px-1">
                {t("connections.messagingHeading")}
              </GroupLabel>
              <WhatsAppPickerButton onClick={() => setStep({ kind: "whatsapp" })} />
            </div>
          )}
        </div>
      )}
      <p className="px-1 pt-0.5 text-2xs leading-relaxed text-muted-foreground">
        {t("connections.anyAppHint")}
      </p>
    </div>
  );
}
