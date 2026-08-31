import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { buildFormCard, cardNote } from "./cards.js";
import { textResult, tool } from "./toolkit.js";

const MAX_FIELDS = 8;

const FORM_CARD_NOTE = cardNote(
  "these fields",
  "End your turn with a short line saying what you still need — the filled answer arrives as " +
    "the user's next message. Do not act until then.",
);

/**
 * The several-things-at-once question. present_choices settles one decision;
 * this one collects the handful of details a task is missing without spending
 * a turn per field.
 */
export const presentFormTool: AgentTool = tool({
  name: "present_form",
  label: "Ask for details",
  description:
    `Ask for several missing details at once, as a small form the user fills in. Use it when a ` +
    `task needs more than one thing you cannot infer — a date AND a time AND a room, an ` +
    `address's street, number and city. For a single either/or, use present_choices instead; ` +
    `for something you can look up, look it up. Their filled answer arrives as their next ` +
    `message in this same conversation, so end your turn after calling this and do not act ` +
    `until it lands.`,
  params: {
    title: Type.String({
      description: 'What you need and what for, e.g. "Details for the viewing appointment".',
    }),
    fields: Type.Array(
      Type.Object({
        name: Type.String({ description: 'Short machine name, e.g. "date".' }),
        label: Type.String({ description: 'What to ask, e.g. "Date of the viewing".' }),
        kind: Type.Optional(
          Type.Union(
            [
              Type.Literal("text"),
              Type.Literal("long"),
              Type.Literal("number"),
              Type.Literal("date"),
              Type.Literal("choice"),
            ],
            { description: 'Control to render; defaults to "text". "long" is a multi-line box.' },
          ),
        ),
        options: Type.Optional(
          Type.Array(Type.String(), { description: 'The picks, required for kind "choice".' }),
        ),
        placeholder: Type.Optional(Type.String({ description: "Example value, shown greyed." })),
        required: Type.Optional(
          Type.Boolean({ description: "The user cannot submit without it." }),
        ),
      }),
      { description: `The details you need, at most ${MAX_FIELDS}.` },
    ),
  },
  catchToText: true,
  execute: async ({ title, fields }) => {
    const card = buildFormCard(title, fields.slice(0, MAX_FIELDS));
    if (!card) {
      return textResult("present_form needs a title and at least one field with a name and label.");
    }
    return textResult(
      `Asked the user for ${card.fields.map((field) => field.label).join(", ")}.${FORM_CARD_NOTE}`,
      card,
    );
  },
});
