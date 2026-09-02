import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  APP_SETTING_IDS,
  appSettingValueDescription,
  isAppSettingId,
  isServerAppSettingChange,
  parseAppSettingCardDetails,
  parseAppSettingChange,
} from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { isValidTimezone } from "../db/settings.js";
import { applyServerAppSetting } from "../services/appPreferences.js";
import { buildAppSettingCard, cardNote } from "./cards.js";
import { textResult, tool } from "./toolkit.js";

const APP_SETTING_CARD_NOTE = cardNote(
  "the real app-setting control",
  "If a value was supplied, the change has been applied. The control remains editable in the " +
    "card. Briefly confirm the result and never send the user to Settings or say you cannot " +
    "change it.",
);

const SETTING_VALUE_GUIDE = APP_SETTING_IDS.map(
  (setting) => `${setting} = ${appSettingValueDescription(setting)}`,
).join("; ");

/** Changes or offers a safe, reversible app preference from an interactive conversation. */
export const manageAppSettingTool: AgentTool = tool({
  name: "manage_app_setting",
  label: "Change app setting",
  description:
    `Change a safe Marlene preference directly, or show its real control in the conversation. ` +
    `Supported settings and values: ${SETTING_VALUE_GUIDE}. ` +
    `When the user's desired value is clear, always pass it so the change happens immediately. ` +
    `When it is missing or ambiguous, omit value to show the inline control; do not use a choices ` +
    `card and do not describe a Settings path. This tool cannot change credentials, permissions, ` +
    `sending privileges, destructive behavior, or other security-sensitive settings.`,
  params: {
    setting: Type.String({ description: `One of: ${APP_SETTING_IDS.join(", ")}.` }),
    value: Type.Optional(
      Type.Union([Type.String({ minLength: 1 }), Type.Boolean()], {
        description:
          "The explicit value in the format documented for setting. Omit only when the user has " +
          "not chosen a value and should use the inline control.",
      }),
    ),
  },
  execute: async ({ setting, value }) => {
    if (!isAppSettingId(setting)) {
      return textResult(
        `Could not change "${setting}": it is not agent-writable. Supported settings: ` +
          `${APP_SETTING_IDS.join(", ")}.`,
      );
    }

    const controlDetails = parseAppSettingCardDetails(setting, undefined);
    if (!controlDetails)
      throw new Error(`No card definition for agent-writable setting ${setting}`);

    const change = value === undefined ? undefined : parseAppSettingChange(setting, value);
    if (value !== undefined && !change) {
      return textResult(
        `Could not apply "${String(value)}" to ${setting}; expected ` +
          `${appSettingValueDescription(setting)}. Offered the real control instead.` +
          APP_SETTING_CARD_NOTE,
        buildAppSettingCard(controlDetails),
      );
    }

    if (change?.setting === "timezone") {
      if (!isValidTimezone(change.value)) {
        return textResult(
          `Could not set "${change.value}" because it is not an exact IANA timezone. ` +
            `Offered the searchable timezone control instead.${APP_SETTING_CARD_NOTE}`,
          buildAppSettingCard(controlDetails),
        );
      }
    }

    if (change && isServerAppSettingChange(change)) await applyServerAppSetting(change);

    const label = setting.replaceAll("_", " ");
    return textResult(
      `${change ? `Set ${label} to ${String(change.value)}` : `Offered the ${label} control`}.${APP_SETTING_CARD_NOTE}`,
      buildAppSettingCard(change ?? controlDetails),
    );
  },
});
