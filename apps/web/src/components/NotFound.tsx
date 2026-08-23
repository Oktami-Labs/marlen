import { Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { withViewTransition } from "@/lib/utils";

/**
 * The catch-all route's view. The header states the miss and names the path, so
 * this carries only the explanation and the one way back.
 */
export function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      size="lg"
      className="py-16"
      icon={Compass}
      description={t("notFound.description")}
      action={
        <Button className="mt-2" onClick={() => withViewTransition(() => navigate("/"))}>
          {t("notFound.goHome")}
        </Button>
      }
    />
  );
}
