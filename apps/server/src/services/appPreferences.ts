import type { Language, ServerAppSettingChange, UserProfileText } from "@marlen/shared";
import { resetSessions } from "../agent/sessionCache.js";
import {
  LANGUAGE_SETTING_KEY,
  setProfileText,
  setSetting,
  TIMEZONE_SETTING_KEY,
} from "../db/settings.js";
import { rescheduleNightlyLearn } from "../email/learn/service.js";
import { rescheduleAll } from "./automations/scheduler.js";

export async function setLanguagePreference(language: Language): Promise<void> {
  await setSetting(LANGUAGE_SETTING_KEY, language);
  resetSessions();
}

/** The profile text rides in the system prompt, so open sessions restart on it. */
export async function setProfilePreference(text: UserProfileText): Promise<void> {
  await setProfileText(text);
  resetSessions();
}

export async function setTimezonePreference(timezone: string): Promise<void> {
  await setSetting(TIMEZONE_SETTING_KEY, timezone);
  await rescheduleAll();
  await rescheduleNightlyLearn();
  resetSessions();
}

function unhandledServerSetting(change: never): never {
  throw new Error(`Unhandled server app setting: ${JSON.stringify(change)}`);
}

export async function applyServerAppSetting(change: ServerAppSettingChange): Promise<void> {
  switch (change.setting) {
    case "language":
      return setLanguagePreference(change.value);
    case "timezone":
      return setTimezonePreference(change.value);
  }
  return unhandledServerSetting(change);
}
