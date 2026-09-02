import type * as React from "react";
import { Label } from "@/components/ui/label";
import { ListRow } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";

/**
 * The one shape for a settings row: label + description at left, the row's
 * control(s) at right. Renders as a raised `ListRow` on the canvas by
 * default; `bare` is the same row inside an already-raised card or dialog
 * (top-aligned so a wrapping description doesn't drag the control down).
 */
export function SettingRow({
  htmlFor,
  label,
  description,
  error,
  icon,
  bare,
  className,
  children,
}: {
  /** Links the label to the row's control. */
  htmlFor?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: string | null;
  /** Leading mark ahead of the label block (app logo, glyph). */
  icon?: React.ReactNode;
  bare?: boolean;
  className?: string;
  /** The right-aligned control(s). */
  children: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={htmlFor} className="truncate text-sm font-medium">
            {label}
          </Label>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <div className="flex w-full items-center justify-end gap-2 @md:w-auto @md:shrink-0">
        {children}
      </div>
    </>
  );

  const content = (
    <div className="flex w-full flex-col items-stretch gap-3 @md:flex-row @md:items-start @md:justify-between">
      {body}
    </div>
  );

  return bare ? (
    <div className={cn("@container", className)}>{content}</div>
  ) : (
    <ListRow className={cn("@container", className)}>{content}</ListRow>
  );
}
