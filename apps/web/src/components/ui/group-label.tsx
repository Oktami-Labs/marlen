import type * as React from "react";
import { cn } from "@/lib/utils";

const SIZE = {
  /** Overline for dense meta lists (pickers, palette sections). */
  sm: "text-2xs font-medium tracking-wide",
  /** Heading for row groups (day buckets, recency groups, card tiers). */
  md: "text-xs font-semibold tracking-wider",
} as const;

/**
 * Small uppercase muted label heading a group of rows, the one overline
 * shape. Tag defaults to h3; pass `as` where the outline or markup demands
 * otherwise.
 */
export function GroupLabel({
  as: Tag = "h3",
  size = "md",
  count,
  className,
  children,
}: {
  as?: "h3" | "h4" | "p" | "span";
  size?: keyof typeof SIZE;
  /** How many rows the group holds; shown from two up, a one over one visible row says nothing. */
  count?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "uppercase text-muted-foreground",
        SIZE[size],
        count !== undefined && "flex items-center gap-1.5",
        className,
      )}
    >
      {children}
      {count !== undefined && count > 1 && (
        <span className="text-2xs tabular-nums text-muted-foreground/70">{count}</span>
      )}
    </Tag>
  );
}
