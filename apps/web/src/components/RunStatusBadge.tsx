import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

/** Shared status-to-variant mapping for automation and activity run pills.
 *  Used by the Home activity feed and Automations
 *  run list. */
export function RunStatusBadge({ status }: { status: "running" | "success" | "error" }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={status === "success" ? "success" : status === "error" ? "destructive" : "muted"}
    >
      {t(`automations.runStatus.${status}`)}
    </Badge>
  );
}
