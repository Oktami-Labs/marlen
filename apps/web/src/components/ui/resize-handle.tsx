import type * as React from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
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
        "group w-2 shrink-0 cursor-col-resize touch-none items-center justify-center",
        className,
      )}
    >
      <div className="h-8 w-1 rounded-full bg-foreground/10 transition-colors group-hover:bg-foreground/30 group-active:bg-accent/60" />
    </div>
  );
}
