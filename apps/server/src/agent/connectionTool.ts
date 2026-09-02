import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { buildConnectionCard, cardNote } from "./cards.js";
import { textResult, tool } from "./toolkit.js";

const CONNECTION_CARD_NOTE = cardNote(
  "the connection controls",
  "The user can authenticate there without leaving the conversation. Never ask them to paste " +
    "credentials into chat. End your turn and wait for them to finish or continue from the card.",
);

/** Offers provider authentication inside an interactive conversation. */
export const presentConnectionTool: AgentTool = tool({
  name: "present_connection",
  label: "Offer a connection",
  description:
    `Show the app's secure connection controls directly in this conversation. Use when the user ` +
    `asks to connect an account or service, or when their request needs a service that is not ` +
    `connected. The card searches all Pipedream apps and also handles onOffice and WhatsApp. ` +
    `It includes the one-time Pipedream setup when needed. Never ask for passwords, API keys, ` +
    `tokens or secrets in ordinary chat text or a present_form card. After calling this tool, ` +
    `end the turn and let the user authenticate in the card.`,
  params: {
    service: Type.Optional(
      Type.String({
        description:
          'The service the user needs, such as "Google Calendar", "Notion", "onOffice" or ' +
          '"WhatsApp". Omit it to show the full connection picker.',
      }),
    ),
  },
  execute: async ({ service }) => {
    const query = typeof service === "string" ? service : "";
    const card = buildConnectionCard(query);
    return textResult(
      query.trim()
        ? `Offered the connection controls for ${card.query}.${CONNECTION_CARD_NOTE}`
        : `Offered the connection picker.${CONNECTION_CARD_NOTE}`,
      card,
    );
  },
});
