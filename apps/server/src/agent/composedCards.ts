import {
  type AgentCard,
  CHART_KINDS,
  CHART_TONES,
  type ChartKind,
  type ChartPoint,
  type ChartTone,
  type ComposedCardAction,
  type ComposedCardBlock,
  type ComposedKeyValue,
  type ComposedListItem,
  type ComposedMetric,
} from "@marlen/shared";
import { isRecord } from "../core/utils/util.js";

type ComposedCard = Extract<AgentCard, { kind: "composed" }>;

export const COMPOSED_CARD_LIMITS = {
  title: 120,
  fallback: 2_000,
  blocks: 8,
  actions: 4,
  metrics: 6,
  items: 12,
  columns: 6,
  rows: 20,
  points: 24,
  label: 120,
  value: 500,
  detail: 1_000,
  markdown: 8_000,
  url: 2_048,
} as const;

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return value === undefined ? undefined : boundedText(value, maxLength);
}

function boundedArray<T>(
  value: unknown,
  maxLength: number,
  parse: (item: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) return undefined;
  const parsed: T[] = [];
  for (const item of value) {
    const next = parse(item);
    if (next === undefined) return undefined;
    parsed.push(next);
  }
  return parsed;
}

function chartTone(value: unknown): ChartTone | undefined {
  return typeof value === "string" && (CHART_TONES as readonly string[]).includes(value)
    ? (value as ChartTone)
    : undefined;
}

function chartKind(value: unknown): ChartKind | undefined {
  return typeof value === "string" && (CHART_KINDS as readonly string[]).includes(value)
    ? (value as ChartKind)
    : undefined;
}

function composedMetric(value: unknown): ComposedMetric | undefined {
  if (!isRecord(value)) return undefined;
  const label = boundedText(value.label, COMPOSED_CARD_LIMITS.label);
  const metricValue = boundedText(value.value, COMPOSED_CARD_LIMITS.value);
  const detail = optionalText(value.detail, COMPOSED_CARD_LIMITS.detail);
  const tone = value.tone === undefined ? undefined : chartTone(value.tone);
  if (
    !label ||
    !metricValue ||
    (value.detail !== undefined && !detail) ||
    (value.tone !== undefined && !tone)
  ) {
    return undefined;
  }
  return { label, value: metricValue, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) };
}

function composedKeyValue(value: unknown): ComposedKeyValue | undefined {
  if (!isRecord(value)) return undefined;
  const label = boundedText(value.label, COMPOSED_CARD_LIMITS.label);
  const itemValue = boundedText(value.value, COMPOSED_CARD_LIMITS.value);
  return label && itemValue ? { label, value: itemValue } : undefined;
}

function composedListItem(value: unknown): ComposedListItem | undefined {
  if (!isRecord(value)) return undefined;
  const title = boundedText(value.title, COMPOSED_CARD_LIMITS.value);
  const detail = optionalText(value.detail, COMPOSED_CARD_LIMITS.detail);
  const tone = value.tone === undefined ? undefined : chartTone(value.tone);
  if (!title || (value.detail !== undefined && !detail) || (value.tone !== undefined && !tone)) {
    return undefined;
  }
  return { title, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) };
}

function chartPoint(value: unknown): ChartPoint | undefined {
  if (!isRecord(value)) return undefined;
  const label = boundedText(value.label, COMPOSED_CARD_LIMITS.label);
  const tone = value.tone === undefined ? undefined : chartTone(value.tone);
  if (
    !label ||
    typeof value.value !== "number" ||
    !Number.isFinite(value.value) ||
    (value.tone !== undefined && !tone)
  ) {
    return undefined;
  }
  return { label, value: value.value, ...(tone ? { tone } : {}) };
}

function composedBlock(value: unknown): ComposedCardBlock | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  switch (value.kind) {
    case "markdown": {
      const content = boundedText(value.content, COMPOSED_CARD_LIMITS.markdown);
      return content ? { kind: "markdown", content } : undefined;
    }
    case "metrics": {
      const items = boundedArray(value.items, COMPOSED_CARD_LIMITS.metrics, composedMetric);
      return items ? { kind: "metrics", items } : undefined;
    }
    case "key_value": {
      const items = boundedArray(value.items, COMPOSED_CARD_LIMITS.items, composedKeyValue);
      return items ? { kind: "key_value", items } : undefined;
    }
    case "list": {
      const items = boundedArray(value.items, COMPOSED_CARD_LIMITS.items, composedListItem);
      if (!items || (value.ordered !== undefined && typeof value.ordered !== "boolean")) {
        return undefined;
      }
      return { kind: "list", ...(value.ordered ? { ordered: true } : {}), items };
    }
    case "table": {
      const columns = boundedArray(value.columns, COMPOSED_CARD_LIMITS.columns, (column) =>
        boundedText(column, COMPOSED_CARD_LIMITS.label),
      );
      const rows = boundedArray(value.rows, COMPOSED_CARD_LIMITS.rows, (row) =>
        boundedArray(row, COMPOSED_CARD_LIMITS.columns, (cell) =>
          boundedText(cell, COMPOSED_CARD_LIMITS.value),
        ),
      );
      if (!columns || !rows || rows.some((row) => row.length !== columns.length)) return undefined;
      return { kind: "table", columns, rows };
    }
    case "chart": {
      const chartType = chartKind(value.chartType);
      const title = optionalText(value.title, COMPOSED_CARD_LIMITS.title);
      const unit = optionalText(value.unit, COMPOSED_CARD_LIMITS.label);
      const points = boundedArray(value.points, COMPOSED_CARD_LIMITS.points, chartPoint);
      if (
        !chartType ||
        !points ||
        (value.title !== undefined && !title) ||
        (value.unit !== undefined && !unit)
      ) {
        return undefined;
      }
      return {
        kind: "chart",
        chartType,
        ...(title ? { title } : {}),
        ...(unit ? { unit } : {}),
        points,
      };
    }
    default:
      return undefined;
  }
}

function httpUrl(value: unknown): string | undefined {
  const url = boundedText(value, COMPOSED_CARD_LIMITS.url);
  if (!url) return undefined;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function composedAction(value: unknown): ComposedCardAction | undefined {
  if (!isRecord(value)) return undefined;
  const label = boundedText(value.label, COMPOSED_CARD_LIMITS.label);
  if (!label) return undefined;
  if (value.kind === "reply") {
    const message = boundedText(value.message, COMPOSED_CARD_LIMITS.fallback);
    return message ? { kind: "reply", label, message } : undefined;
  }
  if (value.kind === "open_url") {
    const url = httpUrl(value.url);
    return url ? { kind: "open_url", label, url } : undefined;
  }
  return undefined;
}

export function buildComposedCard(input: {
  title: unknown;
  fallback: unknown;
  blocks: unknown;
  actions?: unknown;
}): ComposedCard | undefined {
  const title = boundedText(input.title, COMPOSED_CARD_LIMITS.title);
  const fallback = boundedText(input.fallback, COMPOSED_CARD_LIMITS.fallback);
  const blocks = boundedArray(input.blocks, COMPOSED_CARD_LIMITS.blocks, composedBlock);
  const actions =
    input.actions === undefined
      ? undefined
      : boundedArray(input.actions, COMPOSED_CARD_LIMITS.actions, composedAction);
  if (!title || !fallback || !blocks || (input.actions !== undefined && !actions)) return undefined;
  return {
    kind: "composed",
    version: 1,
    title,
    fallback,
    blocks,
    ...(actions ? { actions } : {}),
  };
}

export function parseComposedCard(details: Record<string, unknown>): ComposedCard | undefined {
  if (details.version !== 1) return undefined;
  return buildComposedCard({
    title: details.title,
    fallback: details.fallback,
    blocks: details.blocks,
    actions: details.actions,
  });
}
