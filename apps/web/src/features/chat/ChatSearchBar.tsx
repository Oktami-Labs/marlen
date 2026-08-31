import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";

/**
 * Find inside the open conversation, from the chat header: the query, which
 * hit it sits on, and the step to the next one. The transcript does the
 * matching and reports how many it found; Enter walks forward, Shift+Enter
 * back, Escape closes.
 */
export function ChatSearchBar({
  query,
  hit,
  hits,
  onQueryChange,
  onHitChange,
  onClose,
}: {
  query: string;
  hit: number;
  hits: number;
  onQueryChange: (next: string) => void;
  onHitChange: (next: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The transcript changes under a standing search (a reply lands, a
  // conversation is switched), so the index is only ever trusted this far.
  const current = hits === 0 ? 0 : Math.min(hit, hits - 1);
  const step = (delta: number) => {
    if (hits > 0) onHitChange((current + delta + hits) % hits);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <SearchField
        value={query}
        onChange={onQueryChange}
        placeholder={t("chat.search.placeholder")}
        className="min-w-0 flex-1 sm:max-w-72"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key !== "Enter") return;
          e.preventDefault();
          step(e.shiftKey ? -1 : 1);
        }}
      />
      {query.trim() && (
        <span className="shrink-0 px-1 text-2xs tabular-nums text-muted-foreground">
          {hits === 0 ? t("chat.search.noHits") : `${current + 1}/${hits}`}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(-1)}
        disabled={hits === 0}
        aria-label={t("chat.search.previous")}
        title={t("chat.search.previous")}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(1)}
        disabled={hits === 0}
        aria-label={t("chat.search.next")}
        title={t("chat.search.next")}
      >
        <ChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label={t("chat.search.close")}
        title={t("chat.search.close")}
      >
        <X />
      </Button>
    </div>
  );
}
