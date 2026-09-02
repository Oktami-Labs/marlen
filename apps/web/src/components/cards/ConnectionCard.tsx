import type { AgentCard } from "@marlen/shared";
import { Cable } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { sendChatCommand } from "@/features/chat/controller";
import { type ConnectionResult, ConnectionSetup } from "@/features/connections/ConnectionSetup";
import { CardShell } from "./CardShell";

type ConnectionData = Extract<AgentCard, { kind: "connection" }>;

export function ConnectionCard({ card }: { card: ConnectionData }) {
  const { t } = useTranslation();
  const [continued, setContinued] = React.useState(false);
  const title = card.query
    ? t("chat.cards.connection.title", { service: card.query })
    : t("chat.cards.connection.titleAny");

  const continueConversation = (result: ConnectionResult) => {
    if (continued) return;
    setContinued(true);
    sendChatCommand({
      kind: "answer",
      text: t("chat.cards.connection.continueMessage", { service: result.name }),
    });
  };

  return (
    <CardShell icon={Cable} label={t("chat.cards.connection.badge")} title={title}>
      <div className="px-4 pb-4">
        <ConnectionSetup
          initialQuery={card.query}
          onContinue={continued ? undefined : continueConversation}
        />
      </div>
    </CardShell>
  );
}
