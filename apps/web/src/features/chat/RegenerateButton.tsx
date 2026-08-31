import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import { ModelPicker } from "@/features/chat/ModelPicker";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useAnchoredPopover } from "@/lib/useAnchoredPopover";

/**
 * Ask the same question again of a different model. A weak answer is usually
 * the model's, not the question's, so this forks the turn rather than
 * rolling the same dice: picking switches the active model (as the composer's
 * control would) and re-sends.
 */
export function RegenerateButton({ onRegenerate }: { onRegenerate: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { open, setOpen, pos, triggerRef, popoverRef } = useAnchoredPopover<HTMLSpanElement>();
  const { data: settings } = useQuery({ queryKey: ["llm", "model"], queryFn: api.modelSettings });

  if (!settings) return null;

  const pick = async (provider: string, model: string) => {
    setOpen(false);
    if (provider !== settings.provider || model !== settings.model) {
      try {
        queryClient.setQueryData(["llm", "model"], await api.setModel(provider, model));
      } catch (err) {
        toast.error(err);
        return;
      }
    }
    onRegenerate();
  };

  return (
    <span ref={triggerRef} className="inline-flex">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("chat.message.regenerate")}
        aria-expanded={open}
        title={t("chat.message.regenerate")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <RefreshCw />
      </Button>

      {open &&
        createPortal(
          // Portaled content bubbles React synthetic events through the tree;
          // this noninteractive wrapper stops that propagation.
          // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not a control itself
          <div
            ref={popoverRef}
            role="presentation"
            className="surface-pop animate-in-up fixed z-[130] flex w-64 flex-col gap-1 p-3"
            style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <GroupLabel size="sm" className="pb-0.5">
              {t("chat.message.regenerateWith")}
            </GroupLabel>
            <ModelPicker
              settings={settings}
              onPick={(provider, model) => void pick(provider, model)}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}
