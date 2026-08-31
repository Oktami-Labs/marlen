import type * as React from "react";
import { useTranslation } from "react-i18next";
import { AvatarMark } from "@/components/ui/avatar-mark";
import { recipientNames } from "@/lib/addresses";

/** Names spelled out before the rest collapses into a "+2". */
const NAMES_SHOWN = 2;

const LINE_LABEL = { to: "mail.to", cc: "mail.cc", bcc: "mail.bcc" } as const;

/**
 * The mail header every email surface opens with: the counterpart's avatar and
 * name, the recipient lines under it, and the timestamp on the right. A draft
 * fronts the person it goes to, a received message the person it came from, so
 * the same block reads the same way whichever direction the mail travels.
 */
export function MessageHeader({
  name,
  detail,
  tone,
  size,
  time,
  dateTime,
  children,
}: {
  name: string;
  /** The bare address behind the name, when spelling it out adds something. */
  detail?: string;
  tone?: "tint-accent" | "tint-neutral";
  size?: "sm" | "md";
  /** Formatted timestamp, right-aligned as mail clients set it. */
  time?: string;
  /** Machine-readable timestamp behind `time`. */
  dateTime?: string;
  /** The recipient lines, `RecipientLine` each. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <AvatarMark name={name} tone={tone} size={size} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {/* Name and address share the line, as a mail client sets them. */}
        <p className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
          <span className="truncate">{name}</span>
          {detail && detail !== name && (
            <span className="truncate text-xs font-normal text-muted-foreground">{detail}</span>
          )}
        </p>
        {children}
      </div>
      {time && (
        <time
          dateTime={dateTime}
          className="shrink-0 pt-0.5 font-mono text-2xs tabular-nums text-muted-foreground"
        >
          {time}
        </time>
      )}
    </div>
  );
}

/**
 * One recipient line, "To: Sophie Wagner, Markus Lindqvist +2". Names stand in
 * for addresses; the raw list stays reachable in the tooltip. The user's own
 * inbox reads as "me", which is what makes an incoming message legible at a
 * glance.
 */
export function RecipientLine({
  kind,
  addresses,
  self,
  children,
}: {
  kind: "to" | "cc" | "bcc";
  addresses?: string[];
  /** The account's own address, shown as "me" wherever it appears. */
  self?: string;
  /** Trailing text sharing the line, e.g. a list row's body snippet. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const names = recipientNames(addresses ?? [], self, t("mail.me"));
  if (names.length === 0 && !children) return null;

  const rest = names.length - NAMES_SHOWN;
  return (
    <p
      className="truncate text-xs text-muted-foreground"
      data-tooltip={addresses?.length ? addresses.join("\n") : undefined}
    >
      {names.length > 0 && (
        <>
          <span className="text-muted-foreground/70">{t(LINE_LABEL[kind])}</span>{" "}
          {names.slice(0, NAMES_SHOWN).join(", ")}
          {rest > 0 && ` +${rest}`}
        </>
      )}
      {children}
    </p>
  );
}
