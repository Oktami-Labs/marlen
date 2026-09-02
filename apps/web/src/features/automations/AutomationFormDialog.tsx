import type { Automation, RunFeedItem } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { GroupLabel } from "@/components/ui/group-label";
import { Input } from "@/components/ui/input";
import { SettingRow } from "@/components/ui/setting-row";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AutomationRuns } from "@/features/automations/AutomationRuns";
import { ScheduleFields } from "@/features/automations/ScheduleFields";
import {
  initialSchedule,
  scheduleDraftValid,
  scheduleFromDraft,
} from "@/features/automations/schedule";
import { api } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";
import { toast } from "@/lib/toast";

type Fields = Pick<
  Automation,
  "name" | "instruction" | "showInActivity" | "runOnNewMail" | "notifyOnCompletion"
>;

const EMPTY: Fields = {
  name: "",
  instruction: "",
  showInActivity: true,
  runOnNewMail: false,
  notifyOnCompletion: false,
};

/**
 * The automation's settings in a dialog: the task at left, when it runs and
 * its run settings at right, and for a saved automation its run history
 * under those. Saves once, on the footer button.
 */
export function AutomationFormDialog({
  open,
  automation,
  onOpenChange,
}: {
  open: boolean;
  /** Null creates a new automation. */
  automation: Automation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fields, setFields] = React.useState<Fields>(() =>
    automation ? { ...automation } : EMPTY,
  );
  const [schedule, setSchedule] = React.useState(() => initialSchedule(automation));
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const runsQuery = useQuery({
    queryKey: ["runs", "automation", automation?.id],
    queryFn: () => api.automationRuns(automation?.id as string),
    enabled: automation !== null,
    meta: { suppressErrorToast: true },
  });
  const runs: RunFeedItem[] | null = React.useMemo(
    () =>
      runsQuery.data?.map((run) => ({ ...run, automationName: automation?.name ?? null })) ?? null,
    [runsQuery.data, automation?.name],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["automations"] });
  const complete = fields.name.trim() !== "" && fields.instruction.trim() !== "";
  const setField = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    const body = { ...fields, schedule: scheduleFromDraft(schedule) };
    try {
      if (automation) await api.updateAutomation(automation.id, body);
      else await api.createAutomation(body);
      await refresh();
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
      await refresh();
      setSaving(false);
      onOpenChange(false);
      return true;
    } catch (error) {
      toast.error(error);
      setSaving(false);
      return false;
    }
  };

  const openChat = () => {
    onOpenChange(false);
    navigate("/chat");
  };

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
              <Button variant="ghost-danger" onClick={() => setConfirmDelete(true)}>
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
                disabled={!complete || !scheduleDraftValid(schedule)}
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
                value={fields.name}
                onChange={(event) => setField("name", event.target.value)}
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
                value={fields.instruction}
                onChange={(event) => setField("instruction", event.target.value)}
                placeholder={t("automations.instructionPlaceholder")}
                rows={14}
                className="min-h-64 flex-1 resize-none md:min-h-0"
              />
            </FormField>
          </section>

          <div className="flex flex-col gap-6 md:min-h-0 md:overflow-y-auto md:pr-1">
            <section className="flex flex-col gap-3">
              <GroupLabel>{t("automations.timingSection")}</GroupLabel>
              <ScheduleFields
                draft={schedule}
                onChange={setSchedule}
                nextRunAt={automation?.enabled ? automation.nextRunAt : null}
              />
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
                    checked={fields.showInActivity}
                    onCheckedChange={(value) => setField("showInActivity", value)}
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
                    checked={fields.runOnNewMail}
                    onCheckedChange={(value) => setField("runOnNewMail", value)}
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
                    checked={fields.notifyOnCompletion}
                    onCheckedChange={(value) => {
                      if (
                        value &&
                        !desktopBridge() &&
                        "Notification" in window &&
                        Notification.permission === "default"
                      ) {
                        void Notification.requestPermission();
                      }
                      setField("notifyOnCompletion", value);
                    }}
                  />
                </SettingRow>
              </div>
            </section>

            {automation && (
              <AutomationRuns
                runs={runs}
                error={runsQuery.error}
                onRetry={() => void runsQuery.refetch()}
                onOpenChat={openChat}
              />
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("automations.delete")}
        description={t("automations.deleteConfirm", { name: fields.name })}
        confirmLabel={t("automations.delete")}
        busy={saving}
        onConfirm={remove}
      />
    </>
  );
}
