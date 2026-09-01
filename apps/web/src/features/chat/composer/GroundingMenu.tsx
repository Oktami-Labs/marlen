import type { AccountColor } from "@marlen/shared";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { OptionRow } from "@/components/ui/option-row";
import { ScrollEdges } from "@/components/ui/scroll-edges";
import type { GroundingPickerState } from "@/features/chat/composer/useGroundingPicker";
import { accountColor } from "@/lib/accounts";
import { relativeTime } from "@/lib/dates";
import { errorMessage } from "@/lib/utils";

export function GroundingMenu({
  colors,
  ...picker
}: GroundingPickerState & { colors: AccountColor[] }) {
  const { t, i18n } = useTranslation();
  if (!picker.open) return null;

  return (
    <ScrollEdges
      role="listbox"
      aria-label={t("chat.refs.picker")}
      activeIndex={picker.active}
      className="surface-pop animate-in-up absolute inset-x-0 bottom-full z-20 mb-2"
      viewportClassName="flex max-h-72 flex-col gap-0.5 p-1"
    >
      {picker.loading ? (
        <LoadingRow label={t("chat.refs.searching")} className="px-3" />
      ) : picker.error ? (
        <div className="p-2">
          <RetryableError onRetry={picker.retry}>{errorMessage(picker.error)}</RetryableError>
        </div>
      ) : picker.items.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          {t("chat.refs.noResults")}
        </p>
      ) : (
        picker.items.map((item, index) => {
          const detail = [item.from, item.snippet].filter(Boolean).join(" · ");
          const when = item.date ? relativeTime(item.date, i18n.language) : "";
          return (
            <OptionRow
              key={`${item.accountId}:${item.messageId ?? item.threadId}`}
              selected={index === picker.active}
              icon={<AccountDot color={accountColor(colors, item.accountId)} />}
              label={item.subject || t("chat.refs.noSubject")}
              detail={detail}
              title={detail}
              trailing={
                <span className="max-w-28 shrink-0 truncate text-2xs text-muted-foreground">
                  {[item.accountName, when].filter(Boolean).join(" · ")}
                </span>
              }
              onMouseEnter={() => picker.setActive(index)}
              onClick={() => picker.pick(item)}
              className="shrink-0"
            />
          );
        })
      )}
      {picker.partial && (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("chat.refs.partial")}</p>
      )}
    </ScrollEdges>
  );
}
