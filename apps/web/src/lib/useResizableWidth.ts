import * as React from "react";

interface UseResizableWidthOptions {
  /** localStorage key the width is persisted under, as a fraction of the window width. */
  storageKey: string;
  /** Custom property set on the returned ref's element; layout reads the panel
   *  width from it. */
  cssVar: string;
  /** Width in px when nothing is stored, converted against the current window. */
  defaultWidth: number;
  min: number;
  max: number;
  /** Which screen edge the panel is docked to, sets which drag direction grows it. */
  edge: "left" | "right";
  /** Pulling more than OVERDRAG_PX past `min` reads as "put it away": the drag
   *  ends and this fires (e.g. collapse the panel). Width stays clamped at
   *  `min`, so reopening restores a usable size. */
  onOverdrag?: () => void;
}

/** How far past `min` a drag must pull before it counts as a close gesture
 *  rather than jitter against the stop. */
const OVERDRAG_PX = 64;

/** A docked panel never takes more than this share of the window, regardless
 *  of `max`. It must leave most of the screen to the
 *  content it sits beside. */
const MAX_VIEWPORT_FRACTION = 0.45;
const KEYBOARD_STEP_PX = 24;

/** Stored values are window-width fractions in (0, 1); anything else is ignored. */
function readStoredFraction(key: string): number | null {
  if (typeof window === "undefined") return null;
  const saved = Number(window.localStorage.getItem(key));
  return saved > 0 && saved < 1 ? saved : null;
}

/** Drag-to-resize width for a docked side panel. It persists across reloads as a
 *  fraction of the window width so the panel scales with the screen it is on
 *  (laptop vs external monitor) instead of carrying one screen's pixel width to
 *  the other. `min`/`max` bound the resolved px width on every screen.
 *
 *  A drag writes `cssVar` straight to the DOM and commits to React state only
 *  when the pointer is released: the panel tracks the cursor at the browser's
 *  own frame rate instead of re-rendering the app on every pointer move. While
 *  `dragging`, the panel must drop any width transition, or it animates toward
 *  each frame's width and trails the cursor. */
export function useResizableWidth({
  storageKey,
  cssVar,
  defaultWidth,
  min,
  max,
  edge,
  onOverdrag,
}: UseResizableWidthOptions) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = React.useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const [fraction, setFraction] = React.useState(() => {
    const stored = readStoredFraction(storageKey);
    if (stored !== null) return stored;
    const vw = typeof window === "undefined" ? 0 : window.innerWidth;
    return vw > 0 ? defaultWidth / vw : 0;
  });
  const [dragging, setDragging] = React.useState(false);

  const maxPx = Math.max(min, Math.min(max, Math.round(viewportWidth * MAX_VIEWPORT_FRACTION)));
  const width = Math.min(maxPx, Math.max(min, Math.round(fraction * viewportWidth)));

  React.useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  React.useLayoutEffect(() => {
    ref.current?.style.setProperty(cssVar, `${width}px`);
  }, [cssVar, width]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    const startX = e.clientX;
    const startWidth = width;
    let current = startWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDragging(true);

    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setDragging(false);
      setFraction(current / window.innerWidth);
    };
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const next = edge === "right" ? startWidth - delta : startWidth + delta;
      if (onOverdrag && next < min - OVERDRAG_PX) {
        stop();
        onOverdrag();
        return;
      }
      current = Math.min(maxPx, Math.max(min, next));
      el?.style.setProperty(cssVar, `${current}px`);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    // A drag can be interrupted (touch gesture takeover, pen leaving range, OS
    // pointer steal) without a pointerup, without this the listener and the
    // body cursor/user-select styles would leak past the drag.
    window.addEventListener("pointercancel", stop);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    let next: number | undefined;
    if (event.key === "Home") next = min;
    else if (event.key === "End") next = maxPx;
    else if (event.key === "ArrowLeft") {
      next = width + (edge === "right" ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX);
    } else if (event.key === "ArrowRight") {
      next = width + (edge === "right" ? -KEYBOARD_STEP_PX : KEYBOARD_STEP_PX);
    }
    if (next === undefined) return;
    event.preventDefault();
    setFraction(Math.min(maxPx, Math.max(min, next)) / window.innerWidth);
  };

  React.useEffect(() => {
    if (fraction > 0) window.localStorage.setItem(storageKey, String(fraction));
  }, [storageKey, fraction]);

  return { ref, width, dragging, onPointerDown, onKeyDown };
}
