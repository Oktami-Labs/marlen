import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type", { enum: ["chat", "automation"] })
    .notNull()
    .default("chat"),
  focusAccountId: text("focus_account_id"),
  focusThreadId: text("focus_thread_id"),
  focusThreadSubject: text("focus_thread_subject"),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant", "compaction"] }).notNull(),
  content: text("content").notNull(),
  cards: text("cards"),
  toolCalls: text("tool_calls"),
  /** ms timestamp where the kept-verbatim tail begins; compaction rows only. */
  compactionCutoff: integer("compaction_cutoff"),
  error: text("error"),
  refs: text("refs"),
  /** JSON page ids whose memory shaped this assistant row. */
  memoryIds: text("memory_ids"),
  createdAt: text("created_at").notNull(),
});

export const chatAttachments = sqliteTable(
  "chat_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    kind: text("kind", { enum: ["image", "document"] }).notNull(),
    position: integer("position").notNull(),
    size: integer("size").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    extractedText: text("extracted_text"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_chat_attachments_message_position").on(table.messageId, table.position),
    index("idx_chat_attachments_conversation").on(table.conversationId),
    check("chat_attachments_kind", sql`${table.kind} in ('image', 'document')`),
    check("chat_attachments_position", sql`${table.position} >= 0`),
    check(
      "chat_attachments_text_kind",
      sql`(${table.kind} = 'image' and ${table.extractedText} is null)
        or (${table.kind} = 'document' and ${table.extractedText} is not null)`,
    ),
  ],
);

/**
 * Snapshots of agent-written drafts; the provider stays source of truth for
 * the live drafts list. These rows exist for the draft-vs-sent learning loop
 * and navigation, surviving after the provider draft is edited/sent/deleted.
 * Body text lives in agent_draft_versions.
 */
export const agentDrafts = sqliteTable(
  "agent_drafts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerDraftId: text("provider_draft_id").notNull(),
    providerMessageId: text("provider_message_id"),
    threadId: text("thread_id"),
    conversationId: text("conversation_id"),
    subject: text("subject").notNull().default(""),
    toAddrs: text("to_addrs").notNull().default("[]"),
    ccAddrs: text("cc_addrs").notNull().default("[]"),
    bccAddrs: text("bcc_addrs").notNull().default("[]"),
    status: text("status", { enum: ["open", "sent", "discarded"] })
      .notNull()
      .default("open"),
    sentMessageId: text("sent_message_id"),
    learnedAt: text("learned_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_agent_drafts_provider").on(table.accountId, table.providerDraftId)],
);

/**
 * A chat-composed draft that exists only in Marlen until the user keeps it:
 * the interactive create-draft tool writes one of these instead of a provider
 * draft. Keeping (card button or the agent's keep_draft) creates the real
 * mailbox draft and records its id here; agent_drafts snapshots start there.
 */
export const draftProposals = sqliteTable("draft_proposals", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  threadId: text("thread_id"),
  conversationId: text("conversation_id"),
  subject: text("subject").notNull().default(""),
  toAddrs: text("to_addrs").notNull().default("[]"),
  ccAddrs: text("cc_addrs").notNull().default("[]"),
  bccAddrs: text("bcc_addrs").notNull().default("[]"),
  body: text("body").notNull().default(""),
  attachmentDocIds: text("attachment_doc_ids").notNull().default("[]"),
  status: text("status", { enum: ["proposed", "kept", "sent", "discarded"] })
    .notNull()
    .default("proposed"),
  providerDraftId: text("provider_draft_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Append-only body/subject history of an agent draft: version 1 is the created
 * draft, later rows are in-app rewrites (author "agent") or UI edits (author
 * "user"). The learning loop diffs sent text against the last agent version.
 */
export const agentDraftVersions = sqliteTable(
  "agent_draft_versions",
  {
    draftId: text("draft_id").notNull(),
    version: integer("version").notNull(),
    author: text("author", { enum: ["agent", "user"] }).notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.version] })],
);

export const automations = sqliteTable("automations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  instruction: text("instruction").notNull(),
  schedule: text("schedule").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  showInActivity: integer("show_in_activity", { mode: "boolean" }).notNull().default(true),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  leadId: text("lead_id"),
  runOnNewMail: integer("run_on_new_mail", { mode: "boolean" }).notNull().default(false),
  notifyOnCompletion: integer("notify_on_completion", { mode: "boolean" }).notNull().default(false),
  position: real("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Searchable text lives in the library_chunks FTS5 table, not here (drizzle can't model virtual tables). */
export const libraryDocuments = sqliteTable("library_documents", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  title: text("title").notNull(),
  ext: text("ext").notNull(),
  size: integer("size").notNull(),
  mtimeMs: integer("mtime_ms").notNull(),
  status: text("status", { enum: ["indexed", "error"] }).notNull(),
  error: text("error"),
  chunkCount: integer("chunk_count").notNull().default(0),
  textLength: integer("text_length").notNull().default(0),
  indexedAt: text("indexed_at").notNull(),
});

export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  automationId: text("automation_id").notNull(),
  /** Stable durable transcript shared by this automation's runs. */
  conversationId: text("conversation_id").notNull().default(""),
  status: text("status", { enum: ["running", "success", "error"] }).notNull(),
  result: text("result").notNull().default(""),
  cards: text("cards"),
  trigger: text("trigger"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

/**
 * Durable outcome of one report item in a repeating automation. Work that
 * waits on the user carries into later reports until handled; informational
 * rows remain as dedup evidence so an unchanged item is not announced again.
 */
export const automationReportItems = sqliteTable(
  "automation_report_items",
  {
    automationId: text("automation_id").notNull(),
    /** ReportItem.key: the item's identity across reports. */
    itemKey: text("item_key").notNull(),
    /** What must differ for a repeat to count as news: the email's message id, else the gist. */
    changeKey: text("change_key").notNull().default(""),
    sectionLabel: text("section_label").notNull().default(""),
    itemJson: text("item_json").notNull(),
    disposition: text("disposition", { enum: ["open", "reported", "handled"] }).notNull(),
    /** When the item first entered a report; reset when a handled item reopens with news. */
    firstReportedAt: text("first_reported_at").notNull().default(""),
    lastReportedAt: text("last_reported_at").notNull(),
    handledAt: text("handled_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.automationId, table.itemKey] }),
    index("idx_automation_report_items_disposition").on(
      table.automationId,
      table.disposition,
      table.updatedAt,
    ),
  ],
);

/** Per-item "user has seen this" marks for Home ("todo:<id>", "run:<id>", …);
 *  the __floor__ row pins install time so pre-existing items never read as new. */
export const seenMarks = sqliteTable("seen_marks", {
  key: text("key").primaryKey(),
  seenAt: text("seen_at").notNull(),
});

/** One row per account (latest attempt, overwritten on retry); an "error" row persists until a rerun succeeds. */
export const voiceLearnRuns = sqliteTable("voice_learn_runs", {
  accountId: text("account_id").primaryKey(),
  status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull().default(""),
  accountId: text("account_id").notNull().default(""),
  source: text("source", { enum: ["email", "manual", "onoffice"] })
    .notNull()
    .default("email"),
  onofficeAddressId: text("onoffice_address_id"),
  status: text("status", { enum: ["new", "contacted", "engaged", "qualified", "won", "lost"] })
    .notNull()
    .default("new"),
  interest: text("interest").notNull().default(""),
  persona: text("persona").notNull().default(""),
  priority: text("priority", { enum: ["A", "B", "C", ""] })
    .notNull()
    .default(""),
  language: text("language").notNull().default(""),
  notes: text("notes").notNull().default(""),
  lastInboundAt: text("last_inbound_at"),
  lastOutboundAt: text("last_outbound_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Pending outbound messages for comm channels without a native provider draft (WhatsApp). */
export const outboundDrafts = sqliteTable("outbound_drafts", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  target: text("target").notNull(),
  targetLabel: text("target_label").notNull().default(""),
  body: text("body").notNull(),
  status: text("status", { enum: ["open", "sent", "discarded"] })
    .notNull()
    .default("open"),
  sentRef: text("sent_ref"),
  conversationId: text("conversation_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * An item on the Home agenda: something the user must do, decide, or approve.
 * dedupe_key ("" for ad-hoc) makes a repeating run's create idempotent so it
 * upserts one todo, not many; an approval's key names the draft it wraps.
 */
export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["todo", "approval"] })
    .notNull()
    .default("todo"),
  /** JSON TodoRef for an approval, null for a todo. */
  ref: text("ref"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  status: text("status", { enum: ["open", "done", "dismissed"] })
    .notNull()
    .default("open"),
  dueAt: text("due_at"),
  position: real("position").notNull().default(0),
  conversationId: text("conversation_id"),
  linkedAutomationId: text("linked_automation_id"),
  /** JSON TodoOption[]; the todo is a decision when non-empty. */
  options: text("options").notNull().default("[]"),
  answer: text("answer"),
  dedupeKey: text("dedupe_key").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const learnRuns = sqliteTable("learn_runs", {
  id: text("id").primaryKey(),
  reason: text("reason", { enum: ["boot", "scheduled"] }).notNull(),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  matched: integer("matched").notNull().default(0),
  pending: integer("pending").notNull().default(0),
  identical: integer("identical").notNull().default(0),
  learned: integer("learned").notNull().default(0),
  lessons: integer("lessons").notNull().default(0),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
});

/**
 * The WhatsApp mirror of the paired account's contacts/chats/messages. The
 * protocol pushes state instead of answering queries, so anything not stored
 * here is unreachable later. Text only (media as a bracketed marker); wiped on unlink.
 */
export const waContacts = sqliteTable("wa_contacts", {
  jid: text("jid").primaryKey(),
  name: text("name").notNull().default(""),
  notify: text("notify").notNull().default(""),
  phoneNumber: text("phone_number").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const waChats = sqliteTable("wa_chats", {
  jid: text("jid").primaryKey(),
  name: text("name").notNull().default(""),
  lastMessageAt: text("last_message_at"),
  updatedAt: text("updated_at").notNull(),
});

export const waMessages = sqliteTable(
  "wa_messages",
  {
    chatJid: text("chat_jid").notNull(),
    id: text("id").notNull(),
    senderJid: text("sender_jid").notNull().default(""),
    senderName: text("sender_name").notNull().default(""),
    fromMe: integer("from_me").notNull().default(0),
    text: text("text").notNull(),
    timestamp: text("timestamp").notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatJid, table.id] })],
);
