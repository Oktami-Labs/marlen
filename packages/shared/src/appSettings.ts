export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  de: "Deutsch",
};

export const LANGUAGE_ENGLISH_NAMES: Record<Language, string> = {
  en: "English",
  de: "German",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export const APPEARANCE_PREFERENCES = ["light", "dark", "system"] as const;
export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export const ACCENT_COLOR_PREFERENCES = ["violet", "blue", "teal", "rose", "amber"] as const;
export type AccentColorPreference = (typeof ACCENT_COLOR_PREFERENCES)[number];

export const QUICK_ACTION_PREFERENCES = ["send", "prefill"] as const;
export type QuickActionPreference = (typeof QUICK_ACTION_PREFERENCES)[number];

type AppSettingDefinition = {
  valueKind: "enum" | "timezone" | "boolean";
  values?: readonly string[];
  valueDescription: string;
  application: "client" | "server" | "both";
};

/**
 * The single allowlist of preferences the agent may change without a security confirmation.
 * Tool discovery, value validation, durable cards, and exhaustive client/server handlers derive
 * from it, so a newly registered safe setting cannot silently be omitted from the agent flow.
 */
const AGENT_WRITABLE_SETTINGS = {
  appearance: {
    valueKind: "enum",
    values: APPEARANCE_PREFERENCES,
    valueDescription: "light|dark|system",
    application: "client",
  },
  accent_color: {
    valueKind: "enum",
    values: ACCENT_COLOR_PREFERENCES,
    valueDescription: "violet|blue|teal|rose|amber",
    application: "client",
  },
  language: {
    valueKind: "enum",
    values: SUPPORTED_LANGUAGES,
    valueDescription: "en|de",
    application: "both",
  },
  timezone: {
    valueKind: "timezone",
    valueDescription: "an exact IANA name, for example Europe/Vienna or America/New_York",
    application: "server",
  },
  quick_actions: {
    valueKind: "enum",
    values: QUICK_ACTION_PREFERENCES,
    valueDescription: "send|prefill",
    application: "client",
  },
  launch_at_login: {
    valueKind: "boolean",
    valueDescription: "true|false",
    application: "client",
  },
} as const satisfies Record<string, AppSettingDefinition>;

export type AppSettingId = keyof typeof AGENT_WRITABLE_SETTINGS;

type ServerAppSettingId = {
  [Setting in AppSettingId]: (typeof AGENT_WRITABLE_SETTINGS)[Setting]["application"] extends
    | "server"
    | "both"
    ? Setting
    : never;
}[AppSettingId];

type ValueOfDefinition<Definition> = Definition extends {
  valueKind: "enum";
  values: readonly (infer Value extends string)[];
}
  ? Value
  : Definition extends { valueKind: "boolean" }
    ? boolean
    : string;

type AppSettingValue<Setting extends AppSettingId> = ValueOfDefinition<
  (typeof AGENT_WRITABLE_SETTINGS)[Setting]
>;

type AppSettingChange = {
  [Setting in AppSettingId]: {
    setting: Setting;
    value: AppSettingValue<Setting>;
  };
}[AppSettingId];

export type ServerAppSettingChange = Extract<AppSettingChange, { setting: ServerAppSettingId }>;

export type AppSettingCardDetails = {
  [Setting in AppSettingId]: {
    setting: Setting;
    value?: AppSettingValue<Setting>;
  };
}[AppSettingId];

type AppSettingCardWithKind<Details> = Details extends AppSettingCardDetails
  ? Details & { kind: "app_setting" }
  : never;

/** A safe preference control. A present value is also an immediate change request. */
export type AppSettingCard = AppSettingCardWithKind<AppSettingCardDetails>;

export const APP_SETTING_IDS = Object.keys(AGENT_WRITABLE_SETTINGS) as AppSettingId[];

export function isAppSettingId(value: unknown): value is AppSettingId {
  return typeof value === "string" && Object.hasOwn(AGENT_WRITABLE_SETTINGS, value);
}

function isServerAppSettingId(setting: AppSettingId): setting is ServerAppSettingId {
  const application = AGENT_WRITABLE_SETTINGS[setting].application;
  return application === "server" || application === "both";
}

function isAppSettingValue<Setting extends AppSettingId>(
  setting: Setting,
  value: unknown,
): value is AppSettingValue<Setting> {
  const definition: AppSettingDefinition = AGENT_WRITABLE_SETTINGS[setting];
  switch (definition.valueKind) {
    case "enum":
      return typeof value === "string" && Boolean(definition.values?.includes(value));
    case "timezone":
      return typeof value === "string" && value.length > 0;
    case "boolean":
      return typeof value === "boolean";
  }
}

export function parseAppSettingCardDetails(
  setting: unknown,
  value: unknown,
): AppSettingCardDetails | undefined {
  if (!isAppSettingId(setting)) return undefined;
  if (value === undefined) return { setting } as AppSettingCardDetails;
  if (!isAppSettingValue(setting, value)) return undefined;
  return { setting, value } as AppSettingCardDetails;
}

export function parseAppSettingChange(
  setting: unknown,
  value: unknown,
): AppSettingChange | undefined {
  if (!isAppSettingId(setting) || !isAppSettingValue(setting, value)) return undefined;
  return { setting, value } as AppSettingChange;
}

export function isServerAppSettingChange(
  change: AppSettingChange,
): change is ServerAppSettingChange {
  return isServerAppSettingId(change.setting);
}

export function appSettingValueDescription(setting: AppSettingId): string {
  return AGENT_WRITABLE_SETTINGS[setting].valueDescription;
}
