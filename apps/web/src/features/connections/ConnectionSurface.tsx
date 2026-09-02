import type * as React from "react";
import { Card } from "@/components/ui/card";

export type ConnectionPresentation = "standalone" | "embedded";

/** Keeps connection forms raised in Settings and bare inside an agent card. */
export function ConnectionSurface({
  presentation = "standalone",
  className,
  children,
}: {
  presentation?: ConnectionPresentation;
  className?: string;
  children: React.ReactNode;
}) {
  return presentation === "standalone" ? (
    <Card padding="md" className={className}>
      {children}
    </Card>
  ) : (
    <div className={className}>{children}</div>
  );
}
