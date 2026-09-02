import type { AppearancePreference } from "@marlen/shared";
import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Chip } from "@/components/ui/chip";
import { Select } from "@/components/ui/select";
import { useTheme } from "@/lib/useTheme";

type AppearanceControlProps =
  | { variant: "select"; id: string; className?: string }
  | { variant: "buttons" };

export function AppearanceControl(props: AppearanceControlProps) {
  const { t } = useTranslation();
  const [pref, , setPref] = useTheme();
  const options: Array<{
    value: AppearancePreference;
    label: string;
    icon: LucideIcon;
  }> = [
    { value: "light", label: t("settings.appearance.light"), icon: Sun },
    { value: "dark", label: t("settings.appearance.dark"), icon: Moon },
    { value: "system", label: t("settings.appearance.system"), icon: Monitor },
  ];

  if (props.variant === "select") {
    return (
      <Select
        id={props.id}
        aria-label={t("settings.appearance.label")}
        className={props.className}
        value={pref}
        onChange={(value) => {
          const option = options.find((candidate) => candidate.value === value);
          if (option) setPref(option.value);
        }}
        options={options.map(({ value, label }) => ({ value, label }))}
      />
    );
  }

  return (
    <fieldset className="m-0 flex flex-wrap gap-2 p-0">
      <legend className="sr-only">{t("settings.appearance.label")}</legend>
      {options.map(({ value, label, icon: Icon }) => (
        <Chip key={value} active={pref === value} onClick={() => setPref(value)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </Chip>
      ))}
    </fieldset>
  );
}
