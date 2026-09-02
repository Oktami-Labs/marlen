import type * as React from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  /** Draw the workspace's one line at rest, the grip only on hover, focus or drag. */
  seam?: boolean;
  className?: string;
}

/** Pointer and keyboard grip shared by docked, resizable panels. */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  onPointerDown,
  onKeyDown,
  seam = false,
  className,
}: ResizeHandleProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: interactive splitter; <hr> cannot receive focus or contain the grip
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative w-2.5 shrink-0 cursor-col-resize touch-none items-center justify-center",
        className,
      )}
    >
      {seam && (
        <div aria-hidden className="seam absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
      )}
      <div
        className={cn(
          "relative h-8 w-1 rounded-full transition-colors group-hover:bg-foreground/30 group-focus-visible:bg-foreground/30 group-active:bg-accent/60",
          seam ? "bg-transparent" : "bg-foreground/10",
        )}
      />
    </div>
  );
}
