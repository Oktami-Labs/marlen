import * as React from "react";

export interface QuotePick {
  text: string;
  /** Viewport coordinates of the selection, for the floating action. */
  top: number;
  left: number;
}

/** Longer than this and the composer would show a wall of quote instead of a question. */
const MAX_QUOTE_CHARS = 600;

/**
 * Text selected inside the transcript, offered back as a quote. Answers the
 * "this one" problem in a long reply: rather than describing which line they
 * mean, the user selects it and it lands in the composer as the thing being
 * asked about.
 */
export function useQuoteSelection(ref: React.RefObject<HTMLElement | null>): {
  pick: QuotePick | null;
  clear: () => void;
} {
  const [pick, setPick] = React.useState<QuotePick | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Read on release, not while dragging: an action that follows the cursor
    // through a selection is noise.
    const settle = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      // Where the selection STARTS decides, not its common ancestor: a
      // triple-click reaches past the paragraph, and that ancestor is then the
      // viewport's own parent rather than anything inside it.
      if (!el.contains(range.startContainer) && !el.contains(range.endContainer)) return;
      const text = selection.toString().trim();
      if (!text) return;
      const rect = range.getBoundingClientRect();
      setPick({
        text: text.slice(0, MAX_QUOTE_CHARS),
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    };
    // A collapsed selection means the user clicked away: the offer goes with it.
    const check = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setPick(null);
    };

    el.addEventListener("mouseup", settle);
    el.addEventListener("keyup", settle);
    el.addEventListener("scroll", () => setPick(null));
    document.addEventListener("selectionchange", check);
    return () => {
      el.removeEventListener("mouseup", settle);
      el.removeEventListener("keyup", settle);
      document.removeEventListener("selectionchange", check);
    };
  }, [ref]);

  const clear = React.useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setPick(null);
  }, []);

  return { pick, clear };
}
