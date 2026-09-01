import type { EmailRef } from "@marlen/shared";
import * as React from "react";

const STORAGE_KEY = "marlen-chat-drafts";
const NEW_CONVERSATION_KEY = "new";
const MAX_CHAT_REFS = 8;
const MAX_SAVED_DRAFTS = 100;
const SAVE_DELAY_MS = 400;

interface ComposerDraft {
  text: string;
  refs: EmailRef[];
  updatedAt: string;
}

type ComposerDrafts = Record<string, ComposerDraft>;

function sameRef(a: EmailRef, b: EmailRef): boolean {
  return a.accountId === b.accountId && a.threadId === b.threadId && a.messageId === b.messageId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEmailRef(value: unknown): value is EmailRef {
  if (!isRecord(value)) return false;
  if (typeof value.threadId !== "string" || typeof value.accountId !== "string") return false;
  return ["accountName", "messageId", "subject", "from", "date"].every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  );
}

function readDrafts(): ComposerDrafts {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!isRecord(parsed)) return {};
    const drafts: ComposerDrafts = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      if (typeof value.text !== "string" || typeof value.updatedAt !== "string") continue;
      const refs = Array.isArray(value.refs)
        ? value.refs.filter(isEmailRef).slice(0, MAX_CHAT_REFS)
        : [];
      if (value.text || refs.length > 0) {
        drafts[key] = { text: value.text, refs, updatedAt: value.updatedAt };
      }
    }
    return drafts;
  } catch {
    return {};
  }
}

function writeDrafts(drafts: ComposerDrafts): void {
  const kept = Object.entries(drafts)
    .filter(([, draft]) => draft.text || draft.refs.length > 0)
    .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_SAVED_DRAFTS);
  if (kept.length === 0) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
}

function withoutDraft(drafts: ComposerDrafts, key: string): ComposerDrafts {
  const next = { ...drafts };
  delete next[key];
  return next;
}

export function useComposerDraft(conversationId: string | undefined) {
  const key = conversationId ?? NEW_CONVERSATION_KEY;
  const [drafts, setDrafts] = React.useState<ComposerDrafts>(readDrafts);
  const latest = React.useRef(drafts);
  latest.current = drafts;
  const draft = drafts[key];

  React.useEffect(() => {
    const timer = window.setTimeout(() => writeDrafts(drafts), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [drafts]);

  React.useEffect(() => {
    const flush = () => writeDrafts(latest.current);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const update = React.useCallback(
    (change: (current: ComposerDraft) => ComposerDraft) => {
      setDrafts((current) => {
        const before = current[key] ?? { text: "", refs: [], updatedAt: "" };
        const next = { ...change(before), updatedAt: new Date().toISOString() };
        return next.text || next.refs.length > 0
          ? { ...current, [key]: next }
          : withoutDraft(current, key);
      });
    },
    [key],
  );

  const setText = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      update((current) => ({
        ...current,
        text: typeof value === "function" ? value(current.text) : value,
      }));
    },
    [update],
  );

  const add = React.useCallback(
    (ref: EmailRef) => {
      update((current) => {
        if (current.refs.some((candidate) => sameRef(candidate, ref))) return current;
        if (current.refs.length >= MAX_CHAT_REFS) return current;
        return { ...current, refs: [...current.refs, ref] };
      });
    },
    [update],
  );

  const remove = React.useCallback(
    (ref: EmailRef) => {
      update((current) => ({
        ...current,
        refs: current.refs.filter((candidate) => !sameRef(candidate, ref)),
      }));
    },
    [update],
  );

  const clear = React.useCallback(() => {
    update((current) => ({ ...current, refs: [] }));
  }, [update]);

  return { text: draft?.text ?? "", setText, refs: draft?.refs ?? [], add, remove, clear };
}
