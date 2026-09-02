import type {
  AccountColor,
  AgentCard,
  CardAccount,
  ChatToolCall,
  MessageCard,
  ReportItem,
  RunTrigger,
  TodoOption,
  TodoRef,
  WikiPage,
} from "@marlen/shared";
import type * as schema from "../../db/schema.js";

/**
 * The demo persona: Selin Kaya runs Nordwind Studio (design and branding)
 * from a work Gmail and a personal one. Two weeks of her app state, dated
 * relative to seed time, so every panel has something to show and the same
 * threads, drafts and pages recur across Home, chat, leads and knowledge.
 * Every row id starts with "demo-" so a reseed can replace exactly these rows.
 */

export const DEMO = {
  owner: "Selin Kaya",
  studio: "Nordwind Studio",
  briefingAutomation: "Morgenbriefing",
  briefingHeadline: "Drei Dinge brauchen Sie heute",
  waitingSection: "Warte auf Antwort",
  waitingOn: "Jonas Weber",
  resolved: "Lisa Hofer",
  decisionQuestion: "Rabatt für Acme GmbH gewähren?",
  decisionAnswer: "Ja, 10 %",
  statsAutomation: "Lead-Statistik",
  statsResult:
    "Diese Woche 19 Leads, fünf mehr als letzte Woche. Zwei A-Leads warten auf ein Angebot.",
  chartTitle: "Leads nach Status",
  waitingDraft: "Re: Angebot Rebranding – Rückfragen",
  approvalQuestion: "Donnerstag 10 Uhr vorschlagen oder Termin offen lassen?",
  approvalAnswer: "Ohne Terminvorschlag",
  acmeChat: "Rechnung Acme nachfassen",
  acmePage: "acme-gmbh",
  leadName: "Elif Aydın",
} as const;

export const WORK_ACCOUNT: CardAccount = {
  accountId: "demo-work",
  name: "selin@nordwind-studio.de",
  app: "gmail",
  appName: "Gmail",
};

export const PERSONAL_ACCOUNT: CardAccount = {
  accountId: "demo-personal",
  name: "selin.kaya.mail@gmail.com",
  app: "gmail",
  appName: "Gmail",
};

type AutomationRow = typeof schema.automations.$inferInsert;
type RunRow = typeof schema.automationRuns.$inferInsert;
type ReportItemRow = typeof schema.automationReportItems.$inferInsert;
type ConversationRow = typeof schema.conversations.$inferInsert;
type MessageRow = typeof schema.messages.$inferInsert;
type TodoRow = typeof schema.todos.$inferInsert;
type OutboundRow = typeof schema.outboundDrafts.$inferInsert;
type LeadRow = typeof schema.leads.$inferInsert;
type DraftRow = typeof schema.agentDrafts.$inferInsert;
type DraftVersionRow = typeof schema.agentDraftVersions.$inferInsert;
type ProposalRow = typeof schema.draftProposals.$inferInsert;
type LearnRunRow = typeof schema.learnRuns.$inferInsert;

export type DemoWikiPage = Omit<WikiPage, "revision">;

export interface DemoFile {
  path: string;
  data: string | Buffer;
  modifiedAt: string;
}

export interface DemoRows {
  automations: AutomationRow[];
  runs: RunRow[];
  reportItems: ReportItemRow[];
  conversations: ConversationRow[];
  messages: MessageRow[];
  todos: TodoRow[];
  outbound: OutboundRow[];
  leads: LeadRow[];
  drafts: DraftRow[];
  draftVersions: DraftVersionRow[];
  proposals: ProposalRow[];
  learnRuns: LearnRunRow[];
  /** Home items the user has already looked at. */
  seenKeys: string[];
  /** How far back Home counts items as new. */
  seenFloor: string;
  accountColors: AccountColor[];
  wiki: DemoWikiPage[];
  knowledge: DemoFile[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function clock(now: Date) {
  const at = (daysAgo: number, hh: number, mm = 0): string => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  };
  const hoursAgo = (h: number): string => new Date(now.getTime() - h * 3_600_000).toISOString();
  const day = (offset: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dayLabel = (offset: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
  };
  const earliest = (a: string, b: string): string => (a < b ? a : b);
  return { at, hoursAgo, day, dayLabel, earliest };
}

const gmailUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}`;

function emailItem(
  account: CardAccount,
  threadId: string,
  sender: string,
  title: string,
  gist: string,
  extra: Partial<ReportItem> & { senderEmail?: string; receivedAt?: string; messageId?: string },
): ReportItem {
  const { senderEmail, receivedAt, messageId, ...rest } = extra;
  return {
    key: `email:${account.accountId}\n${threadId}`,
    ref: {
      kind: "email",
      accountId: account.accountId,
      threadId,
      ...(messageId ? { messageId } : {}),
      sender,
      ...(senderEmail ? { senderEmail } : {}),
      ...(receivedAt ? { receivedAt } : {}),
      webUrl: gmailUrl(threadId),
    },
    title,
    gist,
    ...rest,
  };
}

function call(
  id: string,
  name: string,
  label: string,
  parameters: unknown,
  result: unknown,
  opts: { batch?: number; isError?: boolean; contentOffset?: number } = {},
): ChatToolCall {
  return {
    id,
    name,
    label,
    isError: opts.isError ?? false,
    done: true,
    parameters,
    result,
    contentOffset: opts.contentOffset ?? 0,
    batch: opts.batch ?? 0,
  };
}

const cardsJson = (cards: MessageCard[]): string => JSON.stringify(cards);
const card = (toolCallId: string, agentCard: AgentCard): MessageCard => ({
  toolCallId,
  card: agentCard,
});

/** Minimal single-font PDF (ASCII lines only), enough for pdf-parse to extract text. */
function pdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[()\\]/g, (c) => `\\${c}`);
  const content = `BT /F1 11 Tf 50 790 Td 16 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj ${object} endobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    `${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}` +
    `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const ACME_DRAFT_ID = "draft-acme-2291-reply";
const ELIF_DRAFT_ID = "draft-elif-varianten";
const SEEBLICK_DRAFT_ID = "draft-seeblick-adresse";
const ELIF_OUTBOUND_ID = "demo-outbound-elif";
const ACME_PROPOSAL_ID = "demo-proposal-acme";
const ELIF_LEAD_ID = "demo-lead-elif";

const ACME_DRAFT_BODY =
  "Hallo Herr Brandt,\n\nanbei nochmal Rechnung #A-2291 als PDF. Unser Zahlungsziel war der 30. Juni. Bitte gleichen Sie den Betrag bis Ende der Woche aus, sonst müssen wir eine Mahngebühr berechnen.\n\nBeste Grüße\nSelin Kaya";

const VOICE_DIRECTIVES = [
  "Grüßt Kunden mit 'Hallo Herr/Frau <Nachname>', das Team nur mit 'Hi'.",
  "Hält Mails kurz, selten mehr als vier Sätze.",
  "Schließt mit 'Beste Grüße' und der Studio-Signatur.",
];

type ReportCard = Extract<AgentCard, { kind: "report" }>;

export function demoRows(now: Date, briefingAutomationId: string): DemoRows {
  const { at, hoursAgo, day, dayLabel, earliest } = clock(now);

  // ── Automations ─────────────────────────────────────────────────────────
  const automations: AutomationRow[] = [
    {
      id: "demo-automation-lead-stats",
      name: DEMO.statsAutomation,
      instruction:
        "Zähle die Leads nach Status und Priorität. Zeige die Verteilung als Diagramm und nenne die Veränderung zur Vorwoche.",
      schedule: "0 7 * * 1",
      position: 1,
      createdAt: at(12, 10),
    },
    {
      id: "demo-automation-invoices",
      name: "Rechnungen nachfassen",
      instruction:
        "Prüfe im Arbeitskonto alle Rechnungen, deren Zahlungsziel überschritten ist. Schreibe je Kunde einen freundlichen Erinnerungsentwurf und lege ihn zur Freigabe vor. Beim zweiten Mal erwähne die Mahngebühr.",
      schedule: "0 9 * * 1-5",
      runOnNewMail: true,
      notifyOnCompletion: true,
      position: 2,
      createdAt: at(11, 10),
    },
    {
      id: "demo-automation-weekly",
      name: "Wochenrückblick",
      instruction:
        "Fasse die Woche zusammen: erledigte Projekte, neue Anfragen, offene Rechnungen. Zeige die ungelesenen Mails pro Tag als Diagramm.",
      schedule: "0 17 * * 5",
      position: 3,
      createdAt: at(11, 10),
    },
    {
      id: "demo-automation-followup",
      name: "Angebot nachfassen",
      instruction:
        "Folge dem Skill 'angebot-nachfassen' für den Lead, den das erledigte Todo nennt.",
      schedule: "",
      leadId: ELIF_LEAD_ID,
      position: 4,
      createdAt: at(6, 15),
    },
    {
      id: "demo-automation-newsletters",
      name: "Newsletter aufräumen",
      instruction:
        "Archiviere Newsletter und Werbemails, die älter als sieben Tage sind und ungelesen blieben.",
      schedule: "0 20 * * 0",
      enabled: false,
      position: 5,
      createdAt: at(9, 18),
    },
  ];

  // ── The living briefing ─────────────────────────────────────────────────
  const briefingConversationId = `automation:${briefingAutomationId}`;
  const latestBriefingAt = earliest(at(0, 8, 2), hoursAgo(1));
  const latestBriefingStart = earliest(at(0, 7, 58), hoursAgo(1.1));

  const acmeItem = emailItem(
    WORK_ACCOUNT,
    "thread-acme-2291",
    "Thomas Brandt",
    "Re: Rechnung #A-2291 – Zahlungserinnerung",
    "bittet erneut um die Rechnung als PDF, sonst Mahngebühr → antworten",
    {
      senderEmail: "t.brandt@acme-gmbh.de",
      receivedAt: at(1, 16, 40),
      messageId: "msg-acme-2291-3",
      needsUser: true,
      deadline: `${dayLabel(2)}, 17:00`,
      draftId: ACME_DRAFT_ID,
      change: "updated",
      since: at(3, 8),
    },
  );
  const seeblickItem = emailItem(
    PERSONAL_ACCOUNT,
    "thread-seeblick-august",
    "Sabine Möller",
    "Ferienwohnung Seeblick – Buchung im August",
    "fragt nach der Adresse für die Buchungsbestätigung → antworten",
    {
      senderEmail: "sabine.moeller@seeblick-ferien.de",
      receivedAt: hoursAgo(3),
      messageId: "msg-seeblick-2",
      needsUser: true,
      draftId: SEEBLICK_DRAFT_ID,
      change: "new",
      since: latestBriefingAt,
    },
  );
  const rebrandItem = emailItem(
    WORK_ACCOUNT,
    "thread-rebrand-elif",
    DEMO.leadName,
    "Angebot Rebranding – Rückfragen",
    "möchte vor der Freigabe zwei Layout-Varianten sehen → Entwurf prüfen",
    {
      senderEmail: "elif.aydin@brandcraft.de",
      receivedAt: at(5, 9, 15),
      messageId: "msg-rebrand-2",
      needsUser: true,
      draftId: ELIF_DRAFT_ID,
      change: "carried",
      since: at(5, 8),
    },
  );
  const hoferItem = emailItem(
    WORK_ACCOUNT,
    "thread-hofer-2204",
    DEMO.resolved,
    "Rechnung #A-2204",
    "Sie haben selbst geantwortet",
    { senderEmail: "l.hofer@hofer-immobilien.de", messageId: "msg-hofer-1", handled: true },
  );
  const zahnarztItem = emailItem(
    PERSONAL_ACCOUNT,
    "thread-zahnarzt",
    "Zahnarztpraxis Dr. Yıldız",
    "Terminerinnerung nächste Woche",
    "Termin bis Mittwoch bestätigen oder absagen",
    {
      receivedAt: hoursAgo(5),
      messageId: "msg-zahnarzt-1",
      needsUser: true,
      deadline: dayLabel(5),
      change: "new",
      since: latestBriefingAt,
    },
  );
  const portfolioItem: ReportItem = {
    key: "title:Portfolio-Update Herbst",
    ref: { kind: "none" },
    title: "Portfolio-Update Herbst",
    gist: "fehlt noch für den Versand an drei Interessenten",
    needsUser: true,
    change: "carried",
    since: at(2, 8),
  };
  const webseiteItem = emailItem(
    WORK_ACCOUNT,
    "thread-weber-webseite",
    DEMO.waitingOn,
    "Angebot Webseite",
    "kein Feedback zu Ihrem Angebot vom 29.8. → nachfassen?",
    {
      senderEmail: "jonas@weber-architekten.de",
      receivedAt: at(4, 11, 20),
      messageId: "msg-weber-2",
      needsUser: true,
      change: "carried",
      since: at(4, 8),
    },
  );
  const teamItem = emailItem(
    WORK_ACCOUNT,
    "thread-team-update",
    "Team Nordwind",
    "Wöchentliches Update",
    "Statusbericht, keine Rückmeldung nötig",
    { messageId: "msg-team-9", receivedAt: at(1, 17) },
  );
  const statusItem: ReportItem = {
    key: "url:https://status.nordwind-studio.de",
    ref: { kind: "url", url: "https://status.nordwind-studio.de" },
    title: "Statusseite Nordwind",
    gist: "Wartungsfenster Samstag 02:00 bis 04:00",
  };
  const zalandoItem = emailItem(
    WORK_ACCOUNT,
    "roll-zalando",
    "Zalando",
    "-20 % auf Sneaker – nur bis Sonntag",
    "Rabattaktion, keine Handlung nötig",
    { messageId: "msg-zalando-4" },
  );
  const spotifyItem = emailItem(
    PERSONAL_ACCOUNT,
    "roll-spotify",
    "Spotify",
    "Dein Wochenmix ist da",
    "neue Playlist-Empfehlungen",
    { messageId: "msg-spotify-2" },
  );
  const appleItem = emailItem(
    PERSONAL_ACCOUNT,
    "roll-apple",
    "Apple",
    "Deine Rechnung von Apple",
    "iCloud+ 0,99 € abgebucht",
    { messageId: "msg-apple-7" },
  );
  const amazonItem = emailItem(
    PERSONAL_ACCOUNT,
    "roll-amazon",
    "Amazon.de",
    "Deine Bestellung wurde versandt",
    "Paket kommt voraussichtlich Dienstag",
    { messageId: "msg-amazon-3" },
  );

  const latestReport: ReportCard = {
    kind: "report",
    headline: DEMO.briefingHeadline,
    periodLabel: "seit gestern 08:00",
    accounts: [WORK_ACCOUNT, PERSONAL_ACCOUNT],
    scanned: 23,
    sections: [
      { label: "Dringend", items: [acmeItem] },
      { label: "Antwort ausstehend", items: [seeblickItem, rebrandItem, hoferItem] },
      { label: "Zu tun", items: [zahnarztItem, portfolioItem] },
      { label: DEMO.waitingSection, items: [webseiteItem] },
      { label: "Zur Kenntnis", collapsed: true, items: [teamItem, statusItem] },
      { label: "Newsletter & Angebote", collapsed: true, items: [zalandoItem, spotifyItem] },
      { label: "Quittungen", collapsed: true, items: [appleItem, amazonItem] },
    ],
  };

  const previousReport: ReportCard = {
    kind: "report",
    headline: "Zwei Dinge brauchen Sie heute",
    periodLabel: "seit vorgestern 08:00",
    accounts: [WORK_ACCOUNT, PERSONAL_ACCOUNT],
    scanned: 18,
    sections: [
      {
        label: "Dringend",
        items: [{ ...acmeItem, gist: "erinnert an Rechnung #A-2291 → antworten", change: "new" }],
      },
      {
        label: "Antwort ausstehend",
        items: [
          { ...rebrandItem, change: "carried" },
          {
            ...hoferItem,
            gist: "fragt nach dem Zahlungsstatus von #A-2204 → antworten",
            needsUser: true,
            handled: undefined,
            change: "new",
          },
        ],
      },
      { label: DEMO.waitingSection, items: [{ ...webseiteItem, change: "new" }] },
      { label: "Quittungen", collapsed: true, items: [appleItem] },
    ],
  };

  const quietReport: ReportCard = {
    kind: "report",
    headline: "Alles ruhig, nichts wartet auf Sie",
    periodLabel: "seit gestern 08:00",
    accounts: [WORK_ACCOUNT],
    scanned: 11,
    sections: [{ label: "Zur Kenntnis", collapsed: true, items: [teamItem] }],
  };

  const stripMarks = (item: ReportItem): string =>
    JSON.stringify({ ...item, handled: undefined, change: undefined, since: undefined });
  const changeKey = (item: ReportItem): string =>
    item.ref.kind === "email" ? (item.ref.messageId ?? "") : item.gist;

  const reportItems: ReportItemRow[] = [];
  for (const section of latestReport.sections) {
    for (const item of section.items) {
      const disposition = item.handled ? "handled" : item.needsUser ? "open" : "reported";
      reportItems.push({
        automationId: briefingAutomationId,
        itemKey: item.key,
        changeKey: changeKey(item),
        sectionLabel: section.label,
        itemJson: stripMarks(item),
        disposition,
        firstReportedAt: item.since ?? latestBriefingAt,
        lastReportedAt: latestBriefingAt,
        handledAt: disposition === "handled" ? at(1, 15, 10) : null,
        updatedAt: latestBriefingAt,
      });
    }
  }

  const briefing3Result = `${DEMO.briefingHeadline}: die Zahlungserinnerung an Acme, die Adresse für Frau Möller und der Zahnarzttermin. Für Acme und Seeblick liegen Entwürfe bereit.`;
  const briefing2Result =
    "Zwei Dinge brauchen Sie heute: Acme erinnert an die Rechnung, Lisa Hofer fragt nach dem Zahlungsstatus. Jonas Weber hat auf Ihr Angebot noch nicht geantwortet.";
  const briefing1Result = "Alles ruhig. Nur das Team-Update kam herein, keine Antwort nötig.";
  const statsResult = DEMO.statsResult;
  const invoicesMailResult =
    "Eine überfällige Rechnung: Acme GmbH, #A-2291 (1.840 €, 34 Tage). Der Erinnerungsentwurf liegt zur Freigabe bereit.";
  const invoicesTodoResult =
    "Rechnung #A-2204 an Hofer Immobilien ist bezahlt, die Erinnerung wurde verworfen. Nichts weiter offen.";
  const weeklyResult =
    "### Wochenrückblick\n\n- **Rebranding Kaffeerösterei Nord**: Angebot angenommen, Kickoff nächste Woche\n- **Acme GmbH**: Rechnung #A-2291 weiter offen\n- 3 neue Anfragen, davon 2 mit Budget über 5.000 €\n\nDie ungelesenen Mails gingen zum Wochenende zurück.";
  const followupResult =
    "Elif Aydın hat vor drei Tagen die Layout-Varianten angefragt. Der Lead steht auf 'Im Gespräch', ein Nachfass-Entwurf wäre verfrüht.";

  const statsChart: AgentCard = {
    kind: "chart",
    chartType: "bar",
    title: DEMO.chartTitle,
    points: [
      { label: "Neu", value: 8, tone: "warning" },
      { label: "Kontaktiert", value: 5, tone: "neutral" },
      { label: "Im Gespräch", value: 3, tone: "success" },
      { label: "Qualifiziert", value: 2, tone: "accent" },
      { label: "Gewonnen", value: 1, tone: "success" },
    ],
  };
  const weeklyChart: AgentCard = {
    kind: "chart",
    chartType: "line",
    title: "Ungelesene E-Mails pro Tag",
    points: [
      { label: "Mo", value: 12 },
      { label: "Di", value: 9 },
      { label: "Mi", value: 15 },
      { label: "Do", value: 7 },
      { label: "Fr", value: 4 },
    ],
  };
  const invoiceDraftCard: AgentCard = {
    kind: "email_draft",
    account: WORK_ACCOUNT,
    voiceDirectives: VOICE_DIRECTIVES,
    draft: {
      draftId: ACME_DRAFT_ID,
      threadId: "thread-acme-2291",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      to: ["t.brandt@acme-gmbh.de"],
      cc: ["buchhaltung@acme-gmbh.de"],
      body: ACME_DRAFT_BODY,
      webUrl: gmailUrl(ACME_DRAFT_ID),
      attachments: [{ filename: "Rechnung_A-2291.pdf", size: 148_213 }],
    },
  };
  const elifLeadCard: AgentCard = {
    kind: "lead",
    lead: {
      id: ELIF_LEAD_ID,
      email: "elif.aydin@brandcraft.de",
      name: DEMO.leadName,
      status: "engaged",
      priority: "A",
      language: "de",
      interest: "Rebranding für eine Kaffeerösterei, Budget ~12.000 €, Start im September.",
      persona: "Gründerin, zweite Marke",
      phone: "+49 170 5550183",
      lastInboundAt: at(5, 9, 15),
      lastOutboundAt: at(6, 16, 10),
    },
  };

  const briefingPrompt = (window: string) =>
    `Scheduled automation "${DEMO.briefingAutomation}". Report in German. Execute this instruction now and report the outcome:\n\nSieh alle Konten seit ${window} durch, ordne jede Nachricht einer Stufe zu und veröffentliche den Bericht.`;

  const briefingTools = (n: number, scanned: number): ChatToolCall[] => [
    call(
      `demo-call-b${n}-1`,
      "mail_search",
      "E-Mails durchsuchen",
      { account: WORK_ACCOUNT.name, query: "newer_than:1d", limit: 50 },
      `${Math.round(scanned * 0.7)} Nachrichten in 9 Threads`,
    ),
    call(
      `demo-call-b${n}-2`,
      "mail_search",
      "E-Mails durchsuchen",
      { account: PERSONAL_ACCOUNT.name, query: "newer_than:1d", limit: 50 },
      `${scanned - Math.round(scanned * 0.7)} Nachrichten in 5 Threads`,
    ),
    call(
      `demo-call-b${n}-3`,
      "publish_report",
      "Bericht veröffentlichen",
      { headline: "…", sections: "…" },
      "Report published.",
      { batch: 1 },
    ),
  ];

  const runs: RunRow[] = [
    {
      id: "demo-run-briefing-3",
      automationId: briefingAutomationId,
      conversationId: briefingConversationId,
      status: "success",
      result: briefing3Result,
      cards: cardsJson([card("demo-call-b3-3", latestReport)]),
      startedAt: latestBriefingStart,
      finishedAt: latestBriefingAt,
    },
    {
      id: "demo-run-briefing-2",
      automationId: briefingAutomationId,
      conversationId: briefingConversationId,
      status: "success",
      result: briefing2Result,
      cards: cardsJson([card("demo-call-b2-3", previousReport)]),
      startedAt: at(1, 7, 59),
      finishedAt: at(1, 8, 3),
    },
    {
      id: "demo-run-briefing-1",
      automationId: briefingAutomationId,
      conversationId: briefingConversationId,
      status: "success",
      result: briefing1Result,
      cards: cardsJson([card("demo-call-b1-3", quietReport)]),
      trigger: JSON.stringify({ kind: "catchUp", dueAt: at(2, 8) } satisfies RunTrigger),
      startedAt: at(2, 9, 41),
      finishedAt: at(2, 9, 43),
    },
    {
      id: "demo-run-briefing-err",
      automationId: briefingAutomationId,
      conversationId: briefingConversationId,
      status: "error",
      result: "Gmail antwortet nicht (503). Der Lauf wurde nach drei Versuchen abgebrochen.",
      startedAt: at(3, 8),
      finishedAt: at(3, 8, 4),
    },
    {
      id: "demo-run-stats",
      automationId: "demo-automation-lead-stats",
      conversationId: "automation:demo-automation-lead-stats",
      status: "success",
      result: statsResult,
      cards: cardsJson([card("demo-call-stats-2", statsChart)]),
      startedAt: hoursAgo(2.05),
      finishedAt: hoursAgo(2),
    },
    {
      id: "demo-run-invoices-mail",
      automationId: "demo-automation-invoices",
      conversationId: "automation:demo-automation-invoices",
      status: "success",
      result: invoicesMailResult,
      cards: cardsJson([card("demo-call-inv-2", invoiceDraftCard)]),
      trigger: JSON.stringify({
        kind: "mail",
        accountNames: [WORK_ACCOUNT.name],
      } satisfies RunTrigger),
      startedAt: hoursAgo(5.1),
      finishedAt: hoursAgo(5),
    },
    {
      id: "demo-run-invoices-todo",
      automationId: "demo-automation-invoices",
      conversationId: "automation:demo-automation-invoices",
      status: "success",
      result: invoicesTodoResult,
      trigger: JSON.stringify({
        kind: "todo",
        todoId: "demo-todo-done-hofer",
        title: "Zahlungseingang Hofer prüfen",
        body: "Kontoauszug vom Montag",
        answer: "Bezahlt",
      } satisfies RunTrigger),
      startedAt: at(1, 15, 12),
      finishedAt: at(1, 15, 14),
    },
    {
      id: "demo-run-weekly",
      automationId: "demo-automation-weekly",
      conversationId: "automation:demo-automation-weekly",
      status: "success",
      result: weeklyResult,
      cards: cardsJson([card("demo-call-weekly-3", weeklyChart)]),
      startedAt: at(4, 17),
      finishedAt: at(4, 17, 3),
    },
    {
      id: "demo-run-followup",
      automationId: "demo-automation-followup",
      conversationId: "automation:demo-automation-followup",
      status: "success",
      result: followupResult,
      cards: cardsJson([card("demo-call-follow-2", elifLeadCard)]),
      trigger: JSON.stringify({
        kind: "todo",
        todoId: "demo-todo-done-elif",
        title: "Elif Aydın Angebot geschickt",
        body: "",
      } satisfies RunTrigger),
      startedAt: at(3, 10, 30),
      finishedAt: at(3, 10, 31),
    },
  ];

  // ── Automation transcripts ──────────────────────────────────────────────
  const conversations: ConversationRow[] = [
    {
      id: briefingConversationId,
      title: `Run: ${DEMO.briefingAutomation}`,
      type: "automation",
      createdAt: at(3, 8),
    },
    {
      id: "automation:demo-automation-lead-stats",
      title: `Run: ${DEMO.statsAutomation}`,
      type: "automation",
      createdAt: hoursAgo(2.05),
    },
    {
      id: "automation:demo-automation-invoices",
      title: "Run: Rechnungen nachfassen",
      type: "automation",
      createdAt: at(1, 15, 12),
    },
    {
      id: "automation:demo-automation-weekly",
      title: "Run: Wochenrückblick",
      type: "automation",
      createdAt: at(4, 17),
    },
    {
      id: "automation:demo-automation-followup",
      title: "Run: Angebot nachfassen",
      type: "automation",
      createdAt: at(3, 10, 30),
    },
  ];

  const messages: MessageRow[] = [];
  const turn = (
    conversationId: string,
    key: string,
    prompt: string,
    reply: {
      content: string;
      toolCalls?: ChatToolCall[];
      cards?: MessageCard[];
      memoryIds?: string[];
      error?: string;
    },
    askedAt: string,
    answeredAt: string,
  ): void => {
    messages.push(
      {
        id: `demo-msg-${key}-u`,
        conversationId,
        role: "user",
        content: prompt,
        createdAt: askedAt,
      },
      {
        id: `demo-msg-${key}-a`,
        conversationId,
        role: "assistant",
        content: reply.content,
        cards: reply.cards ? cardsJson(reply.cards) : null,
        toolCalls: reply.toolCalls ? JSON.stringify(reply.toolCalls) : null,
        memoryIds: reply.memoryIds ? JSON.stringify(reply.memoryIds) : null,
        error: reply.error ?? null,
        createdAt: answeredAt,
      },
    );
  };

  turn(
    briefingConversationId,
    "briefing-err",
    briefingPrompt("gestern 08:00"),
    {
      content: "This turn failed: Gmail antwortet nicht (503).",
      toolCalls: [
        call(
          "demo-call-b0-1",
          "mail_search",
          "E-Mails durchsuchen",
          { account: WORK_ACCOUNT.name, query: "newer_than:1d" },
          "Gmail antwortet nicht (503)",
          { isError: true },
        ),
      ],
      error: "Gmail antwortet nicht (503)",
    },
    at(3, 8),
    at(3, 8, 4),
  );
  turn(
    briefingConversationId,
    "briefing-1",
    briefingPrompt("vorgestern 08:00"),
    {
      content: briefing1Result,
      toolCalls: briefingTools(1, 11),
      cards: [card("demo-call-b1-3", quietReport)],
    },
    at(2, 9, 41),
    at(2, 9, 43),
  );
  turn(
    briefingConversationId,
    "briefing-2",
    briefingPrompt("gestern 08:00"),
    {
      content: briefing2Result,
      toolCalls: briefingTools(2, 18),
      cards: [card("demo-call-b2-3", previousReport)],
    },
    at(1, 7, 59),
    at(1, 8, 3),
  );
  turn(
    briefingConversationId,
    "briefing-3",
    briefingPrompt("gestern 08:00"),
    {
      content: briefing3Result,
      toolCalls: briefingTools(3, 23),
      cards: [card("demo-call-b3-3", latestReport)],
      memoryIds: [DEMO.acmePage],
    },
    latestBriefingStart,
    latestBriefingAt,
  );
  turn(
    "automation:demo-automation-lead-stats",
    "stats",
    `Scheduled automation "${DEMO.statsAutomation}". Report in German. Execute this instruction now and report the outcome:\n\n${automations[0]?.instruction ?? ""}`,
    {
      content: statsResult,
      toolCalls: [
        call("demo-call-stats-1", "lead_list", "Leads auflisten", { status: null }, "19 Leads"),
        call(
          "demo-call-stats-2",
          "present_chart",
          "Diagramm zeigen",
          { chartType: "bar", title: DEMO.chartTitle },
          "Chart shown.",
          { batch: 1 },
        ),
      ],
      cards: [card("demo-call-stats-2", statsChart)],
    },
    hoursAgo(2.05),
    hoursAgo(2),
  );
  turn(
    "automation:demo-automation-invoices",
    "invoices-todo",
    `Scheduled automation "Rechnungen nachfassen". This run fired because the user completed the linked todo "Zahlungseingang Hofer prüfen". The user answered: "Bezahlt". Act on that answer.`,
    {
      content: invoicesTodoResult,
      toolCalls: [
        call(
          "demo-call-invt-1",
          "discard_draft",
          "Entwurf verwerfen",
          { account: WORK_ACCOUNT.name, draftId: "draft-hofer-2204-reminder" },
          "Draft discarded.",
        ),
      ],
    },
    at(1, 15, 12),
    at(1, 15, 14),
  );
  turn(
    "automation:demo-automation-invoices",
    "invoices-mail",
    `Scheduled automation "Rechnungen nachfassen". This run was triggered by new inbound mail in: ${WORK_ACCOUNT.name}. Execute this instruction now and report the outcome:\n\n${automations[1]?.instruction ?? ""}`,
    {
      content: invoicesMailResult,
      toolCalls: [
        call(
          "demo-call-inv-1",
          "mail_search",
          "E-Mails durchsuchen",
          { account: WORK_ACCOUNT.name, query: "Rechnung newer_than:40d" },
          "6 Nachrichten in 3 Threads",
        ),
        call(
          "demo-call-inv-2",
          "create_draft",
          "Entwurf anlegen",
          { account: WORK_ACCOUNT.name, threadId: "thread-acme-2291" },
          `Draft ${ACME_DRAFT_ID} saved.`,
          { batch: 1 },
        ),
      ],
      cards: [card("demo-call-inv-2", invoiceDraftCard)],
    },
    hoursAgo(5.1),
    hoursAgo(5),
  );
  turn(
    "automation:demo-automation-weekly",
    "weekly",
    `Scheduled automation "Wochenrückblick". Report in German. Execute this instruction now and report the outcome:\n\n${automations[2]?.instruction ?? ""}`,
    {
      content: weeklyResult,
      toolCalls: [
        call(
          "demo-call-weekly-1",
          "mail_search",
          "E-Mails durchsuchen",
          { account: WORK_ACCOUNT.name, query: "newer_than:7d" },
          "58 Nachrichten in 21 Threads",
        ),
        call("demo-call-weekly-2", "lead_list", "Leads auflisten", { status: "new" }, "3 Leads"),
        call(
          "demo-call-weekly-3",
          "present_chart",
          "Diagramm zeigen",
          { chartType: "line" },
          "Chart shown.",
          { batch: 1 },
        ),
      ],
      cards: [card("demo-call-weekly-3", weeklyChart)],
    },
    at(4, 17),
    at(4, 17, 3),
  );
  turn(
    "automation:demo-automation-followup",
    "followup",
    `Scheduled automation "Angebot nachfassen". This run fired because the user completed the linked todo "Elif Aydın Angebot geschickt". Execute this instruction now:\n\n${automations[3]?.instruction ?? ""}`,
    {
      content: followupResult,
      toolCalls: [
        call(
          "demo-call-follow-1",
          "page_read",
          "Seite lesen",
          { id: "angebot-nachfassen" },
          "Skill angebot-nachfassen (12 Zeilen)",
        ),
        call(
          "demo-call-follow-2",
          "lead_get",
          "Lead lesen",
          { email: "elif.aydin@brandcraft.de" },
          "Lead gefunden",
          { batch: 1 },
        ),
      ],
      cards: [card("demo-call-follow-2", elifLeadCard)],
      memoryIds: ["angebot-nachfassen", "elif-aydin"],
    },
    at(3, 10, 30),
    at(3, 10, 31),
  );

  // ── Chats ───────────────────────────────────────────────────────────────
  const chat = (id: string, title: string, createdAt: string, focus?: Partial<ConversationRow>) =>
    conversations.push({ id, title, type: "chat", createdAt, ...focus });

  chat("demo-chat-acme", DEMO.acmeChat, hoursAgo(3.2), {
    focusAccountId: WORK_ACCOUNT.accountId,
    focusThreadId: "thread-acme-2291",
    focusThreadSubject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
  });
  turn(
    "demo-chat-acme",
    "acme-1",
    "Hat Acme die Rechnung A-2291 inzwischen bezahlt?",
    {
      content:
        "Nein, noch nicht. Thomas Brandt hat gestern um 16:40 geantwortet und bittet **erneut um die Rechnung als PDF**, die Buchhaltung findet die erste Mail nicht.\n\n| | |\n| --- | --- |\n| Rechnung | #A-2291, 1.840 € |\n| Zahlungsziel | 30. Juni (34 Tage überfällig) |\n| Letzte Erinnerung | vor 6 Tagen |\n\nSoll ich eine Erinnerung mit der Rechnung im Anhang vorbereiten?",
      toolCalls: [
        call(
          "demo-call-acme-1",
          "mail_search",
          "E-Mails durchsuchen",
          { account: WORK_ACCOUNT.name, query: "from:acme-gmbh.de A-2291" },
          "3 Nachrichten in 1 Thread",
        ),
        call(
          "demo-call-acme-2",
          "mail_thread",
          "Thread lesen",
          { account: WORK_ACCOUNT.name, threadId: "thread-acme-2291" },
          "Thread mit 3 Nachrichten gelesen",
          { batch: 1 },
        ),
      ],
      memoryIds: [DEMO.acmePage],
    },
    hoursAgo(3.2),
    hoursAgo(3.15),
  );
  turn(
    "demo-chat-acme",
    "acme-2",
    "Ja, freundlich, aber mit Hinweis auf die Mahngebühr.",
    {
      content: "Hier ist der Entwurf. Die Rechnung hängt als PDF an, die Buchhaltung ist in Cc.",
      toolCalls: [
        call(
          "demo-call-acme-3",
          "create_draft",
          "Entwurf anlegen",
          { account: WORK_ACCOUNT.name, threadId: "thread-acme-2291" },
          "Proposal saved.",
        ),
      ],
      cards: [
        card("demo-call-acme-3", {
          kind: "email_draft",
          account: WORK_ACCOUNT,
          voiceDirectives: VOICE_DIRECTIVES,
          draft: {
            proposalId: ACME_PROPOSAL_ID,
            threadId: "thread-acme-2291",
            subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
            to: ["t.brandt@acme-gmbh.de"],
            cc: ["buchhaltung@acme-gmbh.de"],
            body: ACME_DRAFT_BODY,
            attachments: [{ filename: "Rechnung_A-2291.pdf", size: 148_213 }],
          },
        }),
      ],
    },
    hoursAgo(3.1),
    hoursAgo(3.05),
  );

  chat("demo-chat-leads", "Leads diese Woche", at(1, 11, 5));
  turn(
    "demo-chat-leads",
    "leads",
    "Wie stehen die Leads gerade?",
    {
      content:
        "19 Leads insgesamt, fünf mehr als letzte Woche. Zwei A-Leads warten auf ein Angebot, Elif Aydın ist am weitesten:",
      toolCalls: [call("demo-call-leads-1", "lead_list", "Leads auflisten", {}, "19 Leads")],
      cards: [card("demo-call-leads-2", statsChart), card("demo-call-leads-3", elifLeadCard)],
    },
    at(1, 11, 5),
    at(1, 11, 6),
  );

  chat("demo-chat-elif", "Termin mit Elif", at(2, 14, 20));
  turn(
    "demo-chat-elif",
    "elif",
    "Frag Elif per WhatsApp, ob Donnerstag 10 Uhr für die Abstimmung passt.",
    {
      content:
        "Der Entwurf wartet auf der Startseite auf Ihre Freigabe. Ich habe die Rebranding-Mappe erwähnt, die seit gestern in der Bibliothek liegt.",
      toolCalls: [
        call(
          "demo-call-elif-1",
          "whatsapp_send_message",
          "WhatsApp-Nachricht entwerfen",
          { to: "+49 170 5550183", send: false },
          `Draft ${ELIF_OUTBOUND_ID} saved for approval.`,
        ),
      ],
      cards: [
        card("demo-call-elif-1", {
          kind: "message_draft",
          channel: "whatsapp",
          targetLabel: `+49 170 5550183 (${DEMO.leadName})`,
          draftId: ELIF_OUTBOUND_ID,
          body: "Hallo Elif, die Rebranding-Mappe liegt jetzt in der Bibliothek. Passt Donnerstag 10 Uhr für die Abstimmung?",
        }),
      ],
      memoryIds: ["elif-aydin"],
    },
    at(2, 14, 20),
    at(2, 14, 21),
  );

  chat("demo-chat-research", "Verzugszinsen 2026", at(4, 9, 30));
  turn(
    "demo-chat-research",
    "research",
    "Welche Verzugszinsen darf ich Acme berechnen?",
    {
      content:
        "Für Geschäftskunden gilt § 288 Abs. 2 BGB: **Basiszinssatz plus neun Prozentpunkte**. Bei 1.840 € und 34 Tagen Verzug sind das etwa 22 €. Zusätzlich steht Ihnen eine Pauschale von 40 € zu.\n\n| Posten | Betrag |\n| --- | ---: |\n| Verzugszinsen (34 Tage) | 22,10 € |\n| Pauschale § 288 Abs. 5 | 40,00 € |\n| **Gesamt** | **62,10 €** |",
      toolCalls: [
        call(
          "demo-call-res-1",
          "web_search",
          "Im Web suchen",
          { query: "Verzugszinsen Geschäftskunden 2026 Basiszinssatz" },
          "3 Ergebnisse",
        ),
      ],
      cards: [
        card("demo-call-res-1", {
          kind: "sources",
          query: "Verzugszinsen Geschäftskunden 2026",
          items: [
            {
              url: "https://www.gesetze-im-internet.de/bgb/__288.html",
              title: "§ 288 BGB Verzugszinsen und sonstiger Verzugsschaden",
              age: "3 Jahre",
            },
            {
              url: "https://www.ihk.de/verzugszinsen-berechnen",
              title: "Verzugszinsen richtig berechnen: Basiszinssatz plus neun Punkte",
              description: "Rechenbeispiel der IHK für Forderungen zwischen Unternehmen.",
              age: "4 Monate",
            },
            {
              url: "https://www.bundesbank.de/basiszinssatz",
              title: "Basiszinssatz nach § 247 BGB",
            },
          ],
        }),
      ],
      memoryIds: [DEMO.acmePage],
    },
    at(4, 9, 30),
    at(4, 9, 31),
  );

  chat("demo-chat-memory", "Was weißt du über Acme?", at(6, 16, 45));
  turn(
    "demo-chat-memory",
    "memory-1",
    "Was weißt du über Acme? Das Zahlungsziel ist seit der letzten Rechnung 30 Tage, nicht 14.",
    {
      content:
        "Acme GmbH ist seit 2024 Kunde, Ansprechpartner ist Thomas Brandt, die Buchhaltung gehört bei Rechnungen in Cc. Das Zahlungsziel habe ich auf 30 Tage korrigiert.",
      toolCalls: [
        call(
          "demo-call-mem-1",
          "page_read",
          "Seite lesen",
          { id: DEMO.acmePage },
          "Seite acme-gmbh (8 Zeilen)",
        ),
        call(
          "demo-call-mem-2",
          "page_update",
          "Seite aktualisieren",
          { id: DEMO.acmePage },
          "Page updated.",
          { batch: 1 },
        ),
      ],
      cards: [
        card("demo-call-mem-2", {
          kind: "wiki_note",
          pageId: DEMO.acmePage,
          summary:
            "Acme GmbH, Kunde seit 2024. Ansprechpartner Thomas Brandt, Buchhaltung immer in Cc. Zahlungsziel 30 Tage.",
          pageType: "company",
          updated: true,
          diff: {
            added: 2,
            removed: 1,
            rows: [
              { op: "-", text: "Zahlungsziel 14 Tage." },
              { op: "+", text: "Zahlungsziel 30 Tage (seit Rechnung #A-2291 neu vereinbart)." },
              {
                op: "+",
                text: "Buchhaltung (buchhaltung@acme-gmbh.de) gehört bei Rechnungen in Cc.",
              },
            ],
          },
        }),
      ],
      memoryIds: [DEMO.acmePage],
    },
    at(6, 16, 45),
    at(6, 16, 46),
  );

  chat("demo-chat-attachments", "Anhänge der Acme-Mail", at(7, 10, 10), {
    focusAccountId: WORK_ACCOUNT.accountId,
  });
  turn(
    "demo-chat-attachments",
    "attachments",
    "Was hängt an der letzten Acme-Mail?",
    {
      content: "Drei Anhänge. Die Rechnung lässt sich direkt öffnen, das Angebot nur speichern.",
      toolCalls: [
        call(
          "demo-call-att-1",
          "delegate",
          "Aufgaben verteilen",
          { tasks: 3 },
          "2 erledigt, 1 fehlgeschlagen",
        ),
        call(
          "demo-call-att-2",
          "mail_attachments",
          "Anhänge auflisten",
          { account: WORK_ACCOUNT.name, messageId: "msg-acme-2291-2" },
          "3 Anhänge",
          { batch: 1 },
        ),
      ],
      cards: [
        card("demo-call-att-1", {
          kind: "delegation",
          tasks: [
            {
              label: "Acme-Thread zu Rechnung #A-2291 zusammenfassen",
              status: "done",
              elapsedMs: 9_000,
            },
            {
              label: "Zahlungsziele in den Angebots-PDFs nachschlagen",
              status: "done",
              elapsedMs: 14_000,
            },
            {
              label: "Aktuelle Verzugszinsen im Web prüfen",
              status: "failed",
              elapsedMs: 6_000,
            },
          ],
        }),
        card("demo-call-att-2", {
          kind: "attachments",
          account: WORK_ACCOUNT,
          subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
          items: [
            {
              accountId: WORK_ACCOUNT.accountId,
              messageId: "msg-acme-2291-2",
              filename: "Rechnung_A-2291.pdf",
              mimeType: "application/pdf",
              size: 148_213,
              viewable: true,
              saveable: true,
            },
            {
              accountId: WORK_ACCOUNT.accountId,
              messageId: "msg-acme-2291-2",
              filename: "Logo_Nordwind.png",
              mimeType: "image/png",
              size: 32_940,
              viewable: true,
              saveable: false,
            },
            {
              accountId: WORK_ACCOUNT.accountId,
              messageId: "msg-acme-2291-2",
              filename: "Angebot_Rebranding.docx",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              size: 21_004,
              viewable: false,
              saveable: true,
            },
          ],
        }),
      ],
    },
    at(7, 10, 10),
    at(7, 10, 11),
  );

  chat("demo-chat-form", "Zahlungserinnerung vorbereiten", at(8, 13, 0));
  turn(
    "demo-chat-form",
    "form",
    "Bereite eine Zahlungserinnerung vor.",
    {
      content: "Welche Rechnung von Acme meinen Sie? Danach brauche ich noch ein paar Angaben.",
      cards: [
        card("demo-call-form-1", {
          kind: "choices",
          question: "Welche Rechnung von Acme meinen Sie?",
          options: [
            {
              label: "Rechnung #A-2291 – Zahlungserinnerung",
              detail: "Thomas Brandt · 1.840 €",
              ref: {
                threadId: "thread-acme-2291",
                accountId: WORK_ACCOUNT.accountId,
                accountName: WORK_ACCOUNT.name,
                subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
                from: "Thomas Brandt <t.brandt@acme-gmbh.de>",
                date: at(1, 16, 40),
              },
            },
            {
              label: "Rechnung #A-2204",
              detail: "Buchhaltung Acme · 620 €",
              ref: {
                threadId: "thread-acme-2204",
                accountId: WORK_ACCOUNT.accountId,
                accountName: WORK_ACCOUNT.name,
                subject: "Acme GmbH – Rechnung #A-2204",
                from: "Buchhaltung Acme <buchhaltung@acme-gmbh.de>",
                date: at(20, 11, 2),
              },
            },
            {
              label: "Weder noch, zeig mir alle Rechnungen von Acme",
              reply: "Zeig mir alle Rechnungs-E-Mails von Acme GmbH über alle meine Konten hinweg.",
            },
          ],
        }),
        card("demo-call-form-2", {
          kind: "form",
          title: "Angaben für die Zahlungserinnerung",
          fields: [
            { name: "due", label: "Neue Frist", kind: "date", required: true },
            {
              name: "tone",
              label: "Tonfall",
              kind: "choice",
              options: ["Freundlich erinnern", "Sachlich mahnen", "Letzte Mahnung"],
              required: true,
            },
            { name: "fee", label: "Mahngebühr in Euro", kind: "number", placeholder: "0" },
            {
              name: "note",
              label: "Zusatz für den Schluss",
              kind: "long",
              placeholder: "Optional, ein bis zwei Sätze",
            },
          ],
        }),
      ],
    },
    at(8, 13, 0),
    at(8, 13, 1),
  );

  chat("demo-chat-failed", "Postfach durchsuchen", at(9, 8, 15));
  turn(
    "demo-chat-failed",
    "failed",
    "Such mir alle Mails von Weber Architekten.",
    {
      content:
        "This turn was stopped by the AI provider's rate limit. Wait a moment and send your message again, or switch providers in Settings.",
      toolCalls: [
        call(
          "demo-call-failed-1",
          "mail_search",
          "E-Mails durchsuchen",
          { account: WORK_ACCOUNT.name, query: "from:weber-architekten.de" },
          "rate_limit_error: This request would exceed your organization's rate limit",
          { isError: true },
        ),
      ],
      error: "rate_limit_error",
    },
    at(9, 8, 15),
    at(9, 8, 16),
  );

  chat("demo-chat-long", "Projektplanung Rebranding", at(10, 9, 0));
  const planning: [string, string][] = [
    [
      "Wir starten das Rebranding für die Kaffeerösterei Nord. Was brauchen wir für den Kickoff?",
      "Für den Kickoff braucht es drei Dinge: das Briefing von Laura Schmitt, die bestehenden Markenassets und einen Termin. Ich habe die Kickoff-Checkliste aus der Bibliothek zugrunde gelegt.",
    ],
    [
      "Leg ein Todo für die Assets an, Frist nächste Woche.",
      "Erledigt: „Markenassets Kaffeerösterei Nord einsammeln“ steht mit Frist auf der Startseite.",
    ],
    [
      "Wie lange dauert so ein Projekt bei uns normalerweise?",
      "Die letzten drei Rebrandings lagen zwischen sechs und neun Wochen, Logo-only Projekte bei drei. Mit zwei Feedbackrunden würde ich acht Wochen einplanen.",
    ],
    [
      "Dann planen wir acht Wochen. Halte das im Angebot fest.",
      "Das Angebot in der Bibliothek nennt jetzt acht Wochen mit zwei Feedbackrunden und Start am 15. September.",
    ],
  ];
  planning.forEach(([prompt, reply], i) => {
    turn(
      "demo-chat-long",
      `long-${i + 1}`,
      prompt,
      { content: reply },
      at(10, 9, i * 12),
      at(10, 9, i * 12 + 1),
    );
  });
  messages.push({
    id: "demo-msg-long-compaction",
    conversationId: "demo-chat-long",
    role: "compaction",
    content:
      "Zusammenfassung: Rebranding Kaffeerösterei Nord, Kickoff braucht Briefing, Assets und Termin; ein Todo für die Assets wurde angelegt.",
    compactionCutoff: Date.parse(at(10, 9, 24)),
    createdAt: at(10, 9, 26),
  });

  // ── Todos and approvals ─────────────────────────────────────────────────
  const options = (list: TodoOption[]) => JSON.stringify(list);
  const ref = (value: TodoRef) => JSON.stringify(value);
  const todos: TodoRow[] = [
    {
      id: "demo-todo-discount",
      title: DEMO.decisionQuestion,
      body: "Thomas Brandt fragt nach 10 %. Die Marge erlaubt bis 12 %.",
      dueAt: day(0),
      position: 1,
      conversationId: "demo-chat-acme",
      options: options([
        { label: DEMO.decisionAnswer },
        { label: "Nein" },
        { label: "Rückruf zuerst", detail: "Erst mit Herrn Brandt sprechen" },
      ]),
      createdAt: hoursAgo(1),
      updatedAt: hoursAgo(1),
    },
    {
      id: "demo-todo-callback",
      title: "Frau Möller zurückrufen",
      body: "Wegen der Buchungsbestätigung Seeblick, +49 4521 555 0142",
      dueAt: day(-1),
      position: 2,
      createdAt: at(2, 18),
      updatedAt: at(2, 18),
    },
    {
      id: "demo-todo-elif",
      title: "Angebot an Elif Aydın nachfassen",
      body: "- ☑ Angebot gesendet\n- ☑ Layout-Varianten angefragt\n- ☐ Rückmeldung zu den Varianten",
      dueAt: `${day(0)}T14:00:00`,
      position: 3,
      linkedAutomationId: "demo-automation-followup",
      createdAt: at(2, 9),
      updatedAt: at(2, 9),
    },
    {
      id: "demo-todo-belege",
      title: "Belege Q2 an Steuerberatung Kern",
      body: "Reisekosten und die drei Software-Rechnungen fehlen noch.",
      dueAt: day(3),
      position: 4,
      createdAt: at(2, 8, 5),
      updatedAt: at(2, 8, 5),
    },
    {
      id: "demo-todo-assets",
      title: "Markenassets Kaffeerösterei Nord einsammeln",
      body: "Logo-Dateien, Schriften, bisherige Drucksachen",
      dueAt: day(6),
      position: 5,
      conversationId: "demo-chat-long",
      createdAt: at(10, 9, 13),
      updatedAt: at(10, 9, 13),
    },
    {
      id: "demo-todo-portfolio",
      title: "Portfolio-Seite aktualisieren",
      body: "",
      position: 6,
      createdAt: at(8, 12),
      updatedAt: at(8, 12),
    },
    {
      id: "demo-todo-suggest",
      title: "Automation vorschlagen: Rechnungs-Erinnerungen",
      body: "Sie haben in drei Wochen fünf Erinnerungen von Hand geschrieben. Eine Automation könnte überfällige Rechnungen wöchentlich einsammeln und Entwürfe vorlegen.",
      position: 7,
      conversationId: "automation:demo-automation-weekly",
      createdAt: at(4, 18, 5),
      updatedAt: at(4, 18, 5),
    },
    {
      id: "demo-todo-done-hofer",
      title: "Zahlungseingang Hofer prüfen",
      body: "Kontoauszug vom Montag",
      status: "done",
      position: 8,
      linkedAutomationId: "demo-automation-invoices",
      options: options([{ label: "Bezahlt" }, { label: "Noch offen" }]),
      answer: "Bezahlt",
      createdAt: at(2, 8, 3),
      updatedAt: at(1, 15, 12),
    },
    {
      id: "demo-todo-done-elif",
      title: "Elif Aydın Angebot geschickt",
      body: "",
      status: "done",
      position: 9,
      linkedAutomationId: "demo-automation-followup",
      createdAt: at(6, 16),
      updatedAt: at(3, 10, 30),
    },
    {
      id: "demo-todo-done-domain",
      title: "Domain nordwind-studio.de verlängern",
      body: "",
      status: "done",
      position: 10,
      createdAt: at(5, 9),
      updatedAt: at(2, 11, 40),
    },
    {
      id: "demo-todo-dismissed",
      title: "Newsletter von Zalando abbestellen",
      body: "",
      status: "dismissed",
      position: 11,
      createdAt: at(6, 9),
      updatedAt: at(5, 9),
    },
    {
      id: "demo-approval-acme",
      kind: "approval",
      ref: ref({
        kind: "email_draft",
        accountId: WORK_ACCOUNT.accountId,
        account: WORK_ACCOUNT.name,
        draftId: ACME_DRAFT_ID,
        to: "Thomas Brandt <t.brandt@acme-gmbh.de>",
        webUrl: gmailUrl(ACME_DRAFT_ID),
        snippet: "Hallo Herr Brandt, anbei nochmal Rechnung #A-2291 als PDF.",
      }),
      title: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      body: "Mahngebühr erwähnen oder freundlich bleiben?",
      position: 12,
      conversationId: "automation:demo-automation-invoices",
      options: options([{ label: "So senden" }, { label: "Ohne Mahngebühr" }]),
      dedupeKey: `approval:email:${WORK_ACCOUNT.accountId}:${ACME_DRAFT_ID}`,
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(5),
    },
    {
      id: "demo-approval-seeblick",
      kind: "approval",
      ref: ref({
        kind: "email_draft",
        accountId: PERSONAL_ACCOUNT.accountId,
        account: PERSONAL_ACCOUNT.name,
        draftId: SEEBLICK_DRAFT_ID,
        to: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
        webUrl: gmailUrl(SEEBLICK_DRAFT_ID),
        snippet:
          "Hallo Frau Möller, die Adresse für die Bestätigung lautet Hafenstraße 12, 20457 Hamburg.",
      }),
      title: "Re: Ferienwohnung Seeblick – Buchung im August",
      body: "",
      position: 13,
      conversationId: briefingConversationId,
      dedupeKey: `approval:email:${PERSONAL_ACCOUNT.accountId}:${SEEBLICK_DRAFT_ID}`,
      createdAt: at(1, 8, 2),
      updatedAt: at(1, 8, 2),
    },
    {
      id: "demo-approval-elif-mail",
      kind: "approval",
      ref: ref({
        kind: "email_draft",
        accountId: WORK_ACCOUNT.accountId,
        account: WORK_ACCOUNT.name,
        draftId: ELIF_DRAFT_ID,
        to: `${DEMO.leadName} <elif.aydin@brandcraft.de>`,
        webUrl: gmailUrl(ELIF_DRAFT_ID),
        snippet: "Hallo Frau Aydın, gern zeige ich Ihnen zwei Layout-Varianten vor der Freigabe.",
      }),
      title: DEMO.waitingDraft,
      body: "",
      position: 14,
      conversationId: briefingConversationId,
      dedupeKey: `approval:email:${WORK_ACCOUNT.accountId}:${ELIF_DRAFT_ID}`,
      createdAt: at(5, 8, 4),
      updatedAt: at(5, 8, 4),
    },
    {
      id: "demo-approval-elif-whatsapp",
      kind: "approval",
      ref: ref({
        kind: "outbound",
        outboundId: ELIF_OUTBOUND_ID,
        channel: "whatsapp",
        targetLabel: DEMO.leadName,
        body: "Hallo Elif, die Rebranding-Mappe liegt jetzt in der Bibliothek. Passt Donnerstag 10 Uhr für die Abstimmung?",
      }),
      title: DEMO.leadName,
      body: DEMO.approvalQuestion,
      position: 15,
      conversationId: "demo-chat-elif",
      options: options([{ label: "So senden" }, { label: DEMO.approvalAnswer }]),
      dedupeKey: `approval:outbound:${ELIF_OUTBOUND_ID}`,
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
    },
    {
      id: "demo-approval-sent",
      kind: "approval",
      ref: ref({
        kind: "outbound",
        outboundId: "demo-outbound-sent",
        channel: "whatsapp",
        targetLabel: "Laura Schmitt",
        body: "Hallo Laura, das Angebot ist raus. Sag Bescheid, wenn Fragen offen sind.",
      }),
      title: "Laura Schmitt",
      body: "",
      status: "done",
      position: 16,
      dedupeKey: "approval:outbound:demo-outbound-sent",
      createdAt: at(3, 15),
      updatedAt: at(3, 15, 20),
    },
  ];

  const outbound: OutboundRow[] = [
    {
      id: ELIF_OUTBOUND_ID,
      channel: "whatsapp",
      target: "4917055501830@s.whatsapp.net",
      targetLabel: DEMO.leadName,
      body: "Hallo Elif, die Rebranding-Mappe liegt jetzt in der Bibliothek. Passt Donnerstag 10 Uhr für die Abstimmung?",
      conversationId: "demo-chat-elif",
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
    },
    {
      id: "demo-outbound-sent",
      channel: "whatsapp",
      target: "4915112345678@s.whatsapp.net",
      targetLabel: "Laura Schmitt",
      body: "Hallo Laura, das Angebot ist raus. Sag Bescheid, wenn Fragen offen sind.",
      status: "sent",
      sentRef: "wamid.demo-laura-1",
      createdAt: at(3, 15),
      updatedAt: at(3, 15, 20),
    },
    {
      id: "demo-outbound-discarded",
      channel: "whatsapp",
      target: "4917655501199@s.whatsapp.net",
      targetLabel: "Petra Lang",
      body: "Hallo Petra, hast du das Angebot gesehen?",
      status: "discarded",
      createdAt: at(8, 10),
      updatedAt: at(8, 10, 30),
    },
  ];

  // ── Leads ───────────────────────────────────────────────────────────────
  const lead = (
    id: string,
    name: string,
    email: string,
    status: LeadRow["status"],
    fields: Partial<LeadRow> & { daysAgo: number },
  ): LeadRow => {
    const { daysAgo, ...rest } = fields;
    return {
      id,
      name,
      email,
      status,
      accountId: WORK_ACCOUNT.accountId,
      createdAt: at(daysAgo, 10),
      updatedAt: at(Math.max(0, daysAgo - 1), 10),
      ...rest,
    };
  };
  const leads: LeadRow[] = [
    lead(ELIF_LEAD_ID, DEMO.leadName, "elif.aydin@brandcraft.de", "engaged", {
      daysAgo: 12,
      phone: "+49 170 5550183",
      interest: "Rebranding für eine Kaffeerösterei, Budget ~12.000 €, Start im September.",
      persona: "Gründerin, zweite Marke",
      priority: "A",
      language: "de",
      notes: "Will zwei Layout-Varianten vor der Freigabe. Entscheidet schnell.",
      lastInboundAt: at(5, 9, 15),
      lastOutboundAt: at(6, 16, 10),
      updatedAt: at(1, 11),
    }),
    lead("demo-lead-schmitt", "Laura Schmitt", "laura@kaffeeroesterei-nord.de", "qualified", {
      daysAgo: 9,
      phone: "+49 151 12345678",
      interest: "Komplettes Rebranding inkl. Verpackung, Angebot angenommen.",
      persona: "Inhaberin, wächst auf zwei Standorte",
      priority: "A",
      language: "de",
      notes: "Kickoff nächste Woche, acht Wochen geplant.",
      lastInboundAt: at(2, 12),
      lastOutboundAt: at(3, 15),
    }),
    lead("demo-lead-weber", DEMO.waitingOn, "jonas@weber-architekten.de", "contacted", {
      daysAgo: 8,
      interest: "Neue Website für ein Architekturbüro, sechs Seiten, CMS.",
      persona: "Partner in einem Architekturbüro",
      priority: "B",
      language: "de",
      notes: "Angebot am 29.8. geschickt, keine Antwort.",
      lastInboundAt: at(8, 9),
      lastOutboundAt: at(4, 11, 20),
    }),
    lead("demo-lead-kaya", "Deniz Kaya", "deniz@kaya-immobilien.de", "engaged", {
      daysAgo: 7,
      source: "onoffice",
      onofficeAddressId: "48213",
      phone: "+49 40 5550123",
      interest: "Exposé-Vorlagen und Logo-Refresh für ein Maklerbüro.",
      persona: "Geschäftsführer, 6 Mitarbeiter",
      priority: "A",
      language: "tr",
      notes: "Bevorzugt Telefon, spricht Türkisch und Deutsch.",
      lastInboundAt: at(1, 17, 30),
      lastOutboundAt: at(2, 10),
    }),
    lead("demo-lead-ellis", "Mark Ellis", "mark@ellis-consulting.co.uk", "new", {
      daysAgo: 1,
      interest: "Logo refresh and a one-page site, budget around 3,000 GBP.",
      persona: "Solo consultant",
      priority: "C",
      language: "en",
      lastInboundAt: at(1, 14, 5),
    }),
    lead("demo-lead-hoffmann", "Nina Hoffmann", "nina@hoffmann-yoga.de", "contacted", {
      daysAgo: 5,
      source: "manual",
      phone: "+49 176 5550177",
      interest: "Flyer und Instagram-Vorlagen für ein Yogastudio.",
      priority: "B",
      language: "de",
      lastOutboundAt: at(4, 9),
    }),
    lead("demo-lead-ruiz", "Carlos Ruiz", "carlos@ruiz-tapas.es", "new", {
      daysAgo: 0,
      interest: "Speisekarte und Schaufensterbeschriftung für ein neues Restaurant.",
      language: "es",
      lastInboundAt: hoursAgo(6),
      updatedAt: hoursAgo(6),
    }),
    lead("demo-lead-lang", "Petra Lang", "petra@lang-photography.de", "lost", {
      daysAgo: 14,
      interest: "Portfolio-Website",
      priority: "C",
      language: "de",
      notes: "Budget zu klein, hat sich für eine Baukasten-Lösung entschieden.",
      lastInboundAt: at(9, 8),
      lastOutboundAt: at(8, 10),
      updatedAt: at(8, 10, 30),
    }),
    lead("demo-lead-brandt", "Thomas Brandt", "t.brandt@acme-gmbh.de", "won", {
      daysAgo: 30,
      phone: "+49 30 5550100",
      interest: "Dashboard-Design, abgeschlossen im Juni.",
      persona: "Projektleiter, Acme GmbH",
      priority: "B",
      language: "de",
      notes: "Rechnung #A-2291 offen.",
      lastInboundAt: at(1, 16, 40),
      lastOutboundAt: at(6, 9),
      updatedAt: at(1, 17),
    }),
  ];

  // ── Drafts the agent wrote, and what became of them ─────────────────────
  const drafts: DraftRow[] = [
    {
      id: "demo-draft-acme",
      accountId: WORK_ACCOUNT.accountId,
      providerDraftId: ACME_DRAFT_ID,
      threadId: "thread-acme-2291",
      conversationId: "automation:demo-automation-invoices",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      toAddrs: JSON.stringify(["t.brandt@acme-gmbh.de"]),
      ccAddrs: JSON.stringify(["buchhaltung@acme-gmbh.de"]),
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(4),
    },
    {
      id: "demo-draft-elif",
      accountId: WORK_ACCOUNT.accountId,
      providerDraftId: ELIF_DRAFT_ID,
      threadId: "thread-rebrand-elif",
      conversationId: briefingConversationId,
      subject: "Re: Angebot Rebranding – Rückfragen",
      toAddrs: JSON.stringify(["elif.aydin@brandcraft.de"]),
      createdAt: at(5, 8, 4),
      updatedAt: at(5, 8, 4),
    },
    {
      id: "demo-draft-seeblick",
      accountId: PERSONAL_ACCOUNT.accountId,
      providerDraftId: SEEBLICK_DRAFT_ID,
      threadId: "thread-seeblick-august",
      conversationId: briefingConversationId,
      subject: "Re: Ferienwohnung Seeblick – Buchung im August",
      toAddrs: JSON.stringify(["sabine.moeller@seeblick-ferien.de"]),
      createdAt: at(1, 8, 2),
      updatedAt: at(1, 8, 2),
    },
    {
      id: "demo-draft-hofer",
      accountId: WORK_ACCOUNT.accountId,
      providerDraftId: "draft-hofer-2204-reminder",
      threadId: "thread-hofer-2204",
      conversationId: "automation:demo-automation-invoices",
      subject: "Re: Rechnung #A-2204",
      toAddrs: JSON.stringify(["l.hofer@hofer-immobilien.de"]),
      status: "discarded",
      createdAt: at(2, 9, 2),
      updatedAt: at(1, 15, 13),
    },
    {
      id: "demo-draft-schmitt",
      accountId: WORK_ACCOUNT.accountId,
      providerDraftId: "draft-schmitt-angebot",
      threadId: "thread-schmitt-angebot",
      conversationId: "demo-chat-long",
      subject: "Angebot Rebranding Kaffeerösterei Nord",
      toAddrs: JSON.stringify(["laura@kaffeeroesterei-nord.de"]),
      status: "sent",
      sentMessageId: "msg-schmitt-sent-1",
      learnedAt: at(2, 3, 5),
      createdAt: at(10, 10),
      updatedAt: at(3, 15),
    },
  ];
  const draftVersions: DraftVersionRow[] = [
    {
      draftId: "demo-draft-acme",
      version: 1,
      author: "agent",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      body: ACME_DRAFT_BODY.replace("bis Ende der Woche", "bis zum Wochenende"),
      createdAt: hoursAgo(5),
    },
    {
      draftId: "demo-draft-acme",
      version: 2,
      author: "user",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      body: ACME_DRAFT_BODY,
      createdAt: hoursAgo(4),
    },
    {
      draftId: "demo-draft-elif",
      version: 1,
      author: "agent",
      subject: "Re: Angebot Rebranding – Rückfragen",
      body: "Hallo Frau Aydın,\n\ngern zeige ich Ihnen zwei Layout-Varianten vor der Freigabe. Ich schicke sie Ihnen bis Donnerstag.\n\nBeste Grüße\nSelin Kaya",
      createdAt: at(5, 8, 4),
    },
    {
      draftId: "demo-draft-seeblick",
      version: 1,
      author: "agent",
      subject: "Re: Ferienwohnung Seeblick – Buchung im August",
      body: "Hallo Frau Möller,\n\ndie Adresse für die Bestätigung lautet Hafenstraße 12, 20457 Hamburg.\n\nViele Grüße\nSelin Kaya",
      createdAt: at(1, 8, 2),
    },
    {
      draftId: "demo-draft-hofer",
      version: 1,
      author: "agent",
      subject: "Re: Rechnung #A-2204",
      body: "Hallo Frau Hofer,\n\ndarf ich Sie an Rechnung #A-2204 erinnern?\n\nBeste Grüße\nSelin Kaya",
      createdAt: at(2, 9, 2),
    },
    {
      draftId: "demo-draft-schmitt",
      version: 1,
      author: "agent",
      subject: "Angebot Rebranding Kaffeerösterei Nord",
      body: "Hallo Frau Schmitt,\n\nanbei das Angebot für das Rebranding. Acht Wochen, zwei Feedbackrunden, Start am 15. September.\n\nBeste Grüße\nSelin Kaya",
      createdAt: at(10, 10),
    },
  ];

  const proposals: ProposalRow[] = [
    {
      id: ACME_PROPOSAL_ID,
      accountId: WORK_ACCOUNT.accountId,
      threadId: "thread-acme-2291",
      conversationId: "demo-chat-acme",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      toAddrs: JSON.stringify(["t.brandt@acme-gmbh.de"]),
      ccAddrs: JSON.stringify(["buchhaltung@acme-gmbh.de"]),
      body: ACME_DRAFT_BODY,
      createdAt: hoursAgo(3.05),
      updatedAt: hoursAgo(3.05),
    },
    {
      id: "demo-proposal-kept",
      accountId: WORK_ACCOUNT.accountId,
      threadId: "thread-rebrand-elif",
      conversationId: "demo-chat-elif",
      subject: "Re: Angebot Rebranding – Rückfragen",
      toAddrs: JSON.stringify(["elif.aydin@brandcraft.de"]),
      body: "Hallo Frau Aydın, gern zeige ich Ihnen zwei Layout-Varianten.",
      status: "kept",
      providerDraftId: ELIF_DRAFT_ID,
      createdAt: at(5, 8),
      updatedAt: at(5, 8, 4),
    },
    {
      id: "demo-proposal-discarded",
      accountId: WORK_ACCOUNT.accountId,
      threadId: "thread-weber-webseite",
      conversationId: "demo-chat-failed",
      subject: "Re: Angebot Webseite",
      toAddrs: JSON.stringify(["jonas@weber-architekten.de"]),
      body: "Hallo Herr Weber, haben Sie das Angebot erhalten?",
      status: "discarded",
      createdAt: at(9, 8, 20),
      updatedAt: at(9, 8, 25),
    },
  ];

  const learnRuns: LearnRunRow[] = [
    {
      id: "demo-learn-boot",
      reason: "boot",
      status: "ok",
      matched: 1,
      pending: 2,
      identical: 0,
      learned: 1,
      lessons: 2,
      startedAt: at(2, 3),
      finishedAt: at(2, 3, 5),
    },
    {
      id: "demo-learn-nightly",
      reason: "scheduled",
      status: "error",
      error: "Gmail antwortet nicht (503)",
      startedAt: at(1, 3),
      finishedAt: at(1, 3, 1),
    },
  ];

  // ── Wiki ────────────────────────────────────────────────────────────────
  const page = (
    id: string,
    content: string,
    fields: Partial<DemoWikiPage> & { daysAgo: number; updatedDaysAgo?: number },
  ): DemoWikiPage => {
    const { daysAgo, updatedDaysAgo, ...rest } = fields;
    return {
      id,
      type: null,
      content,
      source: "agent",
      accountId: null,
      contactId: null,
      pinned: false,
      usedCount: 0,
      lastUsedAt: null,
      createdAt: at(daysAgo, 11),
      updatedAt: at(updatedDaysAgo ?? daysAgo, 11),
      ...rest,
    };
  };
  const wiki: DemoWikiPage[] = [
    page(
      "nordwind-studio",
      `${DEMO.studio}: Design- und Branding-Studio von ${DEMO.owner} in Hamburg. Zwei Personen, Schwerpunkt Rebranding, Websites und Drucksachen für kleine Unternehmen.\n\nAdresse: Hafenstraße 12, 20457 Hamburg.\nRechnungen gehen immer als PDF mit 30 Tagen Zahlungsziel raus, Mahngebühr 40 € ab der zweiten Erinnerung.\nStundensatz 95 €, Rebranding-Pakete ab 8.000 €.\nSteuerberatung: Kanzlei Kern, Belege quartalsweise bis zum 10. des Folgemonats.`,
      { daysAgo: 30, type: "company", source: "user", pinned: true, usedCount: 31 },
    ),
    page(
      DEMO.acmePage,
      "Acme GmbH, Kunde seit 2024. Ansprechpartner Thomas Brandt, Buchhaltung immer in Cc. Zahlungsziel 30 Tage.\n\nProjekt 2026: Dashboard-Design, abgeschlossen im Juni, Rechnung #A-2291 über 1.840 € noch offen.\nZahlungsziel 30 Tage (seit Rechnung #A-2291 neu vereinbart).\nBuchhaltung (buchhaltung@acme-gmbh.de) gehört bei Rechnungen in Cc.\nThomas Brandt antwortet meist nachmittags, mag knappe Mails.",
      { daysAgo: 20, updatedDaysAgo: 6, type: "company", usedCount: 4, lastUsedAt: hoursAgo(3) },
    ),
    page(
      "elif-aydin",
      "Elif Aydın, Gründerin von Brandcraft, plant ein Rebranding für ihre Kaffeerösterei. Budget rund 12.000 €, Start im September.\n\nWill vor der Freigabe zwei Layout-Varianten sehen.\nErreichbar per WhatsApp unter +49 170 5550183, antwortet dort schneller als per Mail.\nDuzt sich mit Selin seit dem ersten Call.",
      {
        daysAgo: 12,
        updatedDaysAgo: 2,
        type: "person",
        contactId: "elif.aydin@brandcraft.de",
        usedCount: 7,
        lastUsedAt: at(2, 14, 21),
      },
    ),
    page(
      "schreibstil-arbeitskonto",
      "Schreibstil im Arbeitskonto: kurz, freundlich, konkret.\n\n- Grüßt Kunden mit 'Hallo Herr/Frau <Nachname>', das Team nur mit 'Hi'.\n- Hält Mails kurz, selten mehr als vier Sätze.\n- Nennt Beträge und Fristen immer konkret.\n- Bietet bei offenen Fragen einen kurzen Call an.\n- Schließt mit 'Beste Grüße' und der Studio-Signatur.",
      { daysAgo: 25, accountId: WORK_ACCOUNT.accountId, usedCount: 18, lastUsedAt: hoursAgo(5) },
    ),
    page(
      "email-schreibstil",
      "Antwortet auf Kundenmails im Stil des Studios: Anrede, ein Satz Kontext, die Antwort, ein konkreter nächster Schritt.\n\nSchritte:\n1. Den letzten Stand des Threads lesen, nie aus dem Gedächtnis antworten.\n2. Mit 'Hallo Herr/Frau <Nachname>' beginnen, bei Du-Kontakten mit dem Vornamen.\n3. Höchstens vier Sätze. Beträge, Daten und Fristen ausschreiben.\n4. Mit einer Frage oder einem Terminvorschlag enden, nie mit 'Melden Sie sich gern'.\n5. Keine Signatur schreiben, die hängt das Konto an.",
      { daysAgo: 25, type: "skill", source: "user", usedCount: 22, lastUsedAt: hoursAgo(5) },
    ),
    page(
      "angebot-nachfassen",
      "Fasst ein offenes Angebot bei einem Lead nach: Stand prüfen, erst nach fünf Tagen Funkstille schreiben, freundlich und ohne Druck.\n\nAblauf:\n1. Lead lesen (lead_get) und die letzte Nachricht im Thread prüfen.\n2. Liegt die letzte Nachricht vom Lead weniger als fünf Tage zurück: nichts tun, kurz berichten.\n3. Sonst einen Entwurf auf dem Thread anlegen: Bezug auf das Angebot, eine konkrete Frage, ein Terminvorschlag.\n4. Lead-Status auf 'contacted' setzen und lastOutboundAt aktualisieren.\n5. Bei WhatsApp-Kontakten zusätzlich eine kurze Nachricht entwerfen, nie senden.",
      { daysAgo: 6, type: "skill", source: "user", usedCount: 3, lastUsedAt: at(3, 10, 31) },
    ),
    page(
      "dr-yildiz-zahnarzt",
      "Zahnarztpraxis Dr. Yıldız, Altona. Termine werden per Mail bestätigt, Absagen bis 24 Stunden vorher kostenlos.",
      { daysAgo: 15, type: "person", accountId: PERSONAL_ACCOUNT.accountId, usedCount: 1 },
    ),
    page(
      "wartungsfenster-statusseite",
      "Das Wartungsfenster der Statusseite ist samstags 02:00 bis 04:00. Kunden vorher nicht auf die Seite verweisen.",
      { daysAgo: 3, source: "user" },
    ),
  ];

  // ── Knowledge documents ─────────────────────────────────────────────────
  const knowledge: DemoFile[] = [
    {
      path: "Angebote/Angebot_Rebranding_Kaffeeroesterei_Nord.md",
      modifiedAt: at(3, 14),
      data: `# Angebot Rebranding Kaffeerösterei Nord\n\n**Kundin:** Laura Schmitt\n**Datum:** ${new Date(at(10, 10)).toLocaleDateString("de-DE")}\n\n## Umfang\n\n- Markenkern und Positionierung (Workshop, halber Tag)\n- Logo, Farbwelt, Typografie\n- Verpackung für drei Sorten\n- Basis-Website mit vier Seiten\n\n## Ablauf\n\nAcht Wochen mit zwei Feedbackrunden, Start am 15. September.\n\n## Preis\n\n| Position | Betrag |\n| --- | ---: |\n| Marke und Logo | 6.500 € |\n| Verpackung | 3.200 € |\n| Website | 2.800 € |\n| **Gesamt (netto)** | **12.500 €** |\n\nZahlungsziel 30 Tage, 40 % bei Auftrag, 60 % bei Abnahme.\n`,
    },
    {
      path: "Rechnungen/Rechnung_A-2291.txt",
      modifiedAt: at(40, 9),
      data: `Rechnung #A-2291\nNordwind Studio, Hafenstraße 12, 20457 Hamburg\n\nAn: Acme GmbH, z. Hd. Thomas Brandt\nDatum: 31. Mai\nLeistung: Dashboard-Design, 16 Stunden à 95 €\n\nNetto 1.520,00 €\nUSt 19 % 288,80 €\nBrutto 1.808,80 €\n\nZahlungsziel: 30. Juni\n`,
    },
    {
      path: "Rechnungen/Rechnung_A-2204.pdf",
      modifiedAt: at(60, 9),
      data: pdf([
        "Rechnung #A-2204",
        "Nordwind Studio, Hafenstrasse 12, 20457 Hamburg",
        "",
        "An: Hofer Immobilien, z. Hd. Lisa Hofer",
        "Leistung: Expose-Vorlagen, 6 Stunden a 95 EUR",
        "",
        "Netto 570,00 EUR",
        "USt 19 % 108,30 EUR",
        "Brutto 678,30 EUR",
        "",
        "Zahlungsziel: 30 Tage",
      ]),
    },
    {
      path: "Preisliste.csv",
      modifiedAt: at(45, 9),
      data: "Leistung;Einheit;Preis netto\nStundensatz Design;Stunde;95 €\nLogo-Refresh;Paket;2.400 €\nRebranding klein;Paket;8.000 €\nRebranding komplett;Paket;12.500 €\nWebsite bis 6 Seiten;Paket;4.800 €\nDrucksachen;nach Aufwand;95 €/h\n",
    },
    {
      path: "AGB_Nordwind.html",
      modifiedAt: at(90, 9),
      data: '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>AGB Nordwind Studio</title></head><body><h1>Allgemeine Geschäftsbedingungen</h1><h2>1. Geltung</h2><p>Diese Bedingungen gelten für alle Aufträge an Nordwind Studio.</p><h2>2. Zahlung</h2><p>Rechnungen sind innerhalb von 30 Tagen ohne Abzug zu zahlen. Ab der zweiten Erinnerung berechnen wir eine Mahngebühr von 40 €.</p><h2>3. Nutzungsrechte</h2><p>Nutzungsrechte gehen mit vollständiger Zahlung über.</p></body></html>',
    },
    {
      path: "Vorlagen/Kickoff-Checkliste.md",
      modifiedAt: at(20, 9),
      data: "# Kickoff-Checkliste\n\n- [ ] Briefing vom Kunden (Ziele, Zielgruppe, Wettbewerber)\n- [ ] Bestehende Markenassets einsammeln\n- [ ] Zeitplan mit zwei Feedbackrunden abstimmen\n- [ ] Ansprechpartner und Entscheider klären\n- [ ] Angebot unterschrieben, Anzahlung eingegangen\n",
    },
    {
      path: "Logo_Nordwind.svg",
      modifiedAt: at(80, 9),
      data: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#1e3a5f"/><path d="M16 44 L32 16 L48 44 Z" fill="#fff"/></svg>',
    },
  ];

  return {
    automations,
    runs,
    reportItems,
    conversations,
    messages,
    todos,
    outbound,
    leads,
    drafts,
    draftVersions,
    proposals,
    learnRuns,
    seenKeys: ["run:demo-run-briefing-2", "todo:demo-todo-belege"],
    seenFloor: at(3, 0),
    accountColors: [
      { accountId: WORK_ACCOUNT.accountId, hex: "#2563eb" },
      { accountId: PERSONAL_ACCOUNT.accountId, hex: "#16a34a" },
    ],
    wiki,
    knowledge,
  };
}
