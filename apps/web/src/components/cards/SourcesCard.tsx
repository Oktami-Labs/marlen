import type { AgentCard } from "@marlen/shared";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OpenExternalButton } from "@/components/ui/open-external-button";
import { openExternal, stagger } from "@/lib/utils";
import { CardShell } from "./CardShell";

type SourcesData = Extract<AgentCard, { kind: "sources" }>;

/** Host without "www.", the part of a URL that says who is talking. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * What a web-search answer stands on: the results the agent actually read,
 * in the order it read them, each one open-able. Sources are the only way to
 * check an answer drawn from outside the mailbox, so they stay with the turn
 * rather than living in the tool's collapsed output.
 */
export function SourcesCard({ card }: { card: SourcesData }) {
  const { t } = useTranslation();
  return (
    <CardShell
      icon={Globe}
      label={t("chat.cards.sources.badge")}
      meta={String(card.items.length)}
      title={card.query}
    >
      <ul className="flex flex-col px-2 pb-2">
        {card.items.map((item, i) => (
          <li key={item.url} className="animate-in-up" style={stagger(i)}>
            {/* The whole row opens the source; the trailing button is the
                visible affordance for it. */}
            <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <button
                type="button"
                onClick={() => openExternal(item.url)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-xs font-medium">{item.title}</span>
                <span className="block truncate font-mono text-2xs text-muted-foreground">
                  {domainOf(item.url)}
                  {item.age && ` · ${item.age}`}
                </span>
              </button>
              <OpenExternalButton
                url={item.url}
                label={t("chat.cards.sources.open")}
                className="shrink-0"
              />
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
