import {
  type AccountColor,
  type ConnectedAccount,
  EMAIL_APP_LABELS,
  type EmailApp,
  type PipedreamApp,
} from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, LogOut, Plus, Settings } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { RetryableError } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { OptionRow } from "@/components/ui/option-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  AccountPermissionsEditor,
  type PermissionGrants,
  READ_ONLY_GRANTS,
} from "@/features/connections/AccountPermissions";
import {
  OnOfficeAccountRow,
  OnOfficeForm,
  OnOfficePermissionsEditor,
  OnOfficePickerButton,
  useOnOfficeStatus,
} from "@/features/connections/OnOffice";
import { SignatureEditor } from "@/features/connections/SignatureEditor";
import { VoiceLearnBadge } from "@/features/connections/VoiceLearnBadge";
import {
  useWhatsAppStatus,
  WhatsAppAccountRow,
  WhatsAppBusinessRow,
  WhatsAppPairingCard,
  WhatsAppPermissionsEditor,
  WhatsAppPickerButton,
} from "@/features/connections/WhatsApp";
import {
  accountColorsQuery,
  accountListQuery,
  accountPermissionsQuery,
  isEmailApp,
} from "@/lib/accounts";
import { api, isPipedreamMissing } from "@/lib/api";
import { toast } from "@/lib/toast";
import { stagger, UNASSIGNED_ACCOUNT_COLOR } from "@/lib/utils";

const CONNECT_POLL_INTERVAL_MS = 3000;
const CONNECT_WATCH_TIMEOUT_MS = 10 * 60_000;

function PickerRow({
  app,
  busy,
  onConnect,
}: {
  app: PipedreamApp;
  busy: string | null;
  onConnect: (slug: string) => void;
}) {
  return (
    <OptionRow
      fill="recessed"
      onClick={() => onConnect(app.slug)}
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
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-11 w-full rounded-lg" />
      ))}
    </>
  );
}

function matchesNative(query: string, keywords: string[]): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => keywords.some((keyword) => keyword.includes(token)));
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
  onConnect: (slug: string) => void;
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

function appLabel(account: ConnectedAccount): string {
  if (account.appName) return account.appName;
  const known = EMAIL_APP_LABELS[account.app as EmailApp];
  if (known) return known;
  return account.app
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function generateTonalHex(index: number): string {
  // The golden angle avoids adjacent colors clustering together.
  const hue = (index * 137.5) % 360;
  const s = 0.7;
  const l = 0.65;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function Accounts({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accountsQuery = useQuery(accountListQuery);
  const colorsQuery = useQuery(accountColorsQuery);
  const permissionsQuery = useQuery(accountPermissionsQuery);
  const accounts = accountsQuery.data ?? null;
  const [colorDraft, setColorDraft] = React.useState<AccountColor[] | null>(null);
  const colors = colorDraft ?? colorsQuery.data ?? [];
  const permissions = permissionsQuery.data ?? null;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [permissionsAccountId, setPermissionsAccountId] = React.useState<string | null>(null);
  const [onOfficePermsOpen, setOnOfficePermsOpen] = React.useState(false);
  const { status: onOffice, refresh: refreshOnOffice } = useOnOfficeStatus();
  const [onOfficeFormOpen, setOnOfficeFormOpen] = React.useState(false);
  const { status: whatsApp, refresh: refreshWhatsApp } = useWhatsAppStatus();
  const [whatsAppPairingOpen, setWhatsAppPairingOpen] = React.useState(false);
  const [whatsAppPermsOpen, setWhatsAppPermsOpen] = React.useState(false);

  React.useEffect(() => {
    if (!pickerOpen) return;
    const q = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(q), q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, pickerOpen]);

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
    enabled: pickerOpen,
  });
  const results = debouncedQuery === query.trim() ? (appsQuery.data ?? null) : null;

  const ensureColors = React.useCallback(
    async (accts: ConnectedAccount[], existing: AccountColor[]) => {
      const missing = accts.filter((a) => !existing.some((c) => c.accountId === a.id));
      if (missing.length === 0) return;

      let idx = existing.length;

      const additions: AccountColor[] = missing.map((a) => {
        const hex = generateTonalHex(idx);
        idx++;
        return { accountId: a.id, hex };
      });

      const merged = [...existing, ...additions];
      queryClient.setQueryData(accountColorsQuery.queryKey, merged);
      try {
        const { colors: saved } = await api.setAccountColors(merged);
        queryClient.setQueryData(accountColorsQuery.queryKey, saved);
      } catch (error) {
        toast.error(error);
        await queryClient.invalidateQueries({ queryKey: accountColorsQuery.queryKey });
      }
    },
    [queryClient],
  );

  const grantsFor = (accountId: string): PermissionGrants =>
    permissions?.find((p) => p.accountId === accountId) ?? READ_ONLY_GRANTS;

  const persistPermissions = async (accountId: string, next: PermissionGrants) => {
    if (!permissions) throw new Error(t("connections.permissions.notLoaded"));
    const merged = [
      ...permissions.filter((p) => p.accountId !== accountId),
      { accountId, ...next },
    ];
    const { permissions: saved } = await api.setAccountPermissions(merged);
    queryClient.setQueryData(accountPermissionsQuery.queryKey, saved);
  };

  React.useEffect(() => {
    if (accountsQuery.data && colorsQuery.data) {
      void ensureColors(accountsQuery.data, colorsQuery.data);
    }
  }, [accountsQuery.data, colorsQuery.data, ensureColors]);

  const stopWatchRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => stopWatchRef.current?.(), []);

  // The external connect page cannot signal back, so poll for the new account.
  const watchForNewAccount = (priorIds: Set<string>, expiresAt: string) => {
    stopWatchRef.current?.();
    let stopped = false;
    stopWatchRef.current = () => {
      stopped = true;
      setConnecting(false);
    };
    const expiry = Date.parse(expiresAt);
    const deadline = Math.min(
      Number.isNaN(expiry) ? Infinity : expiry,
      Date.now() + CONNECT_WATCH_TIMEOUT_MS,
    );
    void (async () => {
      while (!stopped && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, CONNECT_POLL_INTERVAL_MS));
        if (stopped) return;
        const next = await api.pipedreamAccounts().catch(() => null);
        if (!next) continue;
        queryClient.setQueryData(accountListQuery.queryKey, next);
        const added = next.find((a) => !priorIds.has(a.id));
        if (!added) continue;
        stopWatchRef.current = null;
        setConnecting(false);
        void queryClient
          .fetchQuery(accountColorsQuery)
          .then((saved) => ensureColors(next, saved))
          .catch(() => {});
        if (isEmailApp(added.app)) {
          void api
            .learnAccountVoice(added.id)
            .then(() => toast.success(t("connections.learnVoiceStarted", { name: added.name })))
            .catch((err: unknown) => toast.error(err));
        }
        onChanged?.();
        return;
      }
      if (!stopped) {
        stopWatchRef.current = null;
        setConnecting(false);
      }
    })();
  };

  const connect = async (app: string) => {
    setBusy(app);
    const priorIds = new Set((accounts ?? []).map((a) => a.id));
    try {
      const token = await api.pipedreamConnectToken(app);
      // Provider sessions live in the user's browser, not the desktop webview.
      window.open(token.connectLinkUrl, "_blank", "noopener");
      setPickerOpen(false);
      setQuery("");
      setConnecting(true);
      watchForNewAccount(priorIds, token.expiresAt);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setRemoving(true);
    try {
      await api.deletePipedreamAccount(id);
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onChanged?.();
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setRemoving(false);
    }
  };

  // Serialize debounced color writes so an older response cannot win.
  const colorPersistRef = React.useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    saving: boolean;
    pending: AccountColor[] | null;
  }>({ timer: null, saving: false, pending: null });

  React.useEffect(
    () => () => {
      const timer = colorPersistRef.current.timer;
      if (timer) clearTimeout(timer);
    },
    [],
  );

  const flushColorPersist = async () => {
    const state = colorPersistRef.current;
    if (state.saving || !state.pending) return;
    const next = state.pending;
    state.pending = null;
    state.saving = true;
    try {
      const { colors: saved } = await api.setAccountColors(next);
      if (!state.pending) {
        queryClient.setQueryData(accountColorsQuery.queryKey, saved);
        setColorDraft(null);
      }
    } catch (err) {
      toast.error(err);
      if (!state.pending) {
        setColorDraft(null);
        void queryClient.invalidateQueries({ queryKey: accountColorsQuery.queryKey });
      }
    } finally {
      state.saving = false;
      if (state.pending) void flushColorPersist();
    }
  };

  const updateColor = (accountId: string, hex: string) => {
    const next = colors.filter((c) => c.accountId !== accountId);
    next.push({ accountId, hex });
    setColorDraft(next);
    queryClient.setQueryData(accountColorsQuery.queryKey, next);

    const state = colorPersistRef.current;
    state.pending = next;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void flushColorPersist();
    }, 300);
  };

  const colorFor = (accountId: string): AccountColor | undefined =>
    colors.find((c) => c.accountId === accountId);

  const emailResults = (results ?? []).filter((a) => isEmailApp(a.slug));
  const moreResults = (results ?? []).filter((a) => !isEmailApp(a.slug));

  const accountGroups = (() => {
    const byApp = new Map<string, ConnectedAccount[]>();
    for (const account of accounts ?? []) {
      const label = appLabel(account);
      const group = byApp.get(label);
      if (group) group.push(account);
      else byApp.set(label, [account]);
    }
    return [...byApp.entries()];
  })();

  const showOnOfficePick =
    onOffice !== null &&
    !onOffice.configured &&
    matchesNative(query, ["onoffice", "crm", "immobilien", "makler", "real estate"]);

  const openOnOfficeForm = () => {
    setPickerOpen(false);
    setQuery("");
    setOnOfficeFormOpen(true);
  };

  const showWhatsAppPick =
    whatsApp !== null &&
    !whatsApp.linked &&
    matchesNative(query, ["whatsapp", "messaging", "nachrichten", "chat", "business", "baileys"]);

  const openWhatsAppPairing = () => {
    setPickerOpen(false);
    setQuery("");
    setWhatsAppPairingOpen(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4 pb-2">
          <h3 className="text-sm font-semibold tracking-tight">{t("connections.emailAccounts")}</h3>
          <Button size="sm" onClick={() => setPickerOpen((open) => !open)} loading={busy !== null}>
            <Plus />
            {t("connections.addAccount")}
          </Button>
        </div>

        {pickerOpen && (
          <Card padding="sm" className="flex flex-col gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("connections.searchProviders")}
              autoFocus
            />
            {appsQuery.isError && debouncedQuery === query.trim() ? (
              <RetryableError onRetry={() => void appsQuery.refetch()}>
                {appsQuery.error.message}
              </RetryableError>
            ) : query.trim() ? (
              results?.length === 0 && !showOnOfficePick && !showWhatsAppPick ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {t("connections.noProvidersFound", { q: query.trim() })}
                </p>
              ) : (
                <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto py-0.5">
                  {showOnOfficePick && <OnOfficePickerButton onClick={openOnOfficeForm} />}
                  {showWhatsAppPick && <WhatsAppPickerButton onClick={openWhatsAppPairing} />}
                  {results ? (
                    results.map((app) => (
                      <PickerRow key={app.slug} app={app} busy={busy} onConnect={connect} />
                    ))
                  ) : (
                    <PickerSkeleton />
                  )}
                </div>
              )
            ) : !results ? (
              <div className="flex flex-col gap-1.5 py-0.5">
                <PickerSkeleton />
              </div>
            ) : (
              <div className="flex max-h-80 flex-col gap-4 overflow-y-auto py-0.5">
                <PickerSection
                  heading={t("connections.suggestedHeading")}
                  apps={emailResults}
                  busy={busy}
                  onConnect={connect}
                />
                {showOnOfficePick && (
                  <div className="flex flex-col gap-1.5">
                    <GroupLabel as="p" size="sm" className="px-1">
                      {t("connections.crmHeading")}
                    </GroupLabel>
                    <OnOfficePickerButton onClick={openOnOfficeForm} />
                  </div>
                )}
                {showWhatsAppPick && (
                  <div className="flex flex-col gap-1.5">
                    <GroupLabel as="p" size="sm" className="px-1">
                      {t("connections.messagingHeading")}
                    </GroupLabel>
                    <WhatsAppPickerButton onClick={openWhatsAppPairing} />
                  </div>
                )}
                {moreResults.length > 0 && (
                  <PickerSection
                    heading={t("connections.moreAppsHeading")}
                    apps={moreResults}
                    busy={busy}
                    onConnect={connect}
                  />
                )}
              </div>
            )}
            <p className="px-1 pt-0.5 text-2xs leading-relaxed text-muted-foreground">
              {t("connections.anyAppHint")}
            </p>
          </Card>
        )}

        {connecting && (
          <div className="flex items-center gap-2">
            <Spinner className="h-3 w-3 shrink-0" />
            <p className="text-xs text-muted-foreground">{t("connections.finishConnecting")}</p>
            <Button variant="ghost" size="sm" onClick={() => stopWatchRef.current?.()}>
              {t("common.cancel")}
            </Button>
          </div>
        )}

        {onOfficeFormOpen && onOffice && (
          <OnOfficeForm
            status={onOffice}
            onSaved={async () => {
              setOnOfficeFormOpen(false);
              await refreshOnOffice();
              onChanged?.();
            }}
            onClose={() => setOnOfficeFormOpen(false)}
          />
        )}

        {whatsAppPairingOpen && whatsApp && (
          <WhatsAppPairingCard
            status={whatsApp}
            onPaired={async () => {
              setWhatsAppPairingOpen(false);
              toast.success(t("whatsapp.pairedToast"));
              await refreshWhatsApp();
              onChanged?.();
            }}
            onClose={() => setWhatsAppPairingOpen(false)}
          />
        )}

        {!accounts ? (
          accountsQuery.isError ? (
            <RetryableError onRetry={() => void accountsQuery.refetch()}>
              {accountsQuery.error.message}
            </RetryableError>
          ) : (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <ListRow key={i}>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </ListRow>
              ))}
            </div>
          )
        ) : accounts.length === 0 && !onOffice?.configured && !whatsApp?.linked ? (
          <EmptyState icon={Inbox} description={t("connections.noAccounts")} />
        ) : (
          <div className="flex flex-col gap-4">
            {accountGroups.map(([label, groupAccounts]) => (
              <div key={label} className="flex flex-col gap-1.5">
                <GroupLabel as="p" size="sm" className="px-1">
                  {label}
                </GroupLabel>
                {groupAccounts.map((account) => {
                  const flat = accounts.indexOf(account);
                  return (
                    <div
                      key={account.id}
                      className="animate-in-up flex flex-col gap-1.5"
                      style={{ ...stagger(flat), zIndex: accounts.length - flat }}
                    >
                      <ListRow className="relative">
                        <div className="flex min-w-0 items-center gap-3">
                          {colorsQuery.data ? (
                            <ColorPicker
                              color={colorFor(account.id)?.hex ?? UNASSIGNED_ACCOUNT_COLOR}
                              onSelect={(hex) => updateColor(account.id, hex)}
                            />
                          ) : (
                            <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
                          )}
                          <AppIcon src={account.imgSrc} />
                          <p className="min-w-0 truncate text-sm font-medium">{account.name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <VoiceLearnBadge account={account} />
                          {!account.healthy && (
                            <Badge variant="destructive">{t("connections.unhealthy")}</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={!permissions}
                            onClick={() =>
                              setPermissionsAccountId((id) =>
                                id === account.id ? null : account.id,
                              )
                            }
                            aria-label={
                              isEmailApp(account.app)
                                ? t("connections.permissions.editEmail")
                                : t("connections.permissions.edit")
                            }
                            data-tooltip={
                              isEmailApp(account.app)
                                ? t("connections.permissions.editEmail")
                                : t("connections.permissions.edit")
                            }
                          >
                            <Settings />
                          </Button>
                          <Button
                            variant="ghost-danger"
                            size="icon-sm"
                            onClick={() => setConfirmId(account.id)}
                            aria-label={t("connections.disconnect")}
                            data-tooltip={t("connections.disconnect")}
                          >
                            <LogOut />
                          </Button>
                        </div>
                      </ListRow>
                      {permissionsAccountId === account.id && (
                        <>
                          <AccountPermissionsEditor
                            account={account}
                            granted={grantsFor(account.id)}
                            onPersist={(next) => persistPermissions(account.id, next)}
                          />
                          {isEmailApp(account.app) && <SignatureEditor accountId={account.id} />}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {onOffice?.configured && (
              <div className="flex flex-col gap-1.5">
                <GroupLabel as="p" size="sm" className="px-1">
                  {t("connections.crmHeading")}
                </GroupLabel>
                <div className="animate-in-up flex flex-col gap-1.5">
                  <OnOfficeAccountRow
                    status={onOffice}
                    onTogglePermissions={() => setOnOfficePermsOpen((open) => !open)}
                    onDisconnected={async () => {
                      await refreshOnOffice();
                      onChanged?.();
                    }}
                  />
                  {onOfficePermsOpen && (
                    <>
                      {/* Credentials live behind the same gear as the grants, so
                          the row carries one settings action like every other. */}
                      {onOffice.source === "settings" && (
                        <OnOfficeForm
                          status={onOffice}
                          onSaved={async () => {
                            await refreshOnOffice();
                            onChanged?.();
                          }}
                        />
                      )}
                      <OnOfficePermissionsEditor status={onOffice} onChanged={refreshOnOffice} />
                    </>
                  )}
                </div>
              </div>
            )}
            {whatsApp && (whatsApp.linked || whatsApp.business.connected) && (
              <div className="flex flex-col gap-1.5">
                <GroupLabel as="p" size="sm" className="px-1">
                  {t("connections.messagingHeading")}
                </GroupLabel>
                <div className="animate-in-up flex flex-col gap-1.5">
                  {/* Both transports get their own row when both exist: the
                      Business account is otherwise invisible here, and its
                      generic row further up is not where anyone looks for it. */}
                  {whatsApp.linked && (
                    <WhatsAppAccountRow
                      status={whatsApp}
                      onTogglePermissions={() => setWhatsAppPermsOpen((open) => !open)}
                      onUnlinked={async () => {
                        await refreshWhatsApp();
                        onChanged?.();
                      }}
                    />
                  )}
                  {whatsApp.business.connected && (
                    <WhatsAppBusinessRow
                      status={whatsApp}
                      onTogglePermissions={() => setWhatsAppPermsOpen((open) => !open)}
                      onDisconnected={async () => {
                        await Promise.all([
                          refreshWhatsApp(),
                          queryClient.invalidateQueries({ queryKey: accountListQuery.queryKey }),
                        ]);
                        onChanged?.();
                      }}
                    />
                  )}
                  {whatsAppPermsOpen && (
                    <WhatsAppPermissionsEditor status={whatsApp} onChanged={refreshWhatsApp} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(next) => !next && setConfirmId(null)}
        title={t("connections.disconnect")}
        description={t("connections.disconnectConfirm")}
        confirmLabel={t("connections.disconnect")}
        busy={removing}
        onConfirm={() => (confirmId ? remove(confirmId) : false)}
      />
    </div>
  );
}
