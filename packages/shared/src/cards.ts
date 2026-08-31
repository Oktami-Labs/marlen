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

export const BRIEFING_PRIORITIES = ["urgent", "reply", "action", "fyi"] as const;
export type BriefingPriority = (typeof BRIEFING_PRIORITIES)[number];

export interface BriefingItem {
  threadId: string;
  messageId?: string;
  accountId?: string;
  sender: string;
  senderEmail?: string;
  subject: string;
  gist: string;
  priority: BriefingPriority;
  deadline?: string;
  receivedAt?: string;
  draftId?: string;
  webUrl?: string;
}

export interface BriefingRollup {
  label: string;
  items: BriefingItem[];
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

/** One changed line of a rewritten wiki page. */
export interface WikiDiffRow {
  op: "+" | "-";
  text: string;
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
  | { kind: "sources"; query: string; items: SourceItem[] }
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
      diff?: { added: number; removed: number; rows: WikiDiffRow[] };
    }
  | {
      kind: "briefing";
      headline?: string;
      periodLabel?: string;
      accounts?: CardAccount[];
      items: BriefingItem[];
      rollups?: BriefingRollup[];
      scanned?: number;
    };
