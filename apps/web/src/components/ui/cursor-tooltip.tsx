import * as React from "react";
import { createPortal } from "react-dom";

type Tooltip = { text: string; x: number; y: number };

const TOOLTIP_SELECTOR =
  "[data-tooltip], button[aria-label], a[aria-label], [role='button'][aria-label], button[title], a[title], [role='button'][title], [data-restored-title]";

/** Hover dwell before a tooltip appears, so passing the cursor over a row shows nothing. */
const HOVER_DELAY_MS = 500;

function tooltipTextOf(el: HTMLElement) {
  const text =
    el.getAttribute("data-tooltip") ||
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    el.getAttribute("data-restored-title");
  return text?.trim() || null;
}

export function CursorTooltip() {
  const [tooltip, setTooltip] = React.useState<Tooltip | null>(null);

  React.useEffect(() => {
    let timer: number | undefined;
    let pending: HTMLElement | null = null;
    let shown: HTMLElement | null = null;
    let hovered: HTMLElement | null = null;
    let point = { x: 0, y: 0 };

    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      pending = null;
      shown = null;
      setTooltip(null);
    };

    // Which element the cursor is over changes only on pointerover, so the
    // selector walk runs there and not once per pixel of movement.
    const handlePointerOver = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest(TOOLTIP_SELECTOR) as HTMLElement | null;
      if (el === hovered) return;
      hovered = el;
      const text = el && tooltipTextOf(el);
      if (!el || !text) {
        if (shown || pending) hide();
        return;
      }

      // Suppress the slow, native browser tooltip
      if (el.hasAttribute("title")) {
        el.setAttribute("data-restored-title", el.getAttribute("title") || "");
        el.removeAttribute("title");
      }

      if (el === shown || el === pending) return;
      window.clearTimeout(timer);
      pending = el;
      timer = window.setTimeout(() => {
        const current = tooltipTextOf(el);
        if (!current) return;
        shown = el;
        pending = null;
        setTooltip({ text: current, ...point });
      }, HOVER_DELAY_MS);
    };

    // A shown tooltip follows the cursor and keeps reading its element's text,
    // which a label swap under the cursor may have changed.
    const handleMouseMove = (e: MouseEvent) => {
      point = { x: e.clientX, y: e.clientY };
      if (!shown) return;
      const text = tooltipTextOf(shown);
      if (text) setTooltip({ text, ...point });
      else hide();
    };

    const handleMouseDown = () => hide();

    window.addEventListener("pointerover", handlePointerOver);
    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", hide);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerover", handlePointerOver);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", hide);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  if (!tooltip) return null;

  return createPortal(<TooltipContent tooltip={tooltip} />, document.body);
}

function TooltipContent({ tooltip }: { tooltip: Tooltip }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (ref.current) {
      const el = ref.current;
      const rect = el.getBoundingClientRect();
      let left = tooltip.x + 16;
      let top = tooltip.y + 16;

      // Flip to the left if it overflows the right edge
      if (left + rect.width > window.innerWidth - 8) {
        left = tooltip.x - rect.width - 8;
      }

      // Flip above if it overflows the bottom edge
      if (top + rect.height > window.innerHeight - 8) {
        top = tooltip.y - rect.height - 8;
      }

      el.style.transform = `translate(${left}px, ${top}px)`;
    }
  }, [tooltip]);

  return (
    <div
      ref={ref}
      className="tooltip-chip tooltip-in pointer-events-none fixed left-0 top-0 z-[150] max-w-xs rounded-md px-2 py-1.5 text-xs font-medium whitespace-pre-line"
    >
      {tooltip.text}
    </div>
  );
}
