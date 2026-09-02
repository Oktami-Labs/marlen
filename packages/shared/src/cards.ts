import type { AppSettingCard } from "./appSettings.js";
import type { LeadStatus } from "./index.js";

export interface EmailRef {
  threadId: string;
  accountId: string;
  accountName?: string;
  messageId?: string;
  subject?: string;
  from?: string;
  date?: string;
}

export interface MailSearchHit extends EmailRef {
  snippet: string;
}

export interface MailSearchResponse {
  items: MailSearchHit[];
  partial: boolean;
}

export interface CardAccount {
  accountId: string;
  name: string;
  app: string;
  appName?: string;
  imgSrc?: string;
}

export interface EmailThreadMessage {
  id?: string;
  from: string;
  to: string[];
  cc?: string[];
  date: string;
  body: string;
  /**
   * The message's HTML, already sanitized server-side, when it has any. The
   * viewer must still render it inside the sandboxed iframe (`EmailBody`) and
   * never inject it into the app document.
   */
  bodyHtml?: string;
  subject?: string;
  isUnread?: boolean;
  isFromMe?: boolean;
}

export interface DraftPreview {
  draftId?: string;
  proposalId?: string;
  threadId?: string;
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  body: string;
  signatureText?: string;
  webUrl?: string;
  attachments?: { filename: string; size?: number }[];
}

/** How an item relates to the previous report of the same automation. */
export type ReportChange = "new" | "updated" | "carried";

/**
 * What a report item points at. Email facts are resolved from the session's
 * own mail reads, never typed by the model.
 */
export type ReportRef =
  | {
      kind: "email";
      accountId: string;
      threadId: string;
      messageId?: string;
      sender: string;
      senderEmail?: string;
      receivedAt?: string;
      webUrl?: string;
    }
  | { kind: "url"; url: string }
  | { kind: "none" };

export interface ReportItem {
  /** Identity across the automation's reports: carry-over, dedup and handled marks key on it. */
  key: string;
  ref: ReportRef;
  /** The row's lead text: the email's subject, or the item's own title. */
  title: string;
  gist: string;
  deadline?: string;
  draftId?: string;
  /** Waits on the user; carried into later reports until closed or reported resolved. */
  needsUser?: boolean;
  /** Closed: by the user in Home, or reported resolved by the model. */
  handled?: boolean;
  change?: ReportChange;
  /** When the item first entered the report; set alongside `change`. */
  since?: string;
}

export interface ReportSection {
  label: string;
  /** Folded by default: routine items the user unfolds on demand. */
  collapsed?: boolean;
  items: ReportItem[];
}

export interface ChoiceOption {
  label: string;
  detail?: string;
  reply?: string;
  ref?: EmailRef;
}

export const DELEGATION_STATUSES = ["pending", "running", "done", "failed"] as const;
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

export interface DelegationTask {
  label: string;
  status: DelegationStatus;
  elapsedMs?: number;
}

export interface AttachmentItem {
  accountId: string;
  messageId: string;
  filename: string;
  mimeType?: string;
  size?: number;
  viewable: boolean;
  saveable: boolean;
}

export interface LeadCardData {
  id: string;
  email: string;
  status: LeadStatus;
  name?: string;
  priority?: "A" | "B" | "C";
  language?: string;
  interest?: string;
  persona?: string;
  phone?: string;
  notes?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
}

export const CHART_KINDS = ["bar", "line"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export const CHART_TONES = ["accent", "success", "warning", "danger", "neutral"] as const;
export type ChartTone = (typeof CHART_TONES)[number];

export interface ChartPoint {
  label: string;
  value: number;
  tone?: ChartTone;
}

/** One changed line of a rewrite, in the order it appears. */
export interface TextDiffRow {
  op: "+" | "-";
  text: string;
}

/** What a rewrite changed: the counts, plus the changed lines when they fit. */
export interface TextDiff {
  added: number;
  removed: number;
  /** The changed lines, capped; empty when the change is too large to spell out. */
  rows: TextDiffRow[];
}

/** One thing the agent still needs before it can act. */
export interface FormField {
  name: string;
  label: string;
  kind: "text" | "long" | "number" | "date" | "choice";
  /** The picks, for kind "choice". */
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

/** One web result an answer stands on. */
export interface SourceItem {
  url: string;
  title: string;
  description?: string;
  /** How old the result is, as the search provider reported it. */
  age?: string;
}

export interface ComposedMetric {
  label: string;
  value: string;
  detail?: string;
  tone?: ChartTone;
}

export interface ComposedKeyValue {
  label: string;
  value: string;
}

export interface ComposedListItem {
  title: string;
  detail?: string;
  tone?: ChartTone;
}

export type ComposedCardBlock =
  | { kind: "markdown"; content: string }
  | { kind: "metrics"; items: ComposedMetric[] }
  | { kind: "key_value"; items: ComposedKeyValue[] }
  | { kind: "list"; ordered?: boolean; items: ComposedListItem[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | {
      kind: "chart";
      chartType: ChartKind;
      title?: string;
      unit?: string;
      points: ChartPoint[];
    };

export type ComposedCardAction =
  | { kind: "reply"; label: string; message: string }
  | { kind: "open_url"; label: string; url: string };

export type AgentCard =
  | {
      kind: "email_draft";
      account?: CardAccount;
      draft: DraftPreview;
      voiceDirectives?: string[];
    }
  | { kind: "delegation"; tasks: DelegationTask[] }
  | { kind: "lead"; lead: LeadCardData }
  | {
      kind: "chart";
      chartType: ChartKind;
      title?: string;
      unit?: string;
      points: ChartPoint[];
    }
  | {
      kind: "composed";
      version: 1;
      title: string;
      fallback: string;
      blocks: ComposedCardBlock[];
      actions?: ComposedCardAction[];
    }
  | { kind: "message_draft"; channel: string; targetLabel: string; body: string; draftId: string }
  | {
      kind: "attachments";
      account?: CardAccount;
      subject?: string;
      items: AttachmentItem[];
    }
  | {
      kind: "choices";
      question: string;
      options: ChoiceOption[];
    }
  | { kind: "connection"; query: string }
  | AppSettingCard
  | { kind: "sources"; query: string; items: SourceItem[] }
  | { kind: "mail_sources"; query: string; items: MailSearchHit[] }
  | { kind: "form"; title: string; fields: FormField[] }
  | {
      kind: "wiki_note";
      pageId: string;
      /** The page's summary line, what the agent will read back later. */
      summary: string;
      /** The page's type, "skill" or an advisory noun; absent for a plain note. */
      pageType?: string;
      /** The page already existed and was rewritten. */
      updated?: boolean;
      /** What the rewrite changed, when it was one. */
      diff?: TextDiff;
    }
  | {
      kind: "report";
      headline?: string;
      periodLabel?: string;
      accounts?: CardAccount[];
      sections: ReportSection[];
      scanned?: number;
    };
