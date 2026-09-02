import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CHART_KINDS, CHART_TONES } from "@marlen/shared";
import { type TSchema, Type } from "@sinclair/typebox";
import { cardNote } from "./cards.js";
import { buildComposedCard, COMPOSED_CARD_LIMITS } from "./composedCards.js";
import { textResult, tool } from "./toolkit.js";

const text = (maxLength: number, description: string) =>
  Type.String({ minLength: 1, maxLength, description });

const tone = Type.Optional(
  Type.Union(
    CHART_TONES.map((value) => Type.Literal(value)),
    {
      description: "Optional semantic color; omit it unless the meaning benefits from emphasis.",
    },
  ),
);

const itemArray = <T extends TSchema>(items: T, maxItems: number = COMPOSED_CARD_LIMITS.items) =>
  Type.Array(items, { minItems: 1, maxItems });

const blocks = Type.Array(
  Type.Union([
    Type.Object({
      kind: Type.Literal("markdown"),
      content: text(
        COMPOSED_CARD_LIMITS.markdown,
        "Short markdown prose. HTML, CSS, and scripts are not supported.",
      ),
    }),
    Type.Object({
      kind: Type.Literal("metrics"),
      items: itemArray(
        Type.Object({
          label: text(COMPOSED_CARD_LIMITS.label, "Metric label."),
          value: text(COMPOSED_CARD_LIMITS.value, 'Display-ready value, e.g. "€24,800" or "18%".'),
          detail: Type.Optional(text(COMPOSED_CARD_LIMITS.detail, "Optional short context.")),
          tone,
        }),
        COMPOSED_CARD_LIMITS.metrics,
      ),
    }),
    Type.Object({
      kind: Type.Literal("key_value"),
      items: itemArray(
        Type.Object({
          label: text(COMPOSED_CARD_LIMITS.label, "Field label."),
          value: text(COMPOSED_CARD_LIMITS.value, "Field value."),
        }),
      ),
    }),
    Type.Object({
      kind: Type.Literal("list"),
      ordered: Type.Optional(Type.Boolean({ description: "Number the items when order matters." })),
      items: itemArray(
        Type.Object({
          title: text(COMPOSED_CARD_LIMITS.value, "Item text."),
          detail: Type.Optional(text(COMPOSED_CARD_LIMITS.detail, "Optional supporting line.")),
          tone,
        }),
      ),
    }),
    Type.Object({
      kind: Type.Literal("table"),
      columns: itemArray(
        text(COMPOSED_CARD_LIMITS.label, "Column heading."),
        COMPOSED_CARD_LIMITS.columns,
      ),
      rows: itemArray(
        itemArray(
          text(COMPOSED_CARD_LIMITS.value, "Display-ready cell value."),
          COMPOSED_CARD_LIMITS.columns,
        ),
        COMPOSED_CARD_LIMITS.rows,
      ),
    }),
    Type.Object({
      kind: Type.Literal("chart"),
      chartType: Type.Union(
        CHART_KINDS.map((value) => Type.Literal(value)),
        {
          description: '"bar" compares categories; "line" shows an ordered trend.',
        },
      ),
      title: Type.Optional(
        text(COMPOSED_CARD_LIMITS.title, "Optional label for this chart block."),
      ),
      unit: Type.Optional(text(COMPOSED_CARD_LIMITS.label, 'Value suffix, e.g. "€" or "%".')),
      points: itemArray(
        Type.Object({
          label: text(COMPOSED_CARD_LIMITS.label, "Short category or x-axis label."),
          value: Type.Number({ description: "Numeric value." }),
          tone,
        }),
        COMPOSED_CARD_LIMITS.points,
      ),
    }),
  ]),
  { minItems: 1, maxItems: COMPOSED_CARD_LIMITS.blocks },
);

const actions = Type.Optional(
  Type.Array(
    Type.Union([
      Type.Object({
        kind: Type.Literal("reply"),
        label: text(COMPOSED_CARD_LIMITS.label, "Button label."),
        message: text(
          COMPOSED_CARD_LIMITS.fallback,
          "Exact next chat message sent when the user presses the button.",
        ),
      }),
      Type.Object({
        kind: Type.Literal("open_url"),
        label: text(COMPOSED_CARD_LIMITS.label, "Button label."),
        url: Type.String({
          minLength: 1,
          maxLength: COMPOSED_CARD_LIMITS.url,
          pattern: "^https?://",
          description: "Absolute http(s) URL opened outside the app.",
        }),
      }),
    ]),
    { minItems: 1, maxItems: COMPOSED_CARD_LIMITS.actions },
  ),
);

const COMPOSED_CARD_NOTE = cardNote(
  "this structured card",
  "Name its takeaway briefly; don't repeat every value already visible in it.",
);

export const composeCardTool: AgentTool = tool({
  name: "compose_card",
  label: "Build a card",
  description:
    `Build a one-off structured card from safe layout blocks when no dedicated card fits the ` +
    `result. This is presentation, use it after doing the work. Do not use it for an email or ` +
    `message draft, attachments, sources, a report, a question, a form, a service connection, an ` +
    `app setting, a lead, or a chart on its own; those have purpose-built tools. Combine only the ` +
    `blocks the result needs. HTML, CSS, JavaScript, and custom components are not supported. The ` +
    `fallback must state the same result as concise plain text. Actions are optional: reply sends ` +
    `an exact next message and open_url accepts only an absolute http(s) link.`,
  params: {
    title: text(COMPOSED_CARD_LIMITS.title, "Short card title."),
    fallback: text(
      COMPOSED_CARD_LIMITS.fallback,
      "Concise plain-text equivalent if this client cannot render the card.",
    ),
    blocks,
    actions,
  },
  execute: async ({ title, fallback, blocks, actions }) => {
    const card = buildComposedCard({ title, fallback, blocks, actions });
    if (!card) {
      return textResult(
        "compose_card needs a title, a fallback, valid non-empty blocks, matching table rows, and only safe actions.",
      );
    }
    return textResult(
      `Presented “${card.title}” with ${card.blocks.length} block(s).${COMPOSED_CARD_NOTE}`,
      card,
    );
  },
});
