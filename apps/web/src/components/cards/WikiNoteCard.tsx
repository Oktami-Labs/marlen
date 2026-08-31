import type { AgentCard } from "@marlen/shared";
import { BookMarked, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type WikiNoteData = Extract<AgentCard, { kind: "wiki_note" }>;

/**
 * What the agent just committed to its wiki, shown at the moment it writes it
 * rather than only on the Knowledge page later: a page written mid-turn rides
 * every future system prompt, so the user gets to see it and throw it out
 * right here. Deliberately a chip, not a CardShell block: this is a note about
 * the turn, not a work product of it.
 */
export function WikiNoteCard({ card }: { card: WikiNoteData }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = React.useState(false);
  const [showDiff, setShowDiff] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleted, setDeleted] = React.useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deletePage(card.pageId);
      setDeleted(true);
      setConfirming(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="animate-in-up flex flex-col gap-1.5 rounded-xl bg-surface-2 px-3 py-2">
      <div className="group flex items-center gap-2">
        <BookMarked className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-mono text-3xs uppercase tracking-[0.12em] text-muted-foreground">
          {deleted
            ? t("chat.cards.wikiNote.discarded")
            : card.updated
              ? t("chat.cards.wikiNote.updated")
              : t("chat.cards.wikiNote.saved")}
        </span>
        {deleted ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground line-through">
            {card.summary}
          </span>
        ) : (
          <Link
            to={`/knowledge?focus=wiki:${encodeURIComponent(card.pageId)}`}
            className="min-w-0 flex-1 truncate text-xs hover:text-accent"
            title={card.summary}
          >
            {card.summary}
          </Link>
        )}
        {!deleted && (
          <Button
            type="button"
            variant="ghost-danger"
            size="icon-xs"
            className="shrink-0"
            onClick={() => setConfirming(true)}
            aria-label={t("chat.cards.wikiNote.discard")}
            title={t("chat.cards.wikiNote.discard")}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {/* A rewrite is the one case where the summary alone hides what happened:
          the change list says what the page gained and lost. */}
      {card.diff && card.diff.rows.length > 0 && !deleted && (
        <div className="flex flex-col gap-1">
          <DisclosureToggle open={showDiff} onToggle={() => setShowDiff((open) => !open)}>
            {t("chat.cards.wikiNote.changes", {
              added: card.diff.added,
              removed: card.diff.removed,
            })}
          </DisclosureToggle>
          {showDiff && (
            <ul className="flex flex-col gap-0.5 pb-1">
              {card.diff.rows.map((row, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional and never reorder
                  key={i}
                  className={cn(
                    "rounded px-2 py-0.5 font-mono text-2xs leading-relaxed",
                    row.op === "+" ? "tint-success" : "tint-danger line-through",
                  )}
                >
                  {row.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("chat.cards.wikiNote.discardTitle")}
        description={card.summary}
        confirmLabel={t("chat.cards.wikiNote.discard")}
        busy={deleting}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
