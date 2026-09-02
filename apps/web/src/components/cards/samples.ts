import type { AgentCard, CardAccount, ReportItem } from "@marlen/shared";

/**
 * Sample data for the `/showcase` chat command. It includes one turn for each
 * renderable chat result: tool-activity chips, all card types, a formatted
 * markdown reply, and the thinking shimmer.
 *
 * Email content is written in a consistent sample persona's voice: Selin
 * Kaya, Nordwind Studio co-founder, juggling a billing dispute with Acme
 * GmbH on her work inbox and a holiday booking on her personal one.
 * Commentary between samples is localized via `contentKey`. Leaving `imgSrc`
 * unset also exercises AccountChip's icon fallback.
 */

export type ShowcaseTurn = {
  /** i18n key for UI-language commentary; wins over `content`. */
  contentKey?: string;
  /** Literal sample content (sample-persona German). */
  content?: string;
  toolCalls?: {
    name: string;
    label?: string;
    isError: boolean;
    done: boolean;
    result?: string;
  }[];
  cards?: AgentCard[];
  /** Renders the streaming "thinking…" state. */
  thinking?: boolean;
  /** Renders a turn the user stopped: the "stopped" mark and the way on. */
  stopped?: boolean;
};

const WORK_ACCOUNT: CardAccount = {
  accountId: "demo-work",
  name: "selin@nordwind-studio.de",
  app: "gmail",
  appName: "Gmail",
};

const PERSONAL_ACCOUNT: CardAccount = {
  accountId: "demo-personal",
  name: "selin.kaya.mail@gmail.com",
  app: "gmail",
  appName: "Gmail",
};

const DRAFT_CARD: AgentCard = {
  kind: "email_draft",
  account: WORK_ACCOUNT,
  voiceDirectives: [
    "Grüßt Kunden mit 'Hallo Herr/Frau <Nachname>', das Team nur mit 'Hi'.",
    "Hält Mails kurz, selten mehr als vier Sätze.",
    "Schließt mit 'Beste Grüße' und der Studio-Signatur.",
  ],
  draft: {
    draftId: "draft-acme-2291-reply",
    threadId: "thread-acme-2291",
    subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
    to: ["t.brandt@acme-gmbh.de"],
    cc: ["buchhaltung@acme-gmbh.de"],
    body: "Hallo Herr Brandt,\n\nanbei nochmal Rechnung #A-2291 als PDF. Unser Zahlungsziel war der 30. Juni. Bitte gleichen Sie den Betrag bis Ende der Woche aus, sonst müssen wir eine Mahngebühr berechnen.\n\nBeste Grüße\nSelin Kaya\nNordwind Studio — Design & Branding\nnordwind-studio.de",
    webUrl:
      "https://mail.google.com/mail/?authuser=selin%40nordwind-studio.de#drafts?compose=draft-acme-2291-reply",
  },
};

/** A message's attachments on the Acme invoice thread from DRAFT_CARD:
 *  a viewable+saveable PDF, a viewable-only image, and a saveable-only Word doc,
 *  so every row-action branch (open vs download) is exercised. */
const ATTACHMENTS_CARD: AgentCard = {
  kind: "attachments",
  account: WORK_ACCOUNT,
  subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
  items: [
    {
      accountId: "demo-work",
      messageId: "msg-acme-2291-2",
      filename: "Rechnung_A-2291.pdf",
      mimeType: "application/pdf",
      size: 148_213,
      viewable: true,
      saveable: true,
    },
    {
      accountId: "demo-work",
      messageId: "msg-acme-2291-2",
      filename: "Logo_Nordwind.png",
      mimeType: "image/png",
      size: 32_940,
      viewable: true,
      saveable: false,
    },
    {
      accountId: "demo-work",
      messageId: "msg-acme-2291-2",
      filename: "Angebot_Rebranding.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 21_004,
      viewable: false,
      saveable: true,
    },
  ],
};

/** The morning report, flat and cross-account, mixing the work and personal
 *  demo inboxes so the sections-first layout has something to prove. Reuses
 *  the Acme thread/draft ids from DRAFT_CARD, so the "Review draft"/"Ask
 *  about this" quick actions land on the same demo data that card shows. */
function emailItem(
  threadId: string,
  accountId: string,
  sender: string,
  title: string,
  gist: string,
  extra: Partial<ReportItem> & { senderEmail?: string; webUrl?: string } = {},
): ReportItem {
  const { senderEmail, webUrl, ...rest } = extra;
  return {
    key: `email:${accountId}\n${threadId}`,
    ref: {
      kind: "email",
      accountId,
      threadId,
      sender,
      ...(senderEmail ? { senderEmail } : {}),
      ...(webUrl ? { webUrl } : {}),
    },
    title,
    gist,
    ...rest,
  };
}

const REPORT_CARD: AgentCard = {
  kind: "report",
  headline: "Zwei Dinge brauchen dich heute.",
  periodLabel: "seit gestern Morgen",
  accounts: [WORK_ACCOUNT, PERSONAL_ACCOUNT],
  scanned: 43,
  sections: [
    {
      label: "Dringend",
      items: [
        emailItem(
          "thread-acme-2291",
          "demo-work",
          "Thomas Brandt",
          "Re: Rechnung #A-2291 – Zahlungserinnerung",
          "Bittet erneut um die Rechnung als PDF, sonst folgt eine Mahngebühr.",
          {
            senderEmail: "t.brandt@acme-gmbh.de",
            needsUser: true,
            deadline: "Freitag 17:00",
            draftId: "draft-acme-2291-reply",
            change: "updated",
          },
        ),
      ],
    },
    {
      label: "Antwort ausstehend",
      items: [
        emailItem(
          "thread-seeblick-august",
          "demo-personal",
          "Sabine Möller",
          "Ferienwohnung Seeblick – Buchung im August",
          "Fragt nach der Adresse für die Buchungsbestätigung.",
          { senderEmail: "sabine.moeller@seeblick-ferien.de", needsUser: true, change: "new" },
        ),
        emailItem(
          "thread-rebrand-elif",
          "demo-work",
          "Elif Aydın",
          "Angebot Rebranding – Rückfragen",
          "Möchte vor der Freigabe zwei Layout-Varianten sehen.",
          { needsUser: true, change: "carried", since: "2026-07-06T08:00:00.000Z" },
        ),
      ],
    },
    {
      label: "Zu tun",
      items: [
        emailItem(
          "thread-zahnarzt",
          "demo-personal",
          "Zahnarztpraxis Dr. Yıldız",
          "Terminerinnerung nächste Woche",
          "Termin muss bis Mittwoch bestätigt oder abgesagt werden.",
          { needsUser: true, deadline: "Mittwoch", change: "new" },
        ),
        {
          key: "title:Exposé Seestraße 4",
          ref: { kind: "none" },
          title: "Exposé Seestraße 4",
          gist: "Fehlt noch für den Versand an drei Interessenten.",
          needsUser: true,
          change: "carried",
          since: "2026-07-05T08:00:00.000Z",
        },
      ],
    },
    {
      label: "Zur Kenntnis",
      collapsed: true,
      items: [
        emailItem(
          "thread-team-update",
          "demo-work",
          "Team Nordwind",
          "Wöchentliches Update",
          "Kurzer Statusbericht, keine Rückmeldung nötig.",
        ),
        emailItem(
          "thread-fitzone-hours",
          "demo-personal",
          "FitZone Studio",
          "Neue Öffnungszeiten ab August",
          "Reine Information, keine Handlung nötig.",
        ),
        {
          key: "url:https://status.nordwind-studio.de",
          ref: { kind: "url", url: "https://status.nordwind-studio.de" },
          title: "Statusseite Nordwind",
          gist: "Wartungsfenster Samstag 02:00 bis 04:00.",
        },
      ],
    },
    {
      label: "Newsletter & Angebote",
      collapsed: true,
      items: [
        emailItem(
          "roll-zalando",
          "demo-work",
          "Zalando",
          "-20% auf Sneaker – nur bis Sonntag",
          "Rabattaktion, keine Handlung nötig.",
          { webUrl: "https://mail.google.com/mail/#all/roll-zalando" },
        ),
        emailItem(
          "roll-duolingo",
          "demo-personal",
          "Duolingo",
          "Vergiss deinen Streak nicht!",
          "Erinnerung, heute zu üben.",
        ),
        emailItem(
          "roll-spotify",
          "demo-work",
          "Spotify",
          "Dein Wochenmix ist da",
          "Neue Playlist-Empfehlungen.",
        ),
      ],
    },
    {
      label: "Quittungen",
      collapsed: true,
      items: [
        emailItem(
          "roll-apple",
          "demo-personal",
          "Apple",
          "Deine Rechnung von Apple",
          "iCloud+ 0,99 € abgebucht.",
        ),
        emailItem(
          "roll-amazon",
          "demo-personal",
          "Amazon.de",
          "Deine Bestellung wurde versandt",
          "Paket kommt voraussichtlich Dienstag.",
        ),
      ],
    },
  ],
};

/** A clarifying question the agent asks when a request is ambiguous, one
 *  option per candidate email plus a third that opts out of both, reusing
 *  the Acme invoice thread id from DRAFT_CARD so its ref points at real
 *  demo data. */
const CHOICES_CARD: AgentCard = {
  kind: "choices",
  question: "Welche Rechnung von Acme meinst du?",
  options: [
    {
      label: "Rechnung #A-2291 – Zahlungserinnerung",
      detail: "Thomas Brandt · 8. Juli",
      ref: {
        threadId: "thread-acme-2291",
        accountId: "demo-work",
        accountName: "selin@nordwind-studio.de",
        subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
        from: "Thomas Brandt <t.brandt@acme-gmbh.de>",
        date: "2026-07-08T09:14:00.000Z",
      },
    },
    {
      label: "Rechnung #A-2204",
      detail: "Buchhaltung Acme · 14. Juni",
      ref: {
        threadId: "thread-acme-2204",
        accountId: "demo-work",
        accountName: "selin@nordwind-studio.de",
        subject: "Acme GmbH – Rechnung #A-2204",
        from: "Buchhaltung Acme <buchhaltung@acme-gmbh.de>",
        date: "2026-06-14T11:02:00.000Z",
      },
    },
    {
      label: "Weder noch — zeig mir alle Rechnungen von Acme",
      reply: "Zeig mir alle Rechnungs-E-Mails von Acme GmbH über alle meine Konten hinweg.",
    },
  ],
};

/** A lead connected to the Elif Aydın report sample. */
const LEAD_CARD: AgentCard = {
  kind: "lead",
  lead: {
    id: "lead-demo-elif",
    email: "elif.aydin@brandcraft.de",
    name: "Elif Aydın",
    status: "engaged",
    priority: "A",
    language: "de",
    interest: "Rebranding für eine Kaffeerösterei, Budget ~12.000 €, Start im September.",
    persona: "Gründerin, zweite Marke",
    phone: "+49 151 2345678",
    lastInboundAt: "2026-07-19T08:40:00.000Z",
    lastOutboundAt: "2026-07-18T16:10:00.000Z",
  },
};

/** Two charts of the demo data: a toned bar breakdown and a plain line trend, so
 *  both chart shapes render. */
const CHART_BAR_CARD: AgentCard = {
  kind: "chart",
  chartType: "bar",
  title: "Leads nach Status",
  points: [
    { label: "Neu", value: 8, tone: "warning" },
    { label: "Kontaktiert", value: 5, tone: "neutral" },
    { label: "Im Gespräch", value: 3, tone: "success" },
    { label: "Qualifiziert", value: 2, tone: "accent" },
    { label: "Gewonnen", value: 1, tone: "success" },
  ],
};

const CHART_LINE_CARD: AgentCard = {
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

/** The delegate fan-out mid-flight: settled, failed, running and queued lanes,
 *  so every mark renders, including the live spinner. */
const DELEGATION_CARD: AgentCard = {
  kind: "delegation",
  tasks: [
    {
      label: "Acme-Thread zu Rechnung #A-2291 zusammenfassen (Konto Arbeit)",
      status: "done",
      elapsedMs: 9_000,
    },
    {
      label: "Zahlungsziele in den Angebots-PDFs der Bibliothek nachschlagen",
      status: "done",
      elapsedMs: 14_000,
    },
    {
      label: "Aktuelle Verzugszinsen für Geschäftskunden im Web prüfen",
      status: "failed",
      elapsedMs: 6_000,
    },
    { label: "Letzte Mails von Elif Aydın zum Rebranding durchsehen", status: "running" },
    { label: "Offene Entwürfe im Arbeitskonto auflisten", status: "pending" },
  ],
};

const MESSAGE_DRAFT_CARD: AgentCard = {
  kind: "message_draft",
  channel: "whatsapp",
  targetLabel: "+49 170 5550183 (Elif Aydın)",
  draftId: "wa-draft-elif-rebranding",
  body: "Hallo Elif, die Rebranding-Mappe liegt jetzt in der Bibliothek. Passt Donnerstag 10 Uhr für die Abstimmung?",
};

/** What a web answer stood on, including a result with an age. */
const SOURCES_CARD: AgentCard = {
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
      age: "4 Monate",
    },
    {
      url: "https://www.bundesbank.de/basiszinssatz",
      title: "Basiszinssatz nach § 247 BGB",
    },
  ],
};

/** A rewritten page: the chip carries what the rewrite changed. */
const WIKI_NOTE_CARD: AgentCard = {
  kind: "wiki_note",
  pageId: "acme-gmbh",
  summary:
    "Acme GmbH, Kunde seit 2024. Ansprechpartner Thomas Brandt, Buchhaltung immer in Cc. Zahlungsziel 30 Tage.",
  updated: true,
  diff: {
    added: 2,
    removed: 1,
    rows: [
      { op: "-", text: "Zahlungsziel 14 Tage." },
      { op: "+", text: "Zahlungsziel 30 Tage (seit Rechnung #A-2291 neu vereinbart)." },
      { op: "+", text: "Buchhaltung (buchhaltung@acme-gmbh.de) gehört bei Rechnungen in Cc." },
    ],
  },
};

/** The several-things-at-once question: one field of every kind. */
const FORM_CARD: AgentCard = {
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
};

/** A digest-style reply exercising the markdown vocabulary: heading, bold, mailto, list, table, link. */
const MARKDOWN_SAMPLE = `### Was heute wichtig ist

**Acme GmbH** hat auf die Zahlungserinnerung geantwortet, Thomas Brandt ([t.brandt@acme-gmbh.de](mailto:t.brandt@acme-gmbh.de)) bittet um die Rechnung als PDF.

- Antwortentwurf liegt in deinem Postfach bereit
- Buchhaltung ist in Cc
- Zahlungsziel war der 30. Juni

| Konto | Ungelesen | Entwürfe |
| --- | ---: | ---: |
| Arbeit | 4 | 1 |
| Privat | 2 | 1 |

Mehr Kontext steht auf [nordwind-studio.de](https://nordwind-studio.de).`;

export const SHOWCASE_TURNS: ShowcaseTurn[] = [
  { contentKey: "chat.showcase.intro" },
  {
    contentKey: "chat.showcase.toolsNote",
    toolCalls: [
      { name: "gmail-find-email", isError: false, done: true },
      { name: "outlook-list-drafts", isError: false, done: false },
      { name: "notion-search-pages", isError: true, done: true },
    ],
  },
  {
    contentKey: "chat.showcase.toolsDone",
    toolCalls: [
      { name: "gmail-find-email", isError: false, done: true },
      { name: "gmail-get-thread", isError: false, done: true },
      { name: "outlook-list-drafts", isError: false, done: true },
      { name: "notion-search-pages", isError: true, done: true },
      { name: "gmail-create-draft", isError: false, done: true },
    ],
  },
  {
    contentKey: "chat.showcase.stoppedNote",
    stopped: true,
    toolCalls: [
      {
        name: "gmail-find-email",
        label: "E-Mails durchsuchen",
        isError: true,
        done: true,
        result: "Gmail antwortet nicht (503)",
      },
      {
        name: "gmail-find-email",
        label: "E-Mails durchsuchen",
        isError: true,
        done: true,
        result: "Gmail antwortet nicht (503)",
      },
    ],
  },
  { cards: [DRAFT_CARD] },
  { cards: [MESSAGE_DRAFT_CARD] },
  { cards: [DELEGATION_CARD] },
  { cards: [ATTACHMENTS_CARD] },
  { cards: [REPORT_CARD] },
  { cards: [CHOICES_CARD] },
  { cards: [LEAD_CARD] },
  { cards: [CHART_BAR_CARD, CHART_LINE_CARD] },
  { contentKey: "chat.showcase.sourcesNote", cards: [SOURCES_CARD] },
  { contentKey: "chat.showcase.savedNote", cards: [WIKI_NOTE_CARD] },
  { contentKey: "chat.showcase.formNote", cards: [FORM_CARD] },
  { content: MARKDOWN_SAMPLE },
  { thinking: true },
];
