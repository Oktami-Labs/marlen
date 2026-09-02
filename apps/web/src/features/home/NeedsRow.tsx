import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { HoverActions } from "@/components/ui/hover-actions";
import { NewDot } from "@/features/home/seen";
import { cn } from "@/lib/utils";

/**
 * The row grammar of everything that needs the user: a 24px mark, a title over
 * one meta line, both clipped to one line, and the verbs at the right edge,
 * which take no room until the row is hovered or focused. The title block is
 * the press target when `onPress` is given; what a row unfolds (a note, the
 * answers, an editor) renders below it through `children`, indented to the
 * title. Only the pressable line takes the hover fill, so the answers under a
 * question keep their own fill readable.
 */
export function NeedsRow({
  mark,
  title,
  meta,
  isNew,
  onPress,
  expanded,
  chevron = true,
  actions,
  actionsOpen,
  trailing,
  className,
  style,
  children,
}: {
  mark: React.ReactNode;
  /** A string clips to one line; a node only when the title becomes an editor. */
  title: React.ReactNode;
  meta?: React.ReactNode;
  isNew?: boolean;
  onPress?: () => void;
  /** Set when pressing unfolds the row: announced, and the chevron turns. */
  expanded?: boolean;
  /** Off for a row that opens nothing; a spacer keeps the titles aligned. */
  chevron?: boolean;
  /** Icon verbs shown on hover. */
  actions?: React.ReactNode;
  /** Keeps the verbs on screen while one of them holds an open menu. */
  actionsOpen?: boolean;
  /** Controls that must stay visible, before the chevron. */
  trailing?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const text = (
    <>
      <span className="flex w-6 shrink-0 justify-center">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {isNew && <NewDot />}
          {typeof title === "string" ? <span className="truncate">{title}</span> : title}
        </span>
        {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
    </>
  );
  const textClass = "flex min-w-0 flex-1 basis-full items-center gap-3 text-left @md:basis-0";

  return (
    <div className={className} style={style}>
      <div className="group flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 transition-colors has-[:focus-visible]:bg-surface-2 hover:bg-surface-2">
        {onPress ? (
          <button type="button" onClick={onPress} aria-expanded={expanded} className={textClass}>
            {text}
          </button>
        ) : (
          <div className={textClass}>{text}</div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions && (
            <HoverActions
              className={cn(
                "gap-1 sm:hidden sm:group-focus-within:flex sm:group-hover:flex",
                actionsOpen && "sm:flex",
              )}
            >
              {actions}
            </HoverActions>
          )}
          {trailing}
          {chevron ? (
            <ChevronRight
              aria-hidden
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
          ) : (
            <span aria-hidden className="w-4 shrink-0" />
          )}
        </div>
      </div>
      {children && <div className="flex flex-col gap-2 px-3 pb-2 pl-12">{children}</div>}
    </div>
  );
}
