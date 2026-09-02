import type {
  AccountColor,
  AgentCard,
  CardAccount,
  ReportItem,
  ReportSection,
} from "@marlen/shared";
import { Check, Clock, Eye, FileText, MessageCircleQuestion, PenLine } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AccountDot } from "@/components/ui/account-dot";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { GroupLabel } from "@/components/ui/group-label";
import { HoverActions } from "@/components/ui/hover-actions";
import { OpenExternalButton } from "@/components/ui/open-external-button";
import { accountColor } from "@/lib/accounts";
import { api } from "@/lib/api";
import { dispatchQuickAction } from "@/lib/quickActions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { CardShell } from "./CardShell";

type ReportData = Extract<AgentCard, { kind: "report" }>;
type EmailRef = Extract<ReportItem["ref"], { kind: "email" }>;

/** The row's marker: the account's colour dot for an email item, a neutral
 *  dot otherwise, with the account name riding along for assistive tech only. */
function ItemMarker({
  item,
  accounts,
  colors,
  className,
  dotClassName,
}: {
  item: ReportItem;
  accounts?: CardAccount[];
  colors?: AccountColor[];
  className?: string;
  dotClassName?: string;
}) {
  if (item.ref.kind !== "email") {
    return (
      <span className={className}>
        <span className={cn("rounded-full bg-muted-foreground/40", dotClassName)} />
      </span>
    );
  }
  const accountId = item.ref.accountId;
  const account = accounts?.find((a) => a.accountId === accountId);
  return (
    <span className={className} data-tooltip={account?.name}>
      <AccountDot color={accountColor(colors, accountId)} className={dotClassName} />
      {account && <span className="sr-only">{account.name}</span>}
    </span>
  );
}

function emailRef(item: ReportItem): EmailRef | null {
  return item.ref.kind === "email" ? item.ref : null;
}

function openUrl(item: ReportItem): string | undefined {
  switch (item.ref.kind) {
    case "email":
      return item.ref.webUrl;
    case "url":
      return item.ref.url;
    case "none":
      return undefined;
    default: {
      const _exhaustive: never = item.ref;
      return _exhaustive;
    }
  }
}

/**
 * The structured report card: sections the agent named, in its order, one
 * row per item, cross-account by design (see apps/web/DESIGN.md). An account
 * only ever shows up as a colour dot on a row. A run whose turn produced no
 * card renders as plain markdown instead (see the work column's degrade).
 */
export function ReportCard({
  card,
  colors,
  runId,
  bare,
}: {
  card: ReportData;
  colors?: AccountColor[];
  /** Enables durable "done" feedback for a report produced by this run. */
  runId?: string;
  /** Skip the CardShell frame, for embedding in an already-elevated panel, never nest surfaces. */
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const { headline, periodLabel, accounts, sections, scanned } = card;
  const items = sections.flatMap((section) => section.items);
  const [handled, setHandled] = React.useState(
    () => new Set(items.filter((item) => item.handled).map((item) => item.key)),
  );
  const [handling, setHandling] = React.useState<string | null>(null);

  const handleItem = async (item: ReportItem) => {
    if (!runId || handled.has(item.key)) return;
    setHandling(item.key);
    try {
      await api.handleReportItem(runId, item.key);
      setHandled((current) => new Set(current).add(item.key));
    } catch (error) {
      toast.error(error);
    } finally {
      setHandling(null);
    }
  };

  const isDone = (item: ReportItem) => item.handled === true || handled.has(item.key);
  const meta = [
    periodLabel,
    typeof scanned === "number" ? t("chat.cards.report.stats.scanned", { count: scanned }) : null,
  ].filter((part): part is string => !!part);

  const body = (
    <div className={cn("flex flex-col gap-4", !bare && "px-4 pb-4 pt-0.5")}>
      {(headline || meta.length > 0) && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {headline && <p className="text-sm font-semibold tracking-tight">{headline}</p>}
          {meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("chat.cards.report.empty")}</p>
      ) : (
        sections.map((section) => (
          <Section
            key={section.label}
            section={section}
            accounts={accounts}
            colors={colors}
            isDone={isDone}
            handling={handling}
            onHandle={runId ? (item) => void handleItem(item) : undefined}
          />
        ))
      )}
    </div>
  );

  if (bare) return body;

  return (
    <CardShell
      icon={FileText}
      label={t("chat.cards.report.label")}
      meta={
        items.length > 0 ? t("chat.cards.report.itemCount", { count: items.length }) : undefined
      }
    >
      {body}
    </CardShell>
  );
}

/**
 * One section. A folded section (routine mail, notifications) opens under a
 * disclosure toggle and lists compact rows; an open one carries a heading and
 * full rows. Closed items sink to the end of their section.
 */
function Section({
  section,
  accounts,
  colors,
  isDone,
  handling,
  onHandle,
}: {
  section: ReportSection;
  accounts?: CardAccount[];
  colors?: AccountColor[];
  isDone: (item: ReportItem) => boolean;
  handling: string | null;
  onHandle?: (item: ReportItem) => void;
}) {
  const [open, setOpen] = React.useState(!section.collapsed);
  const items = [...section.items].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));

  return (
    <div className="flex flex-col gap-1.5">
      {section.collapsed ? (
        <DisclosureToggle
          open={open}
          onToggle={() => setOpen((v) => !v)}
          className="px-0.5 py-0.5 font-semibold uppercase tracking-wide"
        >
          {section.label}
          <span className="text-2xs tabular-nums text-muted-foreground/70">{items.length}</span>
        </DisclosureToggle>
      ) : (
        <GroupLabel as="h4" count={items.length} className="px-0.5">
          {section.label}
        </GroupLabel>
      )}

      {open && (
        <div className={cn("flex flex-col", !section.collapsed && "gap-1")}>
          {items.map((item) =>
            section.collapsed ? (
              <CompactRow key={item.key} item={item} accounts={accounts} colors={colors} />
            ) : (
              <ReportRow
                key={item.key}
                item={item}
                accounts={accounts}
                colors={colors}
                handled={isDone(item)}
                handling={handling === item.key}
                onHandle={onHandle ? () => onHandle(item) : undefined}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** One full row: what it is, the gist, what changed, and the actions it affords. */
function ReportRow({
  item,
  accounts,
  colors,
  handled,
  handling,
  onHandle,
}: {
  item: ReportItem;
  accounts?: CardAccount[];
  colors?: AccountColor[];
  handled: boolean;
  handling: boolean;
  onHandle?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const email = emailRef(item);
  const account = email ? accounts?.find((a) => a.accountId === email.accountId) : undefined;
  const url = openUrl(item);
  const since =
    item.change === "carried" && item.since ? sinceLabel(item.since, i18n.language) : null;

  const draftReply = () => {
    if (!email) return;
    dispatchQuickAction(
      t("chat.cards.report.draftReplyPrompt", {
        sender: email.sender,
        subject: item.title,
        account: account?.name ?? email.accountId,
        threadId: email.threadId,
        gist: item.gist,
      }),
    );
  };

  // Jumps straight to the draft's approval row on Home (same ?draft= handoff
  // as the search palette); the chat prompt is the fallback for a draft the
  // card cannot place in an account.
  const reviewDraft = () => {
    if (email && item.draftId) {
      navigate({ pathname: "/", search: `?draft=${email.accountId}:${item.draftId}` });
      return;
    }
    dispatchQuickAction(
      t("chat.cards.report.reviewDraftPrompt", {
        sender: email?.sender ?? "",
        subject: item.title,
        threadId: email?.threadId ?? "",
        draftId: item.draftId ?? "",
      }),
    );
  };

  const askAbout = () => {
    dispatchQuickAction(
      email
        ? t("chat.cards.report.askAboutPrompt", {
            sender: email.sender,
            subject: item.title,
            threadId: email.threadId,
            gist: item.gist,
          })
        : t("chat.cards.report.askAboutItemPrompt", { title: item.title, gist: item.gist }),
    );
  };

  return (
    <div
      className={cn(
        "group -mx-2 flex items-start gap-2 rounded-lg px-2 py-1.5",
        handled && "opacity-55",
      )}
    >
      {/* Keep an accessible account label because colour alone cannot identify an inbox. */}
      <ItemMarker
        item={item}
        accounts={accounts}
        colors={colors}
        className="mt-[7px] shrink-0"
        dotClassName="block h-2 w-2"
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-relaxed", handled && "line-through")}>
          {email && <span className="font-medium">{email.sender} </span>}
          {item.title}
          <span className="mx-1.5 text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">{item.gist}</span>
          {/* What changed since the previous report: news on it, or how long it has waited. */}
          {item.change === "updated" && (
            <ChangeMark>
              {t(email ? "chat.cards.report.newMessage" : "chat.cards.report.updated")}
            </ChangeMark>
          )}
          {since && <ChangeMark>{t("chat.cards.report.since", { when: since })}</ChangeMark>}
        </p>
        {(item.deadline || item.draftId) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.deadline && (
              <Badge variant="muted" className="gap-1">
                <Clock className="h-3 w-3" aria-hidden />
                {item.deadline}
              </Badge>
            )}
            {item.draftId && (
              <button
                type="button"
                onClick={reviewDraft}
                className={badgeVariants({ variant: "success" })}
                data-tooltip={t("chat.cards.report.reviewDraft")}
                aria-label={t("chat.cards.report.reviewDraft")}
              >
                <Eye aria-hidden />
                {t("chat.cards.report.draftReady")}
              </button>
            )}
          </div>
        )}
      </div>
      <HoverActions>
        {onHandle && (
          <Button
            variant="ghost"
            size="icon-xs"
            loading={handling}
            disabled={handled}
            onClick={onHandle}
            data-tooltip={t("chat.cards.report.markHandled")}
            aria-label={t("chat.cards.report.markHandled")}
          >
            <Check />
          </Button>
        )}
        {url && <OpenExternalButton url={url} label={t("chat.cards.draft.open")} />}
        {item.draftId ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={reviewDraft}
            data-tooltip={t("chat.cards.report.reviewDraft")}
            aria-label={t("chat.cards.report.reviewDraft")}
          >
            <Eye />
          </Button>
        ) : (
          email && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={draftReply}
              data-tooltip={t("chat.cards.report.draftReply")}
              aria-label={t("chat.cards.report.draftReply")}
            >
              <PenLine />
            </Button>
          )
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={askAbout}
          data-tooltip={t("chat.cards.report.askAbout")}
          aria-label={t("chat.cards.report.askAbout")}
        >
          <MessageCircleQuestion />
        </Button>
      </HoverActions>
    </div>
  );
}

function ChangeMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 whitespace-nowrap text-xs text-muted-foreground/70">{children}</span>
  );
}

/** The weekday inside a week, the date beyond it, nothing for the same day. */
function sinceLabel(iso: string, lang: string): string | null {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return null;
  return new Date(iso).toLocaleDateString(
    lang,
    days < 7 ? { weekday: "short" } : { day: "numeric", month: "short" },
  );
}

/**
 * One row of a folded section, a compact, quiet counterpart to ReportRow:
 * smaller type, tighter rows, no marks, badges or draft/ask actions. Its
 * single action is an open button that surfaces on hover, so routine rows
 * stay scannable and one click away from the real thing without competing
 * with the rows that need the user.
 */
function CompactRow({
  item,
  accounts,
  colors,
}: {
  item: ReportItem;
  accounts?: CardAccount[];
  colors?: AccountColor[];
}) {
  const { t } = useTranslation();
  const email = emailRef(item);
  const url = openUrl(item);

  return (
    <div className="group -mx-2 flex items-center gap-2 rounded-md px-2 py-1">
      <ItemMarker
        item={item}
        accounts={accounts}
        colors={colors}
        className="shrink-0"
        dotClassName="block h-1.5 w-1.5"
      />
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {email && (
          <>
            <span className="font-medium text-foreground/75">{email.sender}</span>
            <span className="mx-1.5 text-muted-foreground/40">·</span>
          </>
        )}
        {item.title}
        <span className="mx-1.5 text-muted-foreground/40">·</span>
        {item.gist}
      </p>
      {url && (
        <HoverActions>
          <OpenExternalButton
            url={url}
            label={t("chat.cards.draft.open")}
            className="h-5 w-5 text-muted-foreground [&_svg]:size-3"
          />
        </HoverActions>
      )}
    </div>
  );
}
