import type { AgentCard, AppSettingId } from "@marlen/shared";
import { Clock3, Languages, type LucideIcon, Palette, Power, Sparkles, Zap } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { AppearanceControl } from "@/features/settings/AppearanceControl";
import {
  AccentColorControl,
  LanguageControl,
  LaunchAtLoginControl,
  QuickActionsControl,
  TimezoneControl,
} from "@/features/settings/AppPreferenceControls";
import { CardShell } from "./CardShell";

type AppSettingData = Extract<AgentCard, { kind: "app_setting" }>;

const APP_SETTING_PRESENTATIONS = {
  appearance: {
    icon: Palette,
    titleKey: "settings.appearance.label",
    descriptionKey: "settings.appearance.description",
    Control: () => <AppearanceControl variant="buttons" />,
  },
  accent_color: {
    icon: Sparkles,
    titleKey: "settings.accentColor.label",
    descriptionKey: "settings.accentColor.description",
    Control: () => <AccentColorControl className="w-full" />,
  },
  language: {
    icon: Languages,
    titleKey: "settings.sections.language.title",
    descriptionKey: "settings.sections.language.description",
    Control: () => <LanguageControl className="w-full" />,
  },
  timezone: {
    icon: Clock3,
    titleKey: "settings.timezone.label",
    descriptionKey: "settings.timezone.description",
    Control: () => <TimezoneControl className="w-full" />,
  },
  quick_actions: {
    icon: Zap,
    titleKey: "settings.sections.quickActions.title",
    descriptionKey: "settings.sections.quickActions.description",
    Control: () => <QuickActionsControl className="w-full" />,
  },
  launch_at_login: {
    icon: Power,
    titleKey: "settings.launchAtLogin.label",
    descriptionKey: "settings.launchAtLogin.description",
    Control: LaunchAtLoginControl,
  },
} as const satisfies Record<
  AppSettingId,
  {
    icon: LucideIcon;
    titleKey: string;
    descriptionKey: string;
    Control: React.ComponentType;
  }
>;

export function AppSettingCard({ card }: { card: AppSettingData }) {
  const { t } = useTranslation();
  const presentation = APP_SETTING_PRESENTATIONS[card.setting];
  const Control = presentation.Control;

  return (
    <CardShell
      icon={presentation.icon}
      label={t("chat.cards.appSetting.badge")}
      title={t(presentation.titleKey)}
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-xs text-muted-foreground">{t(presentation.descriptionKey)}</p>
        <Control />
      </div>
    </CardShell>
  );
}
