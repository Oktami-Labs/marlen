import type { AccountColor, AgentCard } from "@marlen/shared";
import { MailSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThreadHistory } from "@/components/ThreadHistory";
import { AccountDot } from "@/components/ui/account-dot";
import { accountColor } from "@/lib/accounts";
import { relativeTime } from "@/lib/dates";
import { stagger } from "@/lib/utils";
import { CardShell } from "./CardShell";

type MailSourcesData = Extract<AgentCard, { kind: "mail_sources" }>;

export function MailSourcesCard({
  card,
  colors,
}: {
  card: MailSourcesData;
  colors?: AccountColor[];
}) {
  const { t, i18n } = useTranslation();
  return (
    <CardShell
      icon={MailSearch}
      label={t("chat.cards.mailSources.badge")}
      meta={String(card.items.length)}
      title={card.query}
    >
      <ul className="flex flex-col px-2 pb-2">
        {card.items.map((item, index) => (
          <li
            key={`${item.accountId}:${item.messageId ?? item.threadId}`}
            className="animate-in-up rounded-lg px-2 py-2 hover:bg-surface-2"
            style={stagger(index)}
          >
            <div className="flex items-start gap-2.5">
              <AccountDot color={accountColor(colors, item.accountId)} className="mt-1.5 h-2 w-2" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {item.subject || t("chat.cards.noSubject")}
                </p>
                <p className="truncate text-xs text-muted-foreground">{item.from}</p>
                {item.snippet && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {item.snippet}
                  </p>
                )}
                <p className="mt-1 font-mono text-2xs text-muted-foreground">
                  {[item.accountName, item.date && relativeTime(item.date, i18n.language)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="mt-1.5">
                  <ThreadHistory
                    accountId={item.accountId}
                    threadId={item.threadId}
                    self={item.accountName}
                  />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
