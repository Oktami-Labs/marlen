import type {
  AgentCard,
  ChartTone,
  ComposedCardAction,
  ComposedCardBlock,
  ComposedListItem,
} from "@marlen/shared";
import { ExternalLink, LayoutTemplate, MessageSquareReply } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { sendChatCommand } from "@/features/chat/controller";
import { cn, openExternal } from "@/lib/utils";
import { CardShell } from "./CardShell";
import { ChartPlot } from "./ChartCard";

type ComposedData = Extract<AgentCard, { kind: "composed" }>;

const TONE_TEXT: Record<ChartTone, string> = {
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

const TONE_DOT: Record<ChartTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground",
};

function unsupported(_value: never): null {
  return null;
}

function MetricsBlock({ block }: { block: Extract<ComposedCardBlock, { kind: "metrics" }> }) {
  return (
    <dl className="grid grid-cols-2 gap-2 @md:grid-cols-3">
      {block.items.map((item, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: one immutable card can contain repeated labels
          key={index}
          className="rounded-lg bg-surface-2 px-3 py-2.5"
        >
          <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-0.5 font-mono text-lg font-semibold leading-tight tabular-nums",
              TONE_TEXT[item.tone ?? "accent"],
            )}
          >
            {item.value}
          </dd>
          {item.detail && <p className="mt-1 text-2xs text-muted-foreground">{item.detail}</p>}
        </div>
      ))}
    </dl>
  );
}

function KeyValueBlock({ block }: { block: Extract<ComposedCardBlock, { kind: "key_value" }> }) {
  return (
    <dl className="grid grid-cols-[minmax(5rem,0.45fr)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {block.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one immutable card can contain repeated labels
        <div key={index} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 whitespace-pre-wrap font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ListRows({ items, ordered = false }: { items: ComposedListItem[]; ordered?: boolean }) {
  return items.map((item, index) => (
    <li
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable card can contain repeated items
      key={index}
      className={cn("min-w-0 py-1.5", !ordered && "flex gap-2.5")}
    >
      {!ordered && (
        <span
          className={cn(
            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
            TONE_DOT[item.tone ?? "neutral"],
          )}
          aria-hidden
        />
      )}
      <span className="min-w-0">
        <span className="block text-sm leading-relaxed">{item.title}</span>
        {item.detail && (
          <span className="block text-xs leading-relaxed text-muted-foreground">{item.detail}</span>
        )}
      </span>
    </li>
  ));
}

function ListBlock({ block }: { block: Extract<ComposedCardBlock, { kind: "list" }> }) {
  if (block.ordered) {
    return (
      <ol className="ml-5 list-decimal marker:font-mono marker:text-xs marker:text-muted-foreground">
        <ListRows items={block.items} ordered />
      </ol>
    );
  }
  return (
    <ul>
      <ListRows items={block.items} />
    </ul>
  );
}

function TableBlock({
  block,
  title,
}: {
  block: Extract<ComposedCardBlock, { kind: "table" }>;
  title: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            {block.columns.map((column, index) => (
              <th
                // biome-ignore lint/suspicious/noArrayIndexKey: one immutable table can repeat headings
                key={index}
                className="border-b border-border px-2.5 py-2 text-xs font-medium text-muted-foreground first:pl-0 last:pr-0"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: one immutable table can contain duplicate rows
              key={rowIndex}
            >
              {row.map((cell, cellIndex) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: column order is the cell's identity
                  key={cellIndex}
                  className="border-b border-border/70 px-2.5 py-2 align-top last:pr-0 first:pl-0"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardBlock({ block, cardTitle }: { block: ComposedCardBlock; cardTitle: string }) {
  switch (block.kind) {
    case "markdown":
      return (
        <Markdown
          content={block.content}
          className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        />
      );
    case "metrics":
      return <MetricsBlock block={block} />;
    case "key_value":
      return <KeyValueBlock block={block} />;
    case "list":
      return <ListBlock block={block} />;
    case "table":
      return <TableBlock block={block} title={cardTitle} />;
    case "chart":
      return (
        <div className="flex flex-col gap-2">
          {block.title && <p className="text-xs font-medium">{block.title}</p>}
          <ChartPlot
            chartType={block.chartType}
            title={block.title ?? cardTitle}
            unit={block.unit}
            points={block.points}
          />
        </div>
      );
    default:
      return unsupported(block);
  }
}

function runAction(action: ComposedCardAction): void {
  switch (action.kind) {
    case "reply":
      sendChatCommand({ kind: "answer", text: action.message });
      return;
    case "open_url":
      openExternal(action.url);
      return;
    default:
      unsupported(action);
  }
}

export function ComposedCard({ card }: { card: ComposedData }) {
  const { t } = useTranslation();
  return (
    <CardShell icon={LayoutTemplate} label={t("chat.cards.composed.badge")} title={card.title}>
      <div className="@container flex flex-col gap-4 px-4 pb-4 pt-0.5">
        {card.blocks.map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: block order is fixed for an immutable card
          <CardBlock key={index} block={block} cardTitle={card.title} />
        ))}
        {card.actions && (
          <div className="flex flex-wrap gap-2 pt-0.5">
            {card.actions.map((action, index) => (
              <Button
                // biome-ignore lint/suspicious/noArrayIndexKey: one immutable card can repeat labels
                key={index}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => runAction(action)}
              >
                {action.kind === "reply" ? <MessageSquareReply /> : <ExternalLink />}
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </CardShell>
  );
}
