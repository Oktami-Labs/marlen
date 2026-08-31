import type { ModelSettings } from "@marlen/shared";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { OptionRow } from "@/components/ui/option-row";
import { api } from "@/lib/api";

/**
 * The model list, shared by the composer's model control and the regenerate
 * menu: connected providers only (never dropping the active one from under
 * its own value), grouped by provider when there is more than one.
 */
export function ModelPicker({
  settings,
  onPick,
}: {
  settings: ModelSettings;
  onPick: (provider: string, model: string) => void;
}) {
  const { t } = useTranslation();
  const { data: providers } = useQuery({
    queryKey: ["llm", "providers"],
    queryFn: api.llmProviders,
  });

  const connected = new Set((providers ?? []).filter((p) => p.auth !== null).map((p) => p.id));
  const usable = settings.catalog.filter(
    (c) => c.models.length > 0 && (connected.has(c.id) || c.id === settings.provider),
  );

  if (usable.length === 0) {
    return <p className="px-1 py-1 text-xs text-muted-foreground">{t("chat.model.noProviders")}</p>;
  }

  return (
    <div className="flex max-h-48 flex-col overflow-y-auto">
      {usable.map((catalog) => (
        <React.Fragment key={catalog.id}>
          {usable.length > 1 && (
            <p className="px-1 pt-1 pb-0.5 text-2xs text-muted-foreground">{catalog.name}</p>
          )}
          {catalog.models.map((model) => (
            <OptionRow
              key={model.id}
              selected={catalog.id === settings.provider && model.id === settings.model}
              label={model.name}
              title={model.id}
              onClick={() => onPick(catalog.id, model.id)}
              className="shrink-0 py-1.5"
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
