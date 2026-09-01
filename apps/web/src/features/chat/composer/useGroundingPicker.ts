import type { EmailRef, MailSearchHit } from "@marlen/shared";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { api } from "@/lib/api";

const SEARCH_DELAY_MS = 180;
const MENTION = /(^|\s)@([^@\n]*)$/;

interface ActiveMention {
  query: string;
  start: number;
}

function activeMention(input: string): ActiveMention | undefined {
  const match = MENTION.exec(input);
  if (!match || match.index === undefined) return undefined;
  return {
    query: (match[2] ?? "").trim(),
    start: match.index + (match[1]?.length ?? 0),
  };
}

function emailRef(hit: MailSearchHit): EmailRef {
  const { snippet: _, ...ref } = hit;
  return ref;
}

export interface GroundingPickerState {
  open: boolean;
  items: MailSearchHit[];
  active: number;
  setActive: (index: number) => void;
  pick: (hit: MailSearchHit) => void;
  start: () => void;
  loading: boolean;
  error: unknown;
  partial: boolean;
  retry: () => void;
  onKeyDown: (event: React.KeyboardEvent) => boolean;
}

export function useGroundingPicker({
  input,
  setInput,
  addRef,
}: {
  input: string;
  setInput: (text: string) => void;
  addRef: (ref: EmailRef) => void;
}): GroundingPickerState {
  const [selection, setSelection] = React.useState({ search: "", index: 0 });
  const [dismissed, setDismissed] = React.useState("");
  const mention = activeMention(input);
  const armed = mention !== undefined && dismissed !== input;
  const mentionQuery = mention?.query;
  const [search, setSearch] = React.useState(mentionQuery ?? "");
  const active = selection.search === search ? selection.index : 0;
  const setActive = React.useCallback((index: number) => setSelection({ search, index }), [search]);

  React.useEffect(() => {
    if (!armed || mentionQuery === undefined) return;
    const timer = window.setTimeout(() => setSearch(mentionQuery), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [armed, mentionQuery]);

  const result = useQuery({
    queryKey: ["accounts", "mail-search", search],
    queryFn: ({ signal }) => api.searchMail(search, signal),
    enabled: armed,
    meta: { suppressErrorToast: true },
  });
  const settled = armed && search === mention?.query;
  const items = settled ? (result.data?.items ?? []) : [];
  const clamped = Math.min(active, Math.max(0, items.length - 1));

  const pick = React.useCallback(
    (hit: MailSearchHit) => {
      const current = activeMention(input);
      if (!current) return;
      setInput(input.slice(0, current.start).trimEnd());
      addRef(emailRef(hit));
      setActive(0);
      setDismissed("");
    },
    [input, setInput, addRef, setActive],
  );

  const start = React.useCallback(() => {
    setDismissed("");
    if (activeMention(input)) return;
    setInput(input ? `${input.trimEnd()} @` : "@");
  }, [input, setInput]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (!armed) return false;
      if (event.key === "Escape") {
        setDismissed(input);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (items.length > 0) {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setActive((clamped + delta + items.length) % items.length);
        }
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const hit = items[clamped];
        if (hit) pick(hit);
        return true;
      }
      return false;
    },
    [armed, input, items, clamped, pick, setActive],
  );

  return {
    open: armed,
    items,
    active: clamped,
    setActive,
    pick,
    start,
    loading: armed && (!settled || result.isPending || result.isFetching),
    error: settled ? result.error : null,
    partial: settled && Boolean(result.data?.partial),
    retry: () => void result.refetch(),
    onKeyDown,
  };
}
