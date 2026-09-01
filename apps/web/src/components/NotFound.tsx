import { Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { withViewTransition } from "@/lib/utils";

/**
 * The catch-all route's view. Keep the missed path visible so a stale bookmark
 * can be recognized instead of looking like a silent redirect.
 */
export function NotFound() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <EmptyState
      size="lg"
      className="py-16"
      icon={Compass}
      description={t("notFound.description")}
      action={
        <div className="mt-1 flex flex-col items-center gap-4">
          <code className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted-foreground">
            {pathname}
          </code>
          <Button onClick={() => withViewTransition(() => navigate("/"))}>
            {t("notFound.goHome")}
          </Button>
        </div>
      }
    />
  );
}
