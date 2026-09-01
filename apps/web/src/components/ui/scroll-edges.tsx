import * as React from "react";
import { cn } from "@/lib/utils";

interface EdgeVisibility {
  top: boolean;
  bottom: boolean;
}

const HIDDEN_EDGES: EdgeVisibility = { top: false, bottom: false };

function visibleEdges(viewport: HTMLDivElement): EdgeVisibility {
  const remaining = viewport.scrollHeight - viewport.clientHeight;
  return {
    top: viewport.scrollTop > 1,
    bottom: remaining - viewport.scrollTop > 1,
  };
}

function revealChild(viewport: HTMLDivElement, index: number) {
  const child = viewport.children.item(index);
  if (!(child instanceof HTMLElement)) return;

  const viewportRect = viewport.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  if (childRect.top < viewportRect.top) {
    viewport.scrollTop -= viewportRect.top - childRect.top;
  } else if (childRect.bottom > viewportRect.bottom) {
    viewport.scrollTop += childRect.bottom - viewportRect.bottom;
  }
}

/**
 * A scroll viewport with quiet tonal fades only where more content remains.
 * The native scrollbar stays visible and owns all scrolling behavior.
 */
export function ScrollEdges({
  children,
  className,
  viewportClassName,
  activeIndex,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  children: React.ReactNode;
  viewportClassName?: string;
  /** Direct child to keep visible while a parent-owned picker highlight moves. */
  activeIndex?: number;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState<EdgeVisibility>(HIDDEN_EDGES);

  const updateEdges = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = visibleEdges(viewport);
    setEdges((current) =>
      current.top === next.top && current.bottom === next.bottom ? current : next,
    );
  }, []);

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const resizeObserver = new ResizeObserver(updateEdges);
    const observeSizes = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(viewport);
      for (const child of viewport.children) resizeObserver.observe(child);
      updateEdges();
    };
    const mutationObserver = new MutationObserver(observeSizes);

    observeSizes();
    mutationObserver.observe(viewport, { childList: true, subtree: true, characterData: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [updateEdges]);

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || activeIndex === undefined) return;
    revealChild(viewport, activeIndex);
    updateEdges();
  }, [activeIndex, updateEdges]);

  return (
    <div className={cn("relative min-h-0", className)} {...props}>
      <div
        ref={viewportRef}
        className={cn("overflow-y-auto", viewportClassName)}
        onScroll={updateEdges}
      >
        {children}
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "scroll-edge pointer-events-none absolute start-0 end-2 top-0 z-10 h-5",
          edges.top ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "scroll-edge scroll-edge-bottom pointer-events-none absolute start-0 end-2 bottom-0 z-10 h-5",
          edges.bottom ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
