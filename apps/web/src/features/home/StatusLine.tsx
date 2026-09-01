import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { dayTimeLabel } from "@/lib/dates";

/**
 * Where things stand, in Marlene's own voice: how much waits on the user, how
 * much the agent still does itself, and the newest briefing's headline. The
 * counts are counted, never generated, and the headline is the briefing's
 * own, so the sentence cannot claim work that did not happen. It is the one
 * place on Home that carries numbers; the sections below it do not repeat them.
 */
export function StatusLine({
  needsYou,
  mine,
  briefing,
  onOpenBriefing,
}: {
  /** Approvals and open todos: everything the user has to decide, dated or not. */
  needsYou: number;
  /** Runs in flight or due soon, the agent's own remaining work. */
  mine: number;
  /** The newest run that composed a briefing; absent when none did. */
  briefing?: { name: string; startedAt: string; headline: string } | null;
  /** Unfolds that briefing's row in the work column and scrolls it into view. */
  onOpenBriefing?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const hour = new Date().getHours();
  const greeting = t(
    hour < 11 ? "home.greetingMorning" : hour < 18 ? "home.greetingDay" : "home.greetingEvening",
  );

  return (
    <Card
      as="section"
      padding="lg"
      className="animate-in-up flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <span className="bubble-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent-foreground">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <p className="min-w-0 flex-1 basis-64 text-sm">
        {greeting}{" "}
        <span
          key={`needs-${needsYou}`}
          className={
            needsYou > 0 ? "count-tick inline-block font-medium" : "count-tick inline-block"
          }
        >
          {needsYou === 0 ? t("home.statusClear") : t("home.statusNeeds", { count: needsYou })}
        </span>
        {mine > 0 && (
          <span key={`mine-${mine}`} className="count-tick inline-block">
            , {t("home.statusMine", { count: mine })}
          </span>
        )}
        .
        {briefing?.headline && (
          <span className="text-muted-foreground">
            {" "}
            {t("home.statusBriefing", {
              name: briefing.name,
              when: dayTimeLabel(briefing.startedAt, lang),
              headline: briefing.headline,
            })}
          </span>
        )}
      </p>
      {briefing && onOpenBriefing && (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={onOpenBriefing}>
          {t("home.statusOpenBriefing")}
        </Button>
      )}
    </Card>
  );
}
