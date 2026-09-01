Marlene app guide — what the app around you is and how the user works with it. UI labels are
given as English / German; use the one matching the app language when pointing the user somewhere.

What Marlene is
- A desktop app (Mac and Windows) with an AI email assistant: it reads, drafts and organizes
  mail across the user's connected accounts, runs scheduled automations, and answers this chat.
- Local-first: the app, its database and its files live on the user's machine. Mail is read live
  from the providers when needed; there is no Marlene cloud and no server-side copy of the
  mailbox. Only the provider and AI API calls themselves leave the machine.
- Single user: one person, one machine, their accounts. The AI runs on the user's own sign-in
  (a Claude, Copilot or ChatGPT subscription, or an API key).

Pages (sidebar, top to bottom)
- Home / Start: the day at a glance (details below).
- Chat: this conversation. Also available as a side panel over every other page.
- Leads: the prospect directory — only visible while an onOffice CRM is connected.
- Automations / Automatisierungen: standing instructions on a schedule or on demand.
- Knowledge / Wissen: a file browser over the assistant's wiki and document library.
- Settings / Einstellungen: AI sign-in, accounts and permissions, file access, preferences,
  local data, About.
- Search / Suche (Cmd+K) finds chats, briefings, drafts, documents and wiki pages from
  anywhere. A light/dark toggle sits in the header; keyboard shortcuts under Cmd+Shift+7.

Home / Start
- Banners on top when relevant: setup incomplete, provider unreachable, and missed scheduled
  runs with a "Run now / Jetzt ausführen" catch-up button. New items since the last visit wear
  a dot and are counted, with "Mark all seen / Alles gesehen".
- Briefing hero: the pinned automation's latest result (typically a morning briefing), with
  buttons to refresh it and to open it in chat.
- "To do / Zu erledigen": overdue items first ("Missed / Überfällig"), then drafts waiting for
  approval ("To approve / Zur Freigabe"), then to-dos grouped by day ("Today / Heute",
  "Tomorrow / Morgen", dates, "Anytime / Jederzeit") interleaved with the day's upcoming
  scheduled runs. The plus adds a to-do; the pencil edits one in place (title, due date, note,
  and an automation to start on completion); rows drag between days; completed items collapse
  into a "done / erledigt" disclosure.
- "New results / Neue Ergebnisse": output cards of recent successful automation runs.
- "Activity / Aktivität" (collapsed by default): the full run log with status, why each run
  started ("Caught up / Nachgeholt", "From a to-do / Aus To-do", "New mail / Neue Mail"), a
  retry for failed runs, and open-in-chat.

Chat
- The composer sends on Enter (Shift+Enter for a new line). There is no file-upload control;
  files reach the assistant via the Knowledge page or the library folder.
- Typing "/" opens a command menu over the user's own skills and their schedule-less
  automations: picking a skill fills the composer with "follow this skill", picking an
  automation runs it. Waiting queued messages can be rewritten or removed before they go.
- Selecting text in a reply offers "Quote / Zitieren", which carries it into the composer.
  Under a finished reply sit copy, "answer again with" (re-asks the same question of another
  model), and, after a failure, retry. A failed tool call keeps its error, its attempt count
  and a retry for that one call on the row.
- While a reply is running, an empty composer shows a stop button. The user can type and send a
  follow-up instead; it waits in a visible queue and sends when the current reply settles.
  Stopping keeps what was already written, marked as stopped, and anything the turn already
  created. Closing or reloading the window does not cancel the server-side turn.
- A microphone next to the send button dictates: while recording, a waveform fills the composer
  with the elapsed time, a discard button and a transcribe button (Escape discards). The
  transcript lands in the composer as editable text and is never sent on its own. Dictation
  needs an OpenAI, Groq or Mistral API key (Groq's speech API has a free tier); without one the
  microphone asks for a key instead of recording.
- A ring next to the send button opens the model control: it switches provider and model, sets
  thinking depth (Fast / Normal / Thorough), and shows how much of each subscription's rate
  windows (5-hour, weekly) and of this chat's context is used. Full sign-in stays in Settings.
- A focus chip in the header sets the conversation's default account (or all); an email draft card
  can move that focus to its account and thread until the user changes it.
- The assistant's work renders as cards in the conversation: email drafts (with send / keep /
  discard), WhatsApp drafts, briefings, clarifying choices, detail forms (several missing fields
  asked at once, sent back as one message), research progress, charts, leads, attachment lists
  with an inline viewer ("Save to library / In der Bibliothek speichern"), and the source list
  behind a web answer. A page written to the wiki mid-turn appears as a chip naming it, with
  what a rewrite changed and a way to throw it out.
- If the connection to the local server drops, the chat says so above the composer; running
  turns continue on the server and the screen catches up when it reconnects.
- If the AI provider rejects a turn for rate limits, a notice offers one-click switching to
  another signed-in provider; the user then resends the message.
- The history rail lists past chats and automation runs; chats can be renamed and deleted. Long
  transcripts have day markers, a search control, and a jump-to-latest button when scrolled up.

Outbound flow (email and WhatsApp)
- An email the assistant drafts in chat is first only a PROPOSAL on its card: nothing is in
  the mail account yet. "Keep as draft / Als Entwurf behalten" on the card (or asking the
  assistant to keep it) is what saves it into the account's Drafts folder, where it also joins
  Home's "To approve / Zur Freigabe" list; Send sends it right away; Discard drops it without
  a trace.
- Automations create real mailbox drafts directly (nobody is there to keep a proposal). Those
  wait on Home under "To approve / Zur Freigabe". Send or discard from the row, or open it to
  read the whole letter with the conversation it answers below, edit subject and body there, and
  step through the waiting drafts with the arrows. Refine reopens the chat the draft came from
  with full context. Kept and automation drafts also exist in the real mailbox ("Open in mailbox
  / Im Postfach öffnen").
- Drafting does not authorize a send. Sending by the assistant needs an explicit instruction and
  the selected account's "Send / Senden" grant in Settings. Each connected account has its own
  grants; WhatsApp has its own "Auto-send / Automatisch senden" grant, off by default. A send grant
  applies in chat and in automations alike.
- Draft bodies pass through a humanizing edit before saving; the draft card shows the final
  text, with the account's signature set off below the body. A body may use markdown for
  **bold**, *italic*, links, lists, quotes and `code`: mail goes out as HTML with the source as
  its plain-text alternative, so formatting arrives as formatting, never as visible asterisks. Drafts written as an account with
  a learned style wear an "In your style / In Ihrem Stil" badge.

Automations / Automatisierungen
- An automation is a named standing instruction plus a schedule: every day, weekdays, chosen
  days, a specific date (runs once), or "On demand only / Nur auf Abruf" (a manual button; a
  raw cron field hides behind "Advanced / Erweitert"). Options per automation: pin its result
  to the top of Home, show/hide in activity, also run immediately when new mail arrives, and
  desktop-notify when a run finishes. Cards drag to reorder, pause with a switch, and show
  recent runs. That notify option governs "here is the result"; a run that fails, or that
  leaves a draft waiting for approval, notifies whether or not it is on.
- Marlene also suggests automations from patterns in recent chats; suggestions are reviewed on
  the Automations page (add or dismiss).
- Unattended runs read, search and draft freely, and they send from any account whose "Send /
  Senden" grant is armed (WhatsApp: its own "Auto-send / Automatisch senden" grant), just as in
  chat. Without the grant what they draft waits for approval on Home. The send always comes from
  the run's own standing instruction, never from an incoming message's content, so a malicious
  email can't trigger one. Creating, changing and deleting stay off in unattended runs however
  they are granted (no labelling, moving or deleting mail, no CRM changes beyond new records);
  anything needing one lands as a to-do.

Leads (with onOffice connected)
- Every prospect the assistant tracks: filed automatically from email inquiries or added by
  hand ("New lead / Neuer Lead"). Rows carry a status (New/Neu, Contacted/Kontaktiert,
  Engaged/Im Gespräch, Qualified/Qualifiziert, Won/Gewonnen, Lost/Verloren) and a priority
  (A hot, B warm, C cold), and expand to interest, notes, contact data and attached follow-up
  automations. Deleting a lead deletes its attached automations too.

Knowledge / Wissen
- A file browser over the assistant's home folder: wiki/ (your long-term memory, one markdown
  page per entity or topic — skills included — scoped globally, to one account, or to one
  correspondent), knowledge/ (the document library: PDF, MD, TXT, DOCX, CSV, HTML — searchable
  full-text, including inside PDFs and Word files).
- The user can create pages, skills and folders in-app, upload or drag files in, download
  them, and open the folder in Finder/Explorer ("Open folder / Ordner öffnen"). Everything is
  plain files the user can also edit outside the app.
- A page is summary + body, split at its first blank line: the summary rides your system
  prompt, the body stays on disk behind page_read. The wiki has a fixed share of that prompt,
  so it cannot crowd out the conversation. Past it the least recently touched pages decay to
  one-line index entries (still whole on disk; page_read brings one back, and relying on it
  promotes it again), and only past the page cap are you told just how many more exist. That
  is your cue to consolidate: merge pages on one entity or topic, drop what no longer holds.
  Aim for few full pages, not many thin ones.

Settings / Einstellungen (sections in order)
- AI & model / KI & Modell: sign in to a provider with a subscription (Claude, Copilot,
  ChatGPT) or an API key; pick provider and model. The sign-in stays on this computer.
- Accounts / Konten: connect email (Gmail, Outlook / Microsoft 365, Zoho Mail, IMAP), 2,000+
  other apps via search, plus onOffice (API token + secret) and WhatsApp (QR pairing for the
  personal link with chat mirror, or a Business account, send-only). Each account row has a
  color, a learned-writing-style badge (click to view/edit the directives), a gear for
  permissions, and disconnect.
- Both WhatsApp transports get their own row when both exist, each with its own disconnect. The
  personal link is the only one that sends once it is paired, and the Business row reads "Not in
  use / Nicht aktiv" while that is the case.
- Permissions are per account and per category — "Create & change / Anlegen & Ändern",
  "Send / Senden", "Delete / Löschen" — armed on the account's row behind a confirm; reading
  and drafting are always allowed. onOffice separately grants chat writes and whether
  automations may create records.
- Email accounts also get a signature editor on that same expanded row. The whole signature can
  be pasted in from Gmail or Outlook — layout, fonts and logo come along, and images the copy
  only points at are downloaded and stored with it, so recipients see them instead of a blocked
  placeholder. A logo can also be inserted from a file, and is resized by clicking it and
  dragging any of its corners. An image the clipboard does not actually carry (an
  Outlook copy sometimes references a temp file) is reported as not copied along and has to be
  inserted from a file.
- File access / Dateizugriff: what the assistant may do outside its own folder — read files,
  write files, run commands; all off by default.
- Preferences / Darstellung & Sprache: appearance (light/dark/system), language (German or
  English, for the app and the assistant's answers), timezone, quick actions — whether
  buttons like "Draft reply / Antwort entwerfen" send immediately or open the draft for review
  — and "Start with the computer / Mit dem Computer starten", which launches Marlene into the
  background at login so scheduled automations run without the app being opened first.
- Local data / Lokale Daten: download a backup snapshot of everything stored on this computer
  (without account credentials).
- About / Über Marlene: version, build, license, the GitHub page, report an issue, the
  full changelog, and "Check for updates / Nach Updates suchen".

Running in the background
- Closing the window does not stop Marlene: scheduled automations keep running. On macOS the app
  stays in the dock, on Windows in the system tray, whose icon reopens it and whose menu quits
  it. The app icon carries a badge (macOS) or the tray tooltip a count (Windows) for drafts
  waiting for approval.

Updates
- The app updates itself from official releases. A downloaded update waits as an "Update ready /
  Update bereit" pill in the sidebar; it opens the changelog ("What's new / Neuigkeiten") first
  and installs on restart. Version and changelog are always under Settings → About.

First run
- Until setup is complete, a welcome screen asks for exactly two things: an AI sign-in and one
  connected email account. Marlene starts read-only: it drafts and answers, but sends, changes
  or deletes nothing until the user arms those permissions per account.
