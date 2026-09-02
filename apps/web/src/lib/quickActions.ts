import type { QuickActionPreference } from "@marlen/shared";
import * as React from "react";
import { revealChat, sendChatCommand } from "@/features/chat/controller";

/**
 * What one-tap chat actions (the digest's "Draft reply" / "Ask about this"
 * buttons) do with their composed message: send it right away, or prefill
 * the composer so the user can edit it first.
 */
export type QuickActionMode = QuickActionPreference;

const STORAGE_KEY = "marlen-quick-action-mode";
const listeners = new Set<(mode: QuickActionMode) => void>();

function getQuickActionMode(): QuickActionMode {
  if (typeof window === "undefined") return "send";
  return localStorage.getItem(STORAGE_KEY) === "prefill" ? "prefill" : "send";
}

/** Apply a preference from either a mounted control or a live agent action. */
export function applyQuickActionMode(mode: QuickActionMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  for (const listener of listeners) listener(mode);
}

/** Hand a composed message to the chat panel, honoring the Settings preference. */
export function dispatchQuickAction(text: string): void {
  sendChatCommand({ kind: getQuickActionMode() === "prefill" ? "prefill" : "send", text });
  revealChat();
}

export function useQuickActionMode() {
  const [mode, setMode] = React.useState<QuickActionMode>(getQuickActionMode);

  React.useEffect(() => {
    applyQuickActionMode(mode);
  }, [mode]);

  React.useEffect(() => {
    const listener = (next: QuickActionMode) => {
      if (next !== mode) setMode(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [mode]);

  return [mode, setMode] as const;
}

/**
 * Navigates to the Chat tab and opens a specific run's conversation,
 * shared by every run card that offers a "go to chat" action (Home's
 * activity feed, its briefing hero, and the Automations run list). The
 * command lands on the persistent ChatPanel instance directly, so there is
 * no mount race to bridge.
 */
export function openRunInChat(conversationId: string, goToChat: () => void): void {
  openConversationInChat(conversationId, goToChat);
}

/** Navigate to Chat and open a conversation by id, used by todo provenance links. */
export function openConversationInChat(conversationId: string, goToChat: () => void): void {
  goToChat();
  sendChatCommand({ kind: "open", conversationId });
}
