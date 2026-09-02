import { isLanguage } from "@marlen/shared";
import { queryOptions, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { rememberLanguage } from "@/lib/i18n";

/** The user's name and self-description; the sidebar and Settings → Profile share it. */
export const profileQuery = queryOptions({
  queryKey: ["settings", "profile"],
  queryFn: () => api.profile().then(({ profile }) => profile),
  meta: { suppressErrorToast: true },
});

/** Adopts the server's saved language, or saves this browser's when none is set yet. */
export function useServerLanguage(): void {
  const { i18n } = useTranslation();
  const { data } = useQuery({
    queryKey: ["settings", "language"],
    queryFn: api.language,
    meta: { suppressErrorToast: true },
  });
  React.useEffect(() => {
    if (!data) return;
    if (!data.language) {
      const current = i18n.language;
      if (isLanguage(current)) {
        rememberLanguage(current);
        void api.setLanguage(current).catch(() => {});
      }
      return;
    }
    rememberLanguage(data.language);
    if (data.language !== i18n.language) void i18n.changeLanguage(data.language);
  }, [data, i18n]);
}

/** Saves this browser's timezone as the server's when none is set yet. */
export function useServerTimezone(): void {
  const { data } = useQuery({
    queryKey: ["settings", "timezone"],
    queryFn: api.timezone,
    meta: { suppressErrorToast: true },
  });
  React.useEffect(() => {
    if (!data || data.timezone) return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) void api.setTimezone(detected).catch(() => {});
  }, [data]);
}
