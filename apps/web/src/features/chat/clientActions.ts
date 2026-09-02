import type { AgentCard } from "@marlen/shared";
import { applyLanguagePreference } from "@/lib/i18n";
import { applyLaunchAtLoginPreference } from "@/lib/launchAtLogin";
import { queryClient } from "@/lib/query";
import { applyQuickActionMode } from "@/lib/quickActions";
import { toast } from "@/lib/toast";
import { applyAccentColor, applyThemePreference } from "@/lib/useTheme";

const APPLIED_ACTIONS_KEY = "marlen-applied-chat-actions";
const APPLIED_ACTIONS_LIMIT = 100;
const pendingActions = new Set<string>();

function readAppliedActions(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(APPLIED_ACTIONS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberAppliedAction(actionId: string, existing: string[]): void {
  const recent = [...existing.filter((id) => id !== actionId), actionId].slice(
    -APPLIED_ACTIONS_LIMIT,
  );
  localStorage.setItem(APPLIED_ACTIONS_KEY, JSON.stringify(recent));
}

function unhandledAppSetting(card: never): never {
  throw new Error(`Unhandled app-setting action: ${JSON.stringify(card)}`);
}

/** Runs a durable card's one-shot client action without replaying it from chat history. */
export function applyAgentCardAction(
  conversationId: string,
  toolCallId: string,
  card: AgentCard,
): void {
  if (card.kind !== "app_setting" || card.value === undefined) return;

  const actionId = `${conversationId}:${toolCallId}`;
  const applied = readAppliedActions();
  if (applied.includes(actionId) || pendingActions.has(actionId)) return;

  switch (card.setting) {
    case "appearance":
      applyThemePreference(card.value);
      break;
    case "accent_color":
      applyAccentColor(card.value);
      break;
    case "language":
      void applyLanguagePreference(card.value).catch(toast.error);
      break;
    case "timezone":
      queryClient.setQueryData(["settings", "timezone"], { timezone: card.value });
      break;
    case "quick_actions":
      applyQuickActionMode(card.value);
      break;
    case "launch_at_login": {
      const enabled = card.value;
      pendingActions.add(actionId);
      void applyLaunchAtLoginPreference(enabled)
        .then((saved) => {
          if (saved !== null) rememberAppliedAction(actionId, readAppliedActions());
        })
        .catch(toast.error)
        .finally(() => pendingActions.delete(actionId));
      return;
    }
    default:
      unhandledAppSetting(card);
  }
  rememberAppliedAction(actionId, applied);
}
