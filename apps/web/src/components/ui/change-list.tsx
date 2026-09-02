import type { TextDiff } from "@marlen/shared";
import { cn } from "@/lib/utils";

/**
 * What a rewrite changed, as the changed lines alone: what went out struck
 * through, what came in beside it. The unchanged bulk is already on screen,
 * so there is no context to show.
 */
export function ChangeList({ diff, className }: { diff: TextDiff; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {diff.rows.map((row, i) => (
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
  );
}
