import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { SettingRow } from "@/components/ui/setting-row";
import { Switch } from "@/components/ui/switch";
import { Accounts } from "@/features/connections/Accounts";
import { PipedreamWizard } from "@/features/connections/PipedreamWizard";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { stagger } from "@/lib/utils";

export function ConnectionsPanel({ onStatusChanged }: { onStatusChanged?: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["accounts", "pipedream-status"],
    queryFn: () => api.pipedreamStatus(),
  });
  const status = statusQuery.data ?? null;
  const [editing, setEditing] = React.useState(false);
  // Plumbing is collapsed by default once accounts are connected, the toggle
  // and project credentials matter far less often than the account list.
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["accounts", "pipedream-status"] });
  }, [queryClient]);

  const afterChange = React.useCallback(async () => {
    setEditing(false);
    await refresh();
    onStatusChanged?.();
  }, [refresh, onStatusChanged]);

  const toggleMode = async (useCustom: boolean) => {
    try {
      const next = await api.setPipedreamMode(useCustom);
      queryClient.setQueryData(["accounts", "pipedream-status"], next);
      onStatusChanged?.();
    } catch (err) {
      toast.error(err);
    }
  };

  if (!status) {
    return statusQuery.error ? (
      <RetryableError onRetry={() => void statusQuery.refetch()}>
        {statusQuery.error.message}
      </RetryableError>
    ) : (
      <LoadingRow />
    );
  }

  const custom = status.mode === "custom" || !status.builtinAvailable;

  // The custom-project toggle + its wizard/footer row: the only thing that
  // matters during first-time setup, tucked under "Advanced" once an account
  // is connected. Same JSX either way, just relocated by `status.configured`.
  const modeToggle = (
    <SettingRow
      htmlFor="pd-custom-toggle"
      label={t("connections.customToggle")}
      description={
        custom
          ? t("connections.customToggleOn")
          : status.builtinAvailable
            ? t("connections.builtinInUse")
            : t("connections.builtinMissing")
      }
      className="animate-in-up py-2.5"
    >
      <Switch
        id="pd-custom-toggle"
        checked={custom}
        onCheckedChange={(next) => void toggleMode(next)}
      />
    </SettingRow>
  );

  const projectPanel = custom && (
    <div className="animate-in-up" style={stagger(1)}>
      {!status.configured || editing ? (
        <PipedreamWizard
          status={status}
          onSaved={afterChange}
          onClose={status.configured ? () => setEditing(false) : undefined}
        />
      ) : (
        <ListRow className="py-2.5">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">
              <Trans
                i18nKey="connections.projectFooter"
                values={{
                  projectId: status.projectId,
                  environment: status.environment,
                  source:
                    status.source === "env"
                      ? t("connections.sourceEnv")
                      : t("connections.sourceSettings"),
                }}
                components={{ code: <span className="font-mono" /> }}
              />
            </p>
          </div>
          <IconButton onClick={() => setEditing(true)} aria-label={t("connections.edit")}>
            <Pencil className="h-4 w-4" />
          </IconButton>
        </ListRow>
      )}
    </div>
  );

  // The accounts list carries the native onOffice and WhatsApp connections too,
  // which need no Pipedream project, so it renders either way. Only where the
  // Pipedream plumbing sits moves: front and centre until a project exists,
  // tucked under "Advanced" once one does.
  const accountsList = (
    <div className="animate-in-up" style={stagger(0)}>
      <Accounts onChanged={onStatusChanged} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {status.configured ? (
        <>
          {accountsList}
          <div className="animate-in-up" style={stagger(1)}>
            <DisclosureToggle
              open={advancedOpen}
              onToggle={() => setAdvancedOpen((open) => !open)}
              className="w-full py-1.5"
            >
              <span>{t("connections.advanced")}</span>
              <span aria-hidden="true">·</span>
              <span>
                {custom ? t("connections.advancedCustom") : t("connections.advancedBuiltin")}
              </span>
            </DisclosureToggle>
            {advancedOpen && (
              <div className="mt-3 flex flex-col gap-4">
                {status.builtinAvailable && modeToggle}
                {projectPanel}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {status.builtinAvailable && modeToggle}
          {projectPanel}
          {accountsList}
        </>
      )}
    </div>
  );
}
