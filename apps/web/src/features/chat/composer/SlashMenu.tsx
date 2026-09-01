import { OptionRow } from "@/components/ui/option-row";
import { ScrollEdges } from "@/components/ui/scroll-edges";
import type { SlashMenuState } from "@/features/chat/composer/useSlashCommands";

/**
 * The command list floating over the composer. Anchored to the composer's own
 * box rather than portaled: it belongs to the input, moves with it, and never
 * has to be positioned against the viewport.
 */
export function SlashMenu({ open, items, active, setActive, pick }: SlashMenuState) {
  if (!open) return null;
  return (
    <ScrollEdges
      role="listbox"
      aria-label="/"
      activeIndex={active}
      className="surface-pop animate-in-up absolute inset-x-0 bottom-full z-20 mb-2"
      viewportClassName="flex max-h-64 flex-col gap-0.5 p-1"
    >
      {items.map((command, i) => (
        <OptionRow
          key={`${command.hint}:${command.id}`}
          selected={i === active}
          label={command.label}
          detail={command.detail}
          title={command.detail}
          trailing={
            <span className="shrink-0 font-mono text-2xs uppercase tracking-wide text-muted-foreground">
              {command.hint}
            </span>
          }
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(command)}
          className="shrink-0 py-2"
        />
      ))}
    </ScrollEdges>
  );
}
