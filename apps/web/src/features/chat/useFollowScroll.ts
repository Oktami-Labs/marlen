import * as React from "react";

/** Slack (px) from the end still counted as "at the end", so sub-line drift never breaks following. */
const AT_END_PX = 40;

/**
 * Keeps a transcript viewport pinned to its end while content streams in,
 * lets go the moment the user scrolls up to read, and takes hold again when
 * they scroll back down. `anchorKey` names what the viewport shows
 * (conversation + turn): a change jumps to the end regardless, so a new turn
 * or a switched conversation always opens at its latest message; null means
 * the viewport shows something else and is left alone. `content` is the
 * streamed value whose growth is followed.
 */
export function useFollowScroll(
  ref: React.RefObject<HTMLElement | null>,
  anchorKey: string | null,
  content: unknown,
) {
  const followRef = React.useRef(true);
  const [away, setAway] = React.useState(false);

  const scrollToEnd = React.useCallback(
    (behavior: ScrollBehavior) => {
      const el = ref.current;
      if (!el) return;
      followRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [ref],
  );

  React.useLayoutEffect(() => {
    if (anchorKey !== null) scrollToEnd("auto");
  }, [anchorKey, scrollToEnd]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: content is the trigger (each streamed delta), not read in the body
  React.useLayoutEffect(() => {
    if (anchorKey !== null && followRef.current) scrollToEnd("auto");
  }, [content, anchorKey, scrollToEnd]);

  const onScroll = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX;
    followRef.current = atEnd;
    setAway(!atEnd);
  }, [ref]);

  return {
    onScroll,
    /** The viewport sits away from the end of a shown transcript. */
    away: away && anchorKey !== null,
    jumpToEnd: () => scrollToEnd("smooth"),
  };
}
