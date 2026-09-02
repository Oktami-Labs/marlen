import {
  type AgentCard,
  type AppSettingCardDetails,
  type AttachmentItem,
  type CardAccount,
  CHART_KINDS,
  CHART_TONES,
  type ChartPoint,
  type ChartTone,
  type ChoiceOption,
  type ConnectedAccount,
  DELEGATION_STATUSES,
  type DelegationStatus,
  type DelegationTask,
  type DraftPreview,
  type EmailRef,
  type FormField,
  type Lead,
  type LeadCardData,
  type MailSearchHit,
  type MessageCard,
  parseAppSettingCardDetails,
  type ReportItem,
  type ReportRef,
  type ReportSection,
  type SourceItem,
  splitPage,
  type WikiDiffRow,
} from "@marlen/shared";
import { textDiff } from "../core/utils/diff.js";
import { isNonEmptyString, isRecord } from "../core/utils/util.js";
import { parseComposedCard } from "./composedCards.js";
import { parseEmailRef } from "./emailRefs.js";

export type CardOf<K extends AgentCard["kind"]> = Extract<AgentCard, { kind: K }>;

export function cardNote(subject: string, instruction: string): string {
  return `\n\n[The user sees ${subject} as a card in the conversation. ${instruction}]`;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const arr = value.filter(isString);
    return arr.length > 0 ? arr : undefined;
  }
  return isString(value) && value.length > 0 ? [value] : undefined;
}

export function toCardAccount(account: ConnectedAccount): CardAccount {
  return {
    accountId: account.id,
    name: account.name,
    app: account.app,
    appName: account.appName,
    imgSrc: account.imgSrc,
  };
}

export function parseCardAccount(value: unknown): CardAccount | undefined {
  if (!isRecord(value)) return undefined;
  const { accountId, name, app, appName, imgSrc } = value;
  if (!isString(accountId) || !isString(name) || !isString(app)) return undefined;
  return {
    accountId,
    name,
    app,
    ...(isString(appName) ? { appName } : {}),
    ...(isString(imgSrc) ? { imgSrc } : {}),
  };
}

function coerceDraftAttachment(value: unknown): { filename: string; size?: number } | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.filename)) return undefined;
  return {
    filename: value.filename,
    ...(typeof value.size === "number" && Number.isFinite(value.size)
      ? { size: Math.max(0, Math.round(value.size)) }
      : {}),
  };
}

export function coerceDraftPreview(value: unknown): DraftPreview | undefined {
  if (!isRecord(value)) return undefined;
  const {
    draftId,
    proposalId,
    threadId,
    subject,
    to,
    cc,
    bcc,
    body,
    signatureText,
    webUrl,
    attachments,
  } = value;
  if (!isString(subject) || !isString(body)) return undefined;
  if (!isString(draftId) && !isString(proposalId)) return undefined;
  const ccList = toStringArray(cc);
  const bccList = toStringArray(bcc);
  const attachmentList = Array.isArray(attachments)
    ? attachments
        .map(coerceDraftAttachment)
        .filter((a): a is { filename: string; size?: number } => a !== undefined)
    : undefined;
  return {
    ...(isString(draftId) ? { draftId } : {}),
    ...(isString(proposalId) ? { proposalId } : {}),
    ...(isString(threadId) ? { threadId } : {}),
    subject,
    to: toStringArray(to) ?? [],
    ...(ccList ? { cc: ccList } : {}),
    ...(bccList ? { bcc: bccList } : {}),
    body,
    ...(isString(signatureText) && signatureText.trim() ? { signatureText } : {}),
    ...(isString(webUrl) ? { webUrl } : {}),
    ...(attachmentList && attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  };
}

export interface EmailDraftCardInput {
  account?: CardAccount;
  draft: unknown;
  voiceDirectives?: unknown;
}

const MAX_VOICE_DIRECTIVES = 6;
const MAX_VOICE_DIRECTIVE_LENGTH = 300;

function coerceVoiceDirectives(value: unknown): string[] | undefined {
  const directives = toStringArray(value)
    ?.map((entry) => entry.trim().slice(0, MAX_VOICE_DIRECTIVE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_VOICE_DIRECTIVES);
  return directives && directives.length > 0 ? directives : undefined;
}

export function buildEmailDraftCard(input: EmailDraftCardInput): CardOf<"email_draft"> | undefined {
  const draft = coerceDraftPreview(input.draft);
  if (!draft) return undefined;
  const voiceDirectives = coerceVoiceDirectives(input.voiceDirectives);
  return {
    kind: "email_draft",
    ...(input.account ? { account: input.account } : {}),
    draft,
    ...(voiceDirectives ? { voiceDirectives } : {}),
  };
}

function parseEmailDraftCard(
  details: Record<string, unknown>,
  account: CardAccount | undefined,
): CardOf<"email_draft"> | undefined {
  return buildEmailDraftCard({
    account,
    draft: details.draft,
    voiceDirectives: details.voiceDirectives,
  });
}

export interface MessageDraftCardInput {
  channel: string;
  targetLabel: string;
  body: string;
  draftId: string;
}

export function buildMessageDraftCard(
  input: MessageDraftCardInput,
): CardOf<"message_draft"> | undefined {
  if (!isNonEmptyString(input.channel) || !isNonEmptyString(input.draftId)) return undefined;
  return {
    kind: "message_draft",
    channel: input.channel,
    targetLabel: input.targetLabel,
    body: input.body,
    draftId: input.draftId,
  };
}

function parseMessageDraftCard(
  details: Record<string, unknown>,
): CardOf<"message_draft"> | undefined {
  const { channel, targetLabel, body, draftId } = details;
  if (!isNonEmptyString(channel) || !isNonEmptyString(draftId) || !isString(body)) return undefined;
  return buildMessageDraftCard({
    channel,
    targetLabel: isString(targetLabel) ? targetLabel : "",
    body,
    draftId,
  });
}

export function coerceAttachmentItem(value: unknown): AttachmentItem | undefined {
  if (!isRecord(value)) return undefined;
  const { accountId, messageId, filename, mimeType, size, viewable, saveable } = value;
  if (!isNonEmptyString(accountId) || !isNonEmptyString(messageId) || !isNonEmptyString(filename)) {
    return undefined;
  }
  return {
    accountId,
    messageId,
    filename,
    ...(isNonEmptyString(mimeType) ? { mimeType } : {}),
    ...(typeof size === "number" && Number.isFinite(size)
      ? { size: Math.max(0, Math.round(size)) }
      : {}),
    viewable: viewable === true,
    saveable: saveable === true,
  };
}

export interface AttachmentsCardInput {
  account?: CardAccount;
  subject?: string;
  items: unknown[];
}

export function buildAttachmentsCard(input: AttachmentsCardInput): CardOf<"attachments"> {
  const items = input.items
    .map(coerceAttachmentItem)
    .filter((i): i is AttachmentItem => i !== undefined);
  return {
    kind: "attachments",
    ...(input.account ? { account: input.account } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    items,
  };
}

function parseAttachmentsCard(
  details: Record<string, unknown>,
  account: CardAccount | undefined,
): CardOf<"attachments"> | undefined {
  if (!Array.isArray(details.items)) return undefined;
  return buildAttachmentsCard({
    account,
    subject: isString(details.subject) ? details.subject : undefined,
    items: details.items,
  });
}

export function coerceChoiceOption(
  value: unknown,
  ref: EmailRef | undefined,
): ChoiceOption | undefined {
  if (!isRecord(value)) return undefined;
  const { label, detail, reply } = value;
  if (!isNonEmptyString(label)) return undefined;
  return {
    label,
    ...(isNonEmptyString(detail) ? { detail } : {}),
    ...(isNonEmptyString(reply) ? { reply } : {}),
    ...(ref ? { ref } : {}),
  };
}

export function buildChoicesCard(question: string, options: ChoiceOption[]): CardOf<"choices"> {
  return { kind: "choices", question, options };
}

function parseChoicesCard(details: Record<string, unknown>): CardOf<"choices"> | undefined {
  if (!isNonEmptyString(details.question) || !Array.isArray(details.options)) return undefined;
  const options = details.options
    .map((raw) => coerceChoiceOption(raw, parseEmailRef(isRecord(raw) ? raw.ref : undefined)))
    .filter((o): o is ChoiceOption => o !== undefined);
  if (options.length === 0) return undefined;
  return buildChoicesCard(details.question, options);
}

const MAX_CONNECTION_QUERY_LENGTH = 100;

export function buildConnectionCard(query: string): CardOf<"connection"> {
  return { kind: "connection", query: query.trim().slice(0, MAX_CONNECTION_QUERY_LENGTH) };
}

function parseConnectionCard(details: Record<string, unknown>): CardOf<"connection"> | undefined {
  return isString(details.query) ? buildConnectionCard(details.query) : undefined;
}

export function buildAppSettingCard(details: AppSettingCardDetails): CardOf<"app_setting"> {
  return { kind: "app_setting", ...details } as CardOf<"app_setting">;
}

function parseAppSettingCard(details: Record<string, unknown>): CardOf<"app_setting"> | undefined {
  const parsed = parseAppSettingCardDetails(details.setting, details.value);
  return parsed ? buildAppSettingCard(parsed) : undefined;
}

function parseReportRef(value: unknown): ReportRef | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case "email": {
      const { accountId, threadId, messageId, sender, senderEmail, receivedAt, webUrl } = value;
      if (
        !isNonEmptyString(accountId) ||
        !isNonEmptyString(threadId) ||
        !isNonEmptyString(sender)
      ) {
        return undefined;
      }
      return {
        kind: "email",
        accountId,
        threadId,
        ...(isNonEmptyString(messageId) ? { messageId } : {}),
        sender,
        ...(isNonEmptyString(senderEmail) ? { senderEmail } : {}),
        ...(isNonEmptyString(receivedAt) ? { receivedAt } : {}),
        ...(isNonEmptyString(webUrl) ? { webUrl } : {}),
      };
    }
    case "url":
      return isNonEmptyString(value.url) ? { kind: "url", url: value.url } : undefined;
    case "none":
      return { kind: "none" };
    default:
      return undefined;
  }
}

export function reportItemKey(ref: ReportRef, title: string): string {
  switch (ref.kind) {
    case "email":
      return `email:${ref.accountId}\n${ref.threadId}`;
    case "url":
      return `url:${ref.url}`;
    case "none":
      return `title:${title}`;
    default: {
      const _exhaustive: never = ref;
      return _exhaustive;
    }
  }
}

/** `ref` must come from resolved server values, not model data. */
export function coerceReportItem(value: unknown, ref: ReportRef): ReportItem | undefined {
  if (!isRecord(value)) return undefined;
  const { title, gist, deadline, draftId, needsUser, handled, change, since } = value;
  if (!isNonEmptyString(title) || !isNonEmptyString(gist)) return undefined;
  return {
    key: reportItemKey(ref, title),
    ref,
    title,
    gist,
    ...(isNonEmptyString(deadline) ? { deadline } : {}),
    ...(isNonEmptyString(draftId) ? { draftId } : {}),
    ...(needsUser === true ? { needsUser: true } : {}),
    ...(handled === true ? { handled: true } : {}),
    ...(change === "new" || change === "updated" || change === "carried" ? { change } : {}),
    ...(isNonEmptyString(since) ? { since } : {}),
  };
}

function parseReportItem(value: unknown): ReportItem | undefined {
  if (!isRecord(value)) return undefined;
  const ref = parseReportRef(value.ref);
  return ref ? coerceReportItem(value, ref) : undefined;
}

/** A section with nothing in it is not rendered; the model's empty tiers vanish here. */
export function coerceReportSection(
  value: unknown,
  items: ReportItem[],
): ReportSection | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.label) || items.length === 0) return undefined;
  return { label: value.label, ...(value.collapsed === true ? { collapsed: true } : {}), items };
}

function parseReportSection(value: unknown): ReportSection | undefined {
  if (!isRecord(value)) return undefined;
  const items = Array.isArray(value.items)
    ? value.items.map(parseReportItem).filter((i): i is ReportItem => i !== undefined)
    : [];
  return coerceReportSection(value, items);
}

export interface ReportCardInput {
  headline?: string;
  periodLabel?: string;
  accounts?: CardAccount[];
  sections: ReportSection[];
  scanned?: number;
}

export function buildReportCard(input: ReportCardInput): CardOf<"report"> {
  return {
    kind: "report",
    ...(input.headline ? { headline: input.headline } : {}),
    ...(input.periodLabel ? { periodLabel: input.periodLabel } : {}),
    ...(input.accounts && input.accounts.length > 0 ? { accounts: input.accounts } : {}),
    sections: input.sections,
    ...(input.scanned !== undefined ? { scanned: input.scanned } : {}),
  };
}

function parseReportCard(details: Record<string, unknown>): CardOf<"report"> | undefined {
  if (!Array.isArray(details.sections)) return undefined;
  const sections = details.sections
    .map(parseReportSection)
    .filter((s): s is ReportSection => s !== undefined);
  const accountsList = Array.isArray(details.accounts)
    ? details.accounts.map(parseCardAccount).filter((a): a is CardAccount => a !== undefined)
    : undefined;
  return buildReportCard({
    headline: isString(details.headline) ? details.headline : undefined,
    periodLabel: isString(details.periodLabel) ? details.periodLabel : undefined,
    accounts: accountsList,
    sections,
    scanned: typeof details.scanned === "number" ? details.scanned : undefined,
  });
}

const LEAD_STATUSES = ["new", "contacted", "engaged", "qualified", "won", "lost"] as const;
const LEAD_PRIORITIES = ["A", "B", "C"] as const;

export function buildLeadCard(lead: Lead): CardOf<"lead"> {
  const data: LeadCardData = {
    id: lead.id,
    email: lead.email,
    status: lead.status,
    ...(lead.name ? { name: lead.name } : {}),
    ...(lead.priority === "A" || lead.priority === "B" || lead.priority === "C"
      ? { priority: lead.priority }
      : {}),
    ...(lead.language ? { language: lead.language } : {}),
    ...(lead.interest ? { interest: lead.interest } : {}),
    ...(lead.persona ? { persona: lead.persona } : {}),
    ...(lead.phone ? { phone: lead.phone } : {}),
    ...(lead.notes ? { notes: lead.notes } : {}),
    ...(lead.lastInboundAt ? { lastInboundAt: lead.lastInboundAt } : {}),
    ...(lead.lastOutboundAt ? { lastOutboundAt: lead.lastOutboundAt } : {}),
  };
  return { kind: "lead", lead: data };
}

function parseLeadCard(details: Record<string, unknown>): CardOf<"lead"> | undefined {
  const lead = details.lead;
  if (!isRecord(lead)) return undefined;
  const { id, email, status, name, priority, language, interest, persona, phone, notes } = lead;
  if (!isNonEmptyString(id) || !isNonEmptyString(email)) return undefined;
  const data: LeadCardData = {
    id,
    email,
    status:
      isString(status) && (LEAD_STATUSES as readonly string[]).includes(status)
        ? (status as LeadCardData["status"])
        : "new",
    ...(isNonEmptyString(name) ? { name } : {}),
    ...(isString(priority) && (LEAD_PRIORITIES as readonly string[]).includes(priority)
      ? { priority: priority as "A" | "B" | "C" }
      : {}),
    ...(isNonEmptyString(language) ? { language } : {}),
    ...(isNonEmptyString(interest) ? { interest } : {}),
    ...(isNonEmptyString(persona) ? { persona } : {}),
    ...(isNonEmptyString(phone) ? { phone } : {}),
    ...(isNonEmptyString(notes) ? { notes } : {}),
    ...(isNonEmptyString(lead.lastInboundAt) ? { lastInboundAt: lead.lastInboundAt } : {}),
    ...(isNonEmptyString(lead.lastOutboundAt) ? { lastOutboundAt: lead.lastOutboundAt } : {}),
  };
  return { kind: "lead", lead: data };
}

/** At most this many results ride the card; the rest stay in the tool text. */
const MAX_SOURCES = 10;

/** The web results an answer stands on, in the order the search returned them. */
export function buildSourcesCard(
  query: string,
  results: { url: string; title?: string; description?: string; age?: string }[],
): CardOf<"sources"> | undefined {
  const items: SourceItem[] = [];
  for (const result of results.slice(0, MAX_SOURCES)) {
    if (!isNonEmptyString(result.url)) continue;
    items.push({
      url: result.url,
      title: isNonEmptyString(result.title) ? result.title : result.url,
      ...(isNonEmptyString(result.description) ? { description: result.description } : {}),
      ...(isNonEmptyString(result.age) ? { age: result.age } : {}),
    });
  }
  return items.length > 0 ? { kind: "sources", query, items } : undefined;
}

function parseSourcesCard(details: Record<string, unknown>): CardOf<"sources"> | undefined {
  if (!Array.isArray(details.items) || !isString(details.query)) return undefined;
  return buildSourcesCard(
    details.query,
    details.items.filter(isRecord).map((item) => ({
      url: isString(item.url) ? item.url : "",
      title: isString(item.title) ? item.title : undefined,
      description: isString(item.description) ? item.description : undefined,
      age: isString(item.age) ? item.age : undefined,
    })),
  );
}

const MAX_MAIL_SOURCES = 10;
const MAX_MAIL_SOURCE_SNIPPET = 500;

export function buildMailSourcesCard(
  query: string,
  results: unknown[],
): CardOf<"mail_sources"> | undefined {
  const items: MailSearchHit[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (items.length >= MAX_MAIL_SOURCES) break;
    const ref = parseEmailRef(result);
    if (!ref || !isRecord(result)) continue;
    const key = `${ref.accountId}\n${ref.threadId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      ...ref,
      snippet: isString(result.snippet) ? result.snippet.slice(0, MAX_MAIL_SOURCE_SNIPPET) : "",
    });
  }
  return items.length > 0 ? { kind: "mail_sources", query, items } : undefined;
}

function parseMailSourcesCard(
  details: Record<string, unknown>,
): CardOf<"mail_sources"> | undefined {
  if (!Array.isArray(details.items) || !isString(details.query)) return undefined;
  return buildMailSourcesCard(details.query, details.items);
}

/** What the agent just wrote to the wiki, so the turn shows what it will remember. */
export function buildWikiNoteCard(input: {
  pageId: string;
  content: string;
  pageType?: string | null;
  updated?: boolean;
  /** The page as it stood before a rewrite; drives the change list. */
  before?: string;
}): CardOf<"wiki_note"> | undefined {
  const summary = splitPage(input.content).summary;
  if (!isNonEmptyString(input.pageId) || !summary) return undefined;
  const diff = input.before === undefined ? undefined : textDiff(input.before, input.content);
  return {
    kind: "wiki_note",
    pageId: input.pageId,
    summary,
    ...(isNonEmptyString(input.pageType) ? { pageType: input.pageType } : {}),
    ...(input.updated ? { updated: true } : {}),
    ...(diff && diff.added + diff.removed > 0 ? { diff } : {}),
  };
}

function parseWikiDiff(value: unknown): CardOf<"wiki_note">["diff"] {
  if (!isRecord(value)) return undefined;
  const { added, removed, rows } = value;
  if (typeof added !== "number" || typeof removed !== "number") return undefined;
  const parsed: WikiDiffRow[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isRecord(row) || !isString(row.text)) continue;
    if (row.op !== "+" && row.op !== "-") continue;
    parsed.push({ op: row.op, text: row.text });
  }
  return { added, removed, rows: parsed };
}

function parseWikiNoteCard(details: Record<string, unknown>): CardOf<"wiki_note"> | undefined {
  const { pageId, summary, pageType, updated } = details;
  if (!isNonEmptyString(pageId) || !isNonEmptyString(summary)) return undefined;
  const diff = parseWikiDiff(details.diff);
  return {
    kind: "wiki_note",
    pageId,
    summary,
    ...(isNonEmptyString(pageType) ? { pageType } : {}),
    ...(updated === true ? { updated: true } : {}),
    ...(diff ? { diff } : {}),
  };
}

const FIELD_KINDS = ["text", "long", "number", "date", "choice"] as const;
const MAX_FIELD_OPTIONS = 8;

/** The fields an agent asks for in one go, dropping anything unusable. */
export function buildFormCard(title: string, fields: unknown[]): CardOf<"form"> | undefined {
  const parsed: FormField[] = [];
  for (const raw of fields) {
    if (!isRecord(raw)) continue;
    const { name, label, kind, options, placeholder, required } = raw;
    if (!isNonEmptyString(name) || !isNonEmptyString(label)) continue;
    const fieldKind = (FIELD_KINDS as readonly string[]).includes(kind as string)
      ? (kind as FormField["kind"])
      : "text";
    const picks = Array.isArray(options)
      ? options.filter(isNonEmptyString).slice(0, MAX_FIELD_OPTIONS)
      : [];
    // A choice with nothing to choose from would render an empty select.
    if (fieldKind === "choice" && picks.length === 0) continue;
    parsed.push({
      name,
      label,
      kind: fieldKind,
      ...(picks.length > 0 ? { options: picks } : {}),
      ...(isNonEmptyString(placeholder) ? { placeholder } : {}),
      ...(required === true ? { required: true } : {}),
    });
  }
  if (!isNonEmptyString(title) || parsed.length === 0) return undefined;
  return { kind: "form", title, fields: parsed };
}

function parseFormCard(details: Record<string, unknown>): CardOf<"form"> | undefined {
  if (!Array.isArray(details.fields) || !isString(details.title)) return undefined;
  return buildFormCard(details.title, details.fields);
}

export function coerceChartPoint(value: unknown): ChartPoint | undefined {
  if (!isRecord(value)) return undefined;
  const { label, value: v, tone } = value;
  if (!isNonEmptyString(label) || typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return {
    label,
    value: v,
    ...(isString(tone) && (CHART_TONES as readonly string[]).includes(tone)
      ? { tone: tone as ChartTone }
      : {}),
  };
}

export interface ChartCardInput {
  chartType: string;
  title?: string;
  unit?: string;
  points: unknown[];
}

export function buildChartCard(input: ChartCardInput): CardOf<"chart"> | undefined {
  const points = input.points.map(coerceChartPoint).filter((p): p is ChartPoint => p !== undefined);
  if (points.length === 0) return undefined;
  return {
    kind: "chart",
    chartType: (CHART_KINDS as readonly string[]).includes(input.chartType)
      ? (input.chartType as CardOf<"chart">["chartType"])
      : "bar",
    ...(input.title ? { title: input.title } : {}),
    ...(input.unit ? { unit: input.unit } : {}),
    points,
  };
}

function parseChartCard(details: Record<string, unknown>): CardOf<"chart"> | undefined {
  if (!Array.isArray(details.points)) return undefined;
  return buildChartCard({
    chartType: isString(details.chartType) ? details.chartType : "bar",
    title: isString(details.title) ? details.title : undefined,
    unit: isString(details.unit) ? details.unit : undefined,
    points: details.points,
  });
}

export function coerceDelegationTask(value: unknown): DelegationTask | undefined {
  if (!isRecord(value)) return undefined;
  const { label, status, elapsedMs } = value;
  if (!isNonEmptyString(label)) return undefined;
  return {
    label,
    status:
      isString(status) && (DELEGATION_STATUSES as readonly string[]).includes(status)
        ? (status as DelegationStatus)
        : "done",
    ...(typeof elapsedMs === "number" && Number.isFinite(elapsedMs)
      ? { elapsedMs: Math.max(0, Math.round(elapsedMs)) }
      : {}),
  };
}

export function buildDelegationCard(tasks: unknown[]): CardOf<"delegation"> | undefined {
  const coerced = tasks
    .map(coerceDelegationTask)
    .filter((t): t is DelegationTask => t !== undefined);
  if (coerced.length === 0) return undefined;
  return { kind: "delegation", tasks: coerced };
}

function parseDelegationCard(details: Record<string, unknown>): CardOf<"delegation"> | undefined {
  if (!Array.isArray(details.tasks)) return undefined;
  return buildDelegationCard(details.tasks);
}

const CARD_PARSERS: {
  [K in AgentCard["kind"]]: (
    details: Record<string, unknown>,
    account: CardAccount | undefined,
  ) => CardOf<K> | undefined;
} = {
  email_draft: parseEmailDraftCard,
  delegation: (details) => parseDelegationCard(details),
  lead: (details) => parseLeadCard(details),
  chart: (details) => parseChartCard(details),
  composed: (details) => parseComposedCard(details),
  message_draft: (details) => parseMessageDraftCard(details),
  attachments: parseAttachmentsCard,
  choices: parseChoicesCard,
  connection: (details) => parseConnectionCard(details),
  app_setting: (details) => parseAppSettingCard(details),
  report: parseReportCard,
  sources: (details) => parseSourcesCard(details),
  mail_sources: (details) => parseMailSourcesCard(details),
  form: (details) => parseFormCard(details),
  wiki_note: (details) => parseWikiNoteCard(details),
};

/** Validate an untrusted tool payload before it reaches the client. */
export function parseAgentCard(details: unknown): AgentCard | undefined {
  try {
    if (!isRecord(details)) return undefined;
    const kind = details.kind;
    // Do not let Object.prototype names reach the parser lookup.
    if (typeof kind !== "string" || !Object.hasOwn(CARD_PARSERS, kind)) return undefined;
    const parse = CARD_PARSERS[kind as AgentCard["kind"]];
    return parse(details, parseCardAccount(details.account));
  } catch {
    return undefined;
  }
}

export function parseStoredCards(raw: string | null | undefined): MessageCard[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const cards: MessageCard[] = [];
    for (const entry of parsed) {
      if (!isRecord(entry) || typeof entry.toolCallId !== "string") continue;
      const card = parseAgentCard(entry.card);
      if (card) cards.push({ toolCallId: entry.toolCallId, card });
    }
    return cards.length > 0 ? cards : undefined;
  } catch {
    return undefined;
  }
}
