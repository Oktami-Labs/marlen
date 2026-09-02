import type { PipedreamStatus } from "@marlen/shared";
import { Check, ExternalLink, X } from "lucide-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { StepCircle } from "@/components/ui/step-circle";
import {
  type ConnectionPresentation,
  ConnectionSurface,
} from "@/features/connections/ConnectionSurface";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { openExternal } from "@/lib/utils";

const GUIDE_STEPS = [
  { key: "setupStep1", url: "https://pipedream.com", labelKey: "openPipedream" },
  { key: "setupStep2", url: "https://pipedream.com/settings/api", labelKey: "openApiSettings" },
  { key: "setupStep3", url: "https://pipedream.com/projects", labelKey: "openProjects" },
] as const;

/** One-time Pipedream project setup, usable in Settings and directly inside chat. */
export function PipedreamWizard({
  status,
  onSaved,
  onClose,
  presentation,
}: {
  status: PipedreamStatus;
  onSaved: () => Promise<void>;
  onClose?: () => void;
  presentation?: ConnectionPresentation;
}) {
  const { t } = useTranslation();
  const formId = React.useId();
  const clientIdInput = `${formId}-client-id`;
  const clientSecretInput = `${formId}-client-secret`;
  const projectInput = `${formId}-project`;
  const [clientId, setClientId] = React.useState(status.clientId ?? "");
  const [clientSecret, setClientSecret] = React.useState("");
  const [project, setProject] = React.useState(status.projectId ?? "");
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const canKeepSecret = status.source === "settings";
  const canSave = Boolean(
    clientId.trim() && project.trim() && (clientSecret.trim() || canKeepSecret),
  );

  const save = async () => {
    setBusy("save");
    try {
      await api.savePipedream({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
        project: project.trim(),
      });
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const removeSaved = async () => {
    setBusy("remove");
    try {
      await api.clearPipedream();
      await onSaved();
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <ConnectionSurface
      presentation={presentation}
      className="@container animate-in-up flex flex-col gap-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t("connections.setupTitle")}</p>
          <p className="text-xs text-muted-foreground">
            <Trans
              i18nKey="connections.setupIntro"
              components={{
                pd: (
                  <a
                    href="https://pipedream.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline"
                  >
                    Pipedream
                  </a>
                ),
              }}
            />
          </p>
        </div>
        {onClose && (
          <IconButton onClick={onClose} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <ol className="flex flex-col gap-2">
        {GUIDE_STEPS.map((step, i) => (
          <li
            key={step.key}
            className="flex flex-col items-stretch gap-2.5 @md:flex-row @md:items-center @md:justify-between"
          >
            <div className="flex items-start gap-2.5 @md:items-center">
              <StepCircle tone="tint-accent">{i + 1}</StepCircle>
              <p className="text-xs text-muted-foreground">{t(`connections.${step.key}`)}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full @md:w-auto @md:shrink-0"
              onClick={() => openExternal(step.url)}
            >
              <ExternalLink /> {t(`connections.${step.labelKey}`)}
            </Button>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-4">
        <FormField id={clientIdInput} label={t("connections.clientId")}>
          <Input
            id={clientIdInput}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="font-mono"
            autoComplete="off"
          />
        </FormField>
        <FormField id={clientSecretInput} label={t("connections.clientSecret")}>
          <Input
            id={clientSecretInput}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={canKeepSecret ? t("connections.clientSecretKeepPlaceholder") : ""}
            className="font-mono"
            autoComplete="off"
          />
        </FormField>
        <FormField id={projectInput} label={t("connections.project")}>
          <Input
            id={projectInput}
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="https://pipedream.com/@…/projects/proj_…  /  proj_…"
            className="font-mono"
            autoComplete="off"
          />
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {status.source === "settings" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRemove(true)}
            disabled={busy !== null}
            loading={busy === "remove"}
          >
            {t("connections.removeSaved")}
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!canSave || busy !== null}
          loading={busy === "save"}
        >
          <Check />
          {t("connections.saveVerify")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t("connections.removeSaved")}
        description={t("connections.removeSavedConfirm")}
        confirmLabel={t("connections.removeSaved")}
        busy={busy === "remove"}
        onConfirm={removeSaved}
      />
    </ConnectionSurface>
  );
}
