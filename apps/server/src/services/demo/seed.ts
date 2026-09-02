import { mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { lowerSeenFloor } from "../../db/seenStore.js";
import { clearAccountVoices, getAccountColors, setAccountColors } from "../../db/settings.js";
import { ensureAgentHome, knowledgeDir, wikiDir } from "../../storage/home/agentHome.js";
import { scanLibrary } from "../../storage/library/ingest.js";
import { listDocuments } from "../../storage/library/store.js";
import { wikiPageRevision, writeWikiPageFile } from "../../storage/wiki/store.js";
import { forgetSeededDefaults, seedDefaultAutomations } from "../automations/defaults.js";
import { DEMO, type DemoRows, demoRows } from "./fixtures.js";

/**
 * Development seed: the demo persona's two weeks of app state, written next
 * to whatever the database already holds. Every demo row carries a "demo-"
 * id, so reseeding replaces exactly those rows and leaves the user's own
 * data alone; dates are relative to seed time, so a reseed reads as today.
 */

const DEMO_BRIEFING_ID = "demo-automation-briefing";

export interface DemoSeedSummary {
  automations: number;
  runs: number;
  chats: number;
  todos: number;
  leads: number;
  wikiPages: number;
  documents: number;
  documentErrors: number;
}

/** The runs attach to the pinned automation (the Home briefing), else to a briefing of our own. */
async function briefingAutomationId(): Promise<string> {
  const [pinned] = await db
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .where(eq(schema.automations.pinned, true))
    .limit(1);
  if (pinned) return pinned.id;
  const [named] = await db
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .where(eq(schema.automations.name, DEMO.briefingAutomation))
    .limit(1);
  return named?.id ?? DEMO_BRIEFING_ID;
}

function replaceDemoRows(rows: DemoRows, briefingId: string): void {
  const demoItemKeys = rows.reportItems.map((row) => row.itemKey);
  db.transaction((tx) => {
    tx.delete(schema.messages)
      .where(
        or(
          like(schema.messages.id, "demo-msg-%"),
          like(schema.messages.conversationId, "demo-chat-%"),
          like(schema.messages.conversationId, "automation:demo-automation-%"),
        ),
      )
      .run();
    tx.delete(schema.conversations)
      .where(
        or(
          like(schema.conversations.id, "demo-chat-%"),
          like(schema.conversations.id, "automation:demo-automation-%"),
        ),
      )
      .run();
    tx.delete(schema.automationReportItems)
      .where(
        or(
          like(schema.automationReportItems.automationId, "demo-automation-%"),
          and(
            eq(schema.automationReportItems.automationId, briefingId),
            inArray(schema.automationReportItems.itemKey, demoItemKeys),
          ),
        ),
      )
      .run();
    tx.delete(schema.automationRuns).where(like(schema.automationRuns.id, "demo-run-%")).run();
    tx.delete(schema.automations).where(like(schema.automations.id, "demo-automation-%")).run();
    tx.delete(schema.todos)
      .where(or(like(schema.todos.id, "demo-todo-%"), like(schema.todos.id, "demo-approval-%")))
      .run();
    tx.delete(schema.outboundDrafts).where(like(schema.outboundDrafts.id, "demo-outbound-%")).run();
    tx.delete(schema.leads).where(like(schema.leads.id, "demo-lead-%")).run();
    tx.delete(schema.agentDraftVersions)
      .where(like(schema.agentDraftVersions.draftId, "demo-draft-%"))
      .run();
    tx.delete(schema.agentDrafts).where(like(schema.agentDrafts.id, "demo-draft-%")).run();
    tx.delete(schema.draftProposals).where(like(schema.draftProposals.id, "demo-proposal-%")).run();
    tx.delete(schema.learnRuns).where(like(schema.learnRuns.id, "demo-learn-%")).run();
    tx.delete(schema.seenMarks)
      .where(
        or(like(schema.seenMarks.key, "run:demo-%"), like(schema.seenMarks.key, "todo:demo-%")),
      )
      .run();

    if (briefingId === DEMO_BRIEFING_ID) {
      tx.insert(schema.automations)
        .values({
          id: DEMO_BRIEFING_ID,
          name: DEMO.briefingAutomation,
          instruction:
            "Sieh alle Konten seit dem letzten Lauf durch, ordne jede Nachricht einer Stufe zu und veröffentliche den Bericht.",
          schedule: "0 8 * * *",
          pinned: true,
          position: 0,
          createdAt: rows.seenFloor,
        })
        .run();
    }
    tx.insert(schema.automations).values(rows.automations).run();
    tx.insert(schema.automationRuns).values(rows.runs).run();
    tx.insert(schema.automationReportItems).values(rows.reportItems).run();
    // The briefing's own conversation may already exist from real runs.
    tx.insert(schema.conversations).values(rows.conversations).onConflictDoNothing().run();
    tx.insert(schema.messages).values(rows.messages).run();
    tx.insert(schema.todos).values(rows.todos).run();
    tx.insert(schema.outboundDrafts).values(rows.outbound).run();
    // A lead's address is unique; the user's own lead wins over the demo one.
    tx.insert(schema.leads).values(rows.leads).onConflictDoNothing().run();
    tx.insert(schema.agentDrafts).values(rows.drafts).run();
    tx.insert(schema.agentDraftVersions).values(rows.draftVersions).run();
    tx.insert(schema.draftProposals).values(rows.proposals).run();
    tx.insert(schema.learnRuns).values(rows.learnRuns).run();
    tx.insert(schema.seenMarks)
      .values(rows.seenKeys.map((key) => ({ key, seenAt: rows.seenFloor })))
      .onConflictDoNothing()
      .run();
  });
}

async function writeWikiPages(rows: DemoRows): Promise<void> {
  for (const page of rows.wiki) {
    await writeWikiPageFile({ ...page, revision: wikiPageRevision(page) });
    const modified = new Date(page.updatedAt);
    await utimes(join(wikiDir(), `${page.id}.md`), modified, modified);
  }
}

/** Backdated mtimes also spare the library scanner its "still being copied" wait. */
async function writeKnowledgeFiles(rows: DemoRows): Promise<void> {
  for (const file of rows.knowledge) {
    const absPath = join(knowledgeDir(), file.path);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, file.data);
    const modified = new Date(file.modifiedAt);
    await utimes(absPath, modified, modified);
  }
}

async function mergeAccountColors(rows: DemoRows): Promise<void> {
  const demoIds = new Set(rows.accountColors.map((color) => color.accountId));
  const kept = (await getAccountColors()).filter((color) => !demoIds.has(color.accountId));
  await setAccountColors([...kept, ...rows.accountColors]);
}

export async function seedDemo(now = new Date()): Promise<DemoSeedSummary> {
  await ensureAgentHome();
  await seedDefaultAutomations();
  const briefingId = await briefingAutomationId();
  const rows = demoRows(now, briefingId);
  replaceDemoRows(rows, briefingId);
  await writeWikiPages(rows);
  await writeKnowledgeFiles(rows);
  await scanLibrary();
  await mergeAccountColors(rows);
  await lowerSeenFloor(rows.seenFloor);
  const documents = await listDocuments();
  return {
    automations: rows.automations.length + (briefingId === DEMO_BRIEFING_ID ? 1 : 0),
    runs: rows.runs.length,
    chats: rows.conversations.filter((c) => c.type === "chat").length,
    todos: rows.todos.length,
    leads: rows.leads.length,
    wikiPages: rows.wiki.length,
    documents: documents.filter((doc) => doc.status === "indexed").length,
    documentErrors: documents.filter((doc) => doc.status === "error").length,
  };
}

async function emptyDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir)) {
    await rm(join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * Empty everything the app accumulated (conversations, runs, todos, leads,
 * drafts, wiki, knowledge) while keeping settings and credentials, so the
 * instance stays connected but starts over. The built-in automations return
 * on the next boot or seed.
 */
export async function resetContent(): Promise<void> {
  await ensureAgentHome();
  db.transaction((tx) => {
    for (const table of [
      schema.messages,
      schema.conversations,
      schema.agentDraftVersions,
      schema.agentDrafts,
      schema.draftProposals,
      schema.automationReportItems,
      schema.automationRuns,
      schema.automations,
      schema.todos,
      schema.outboundDrafts,
      schema.leads,
      schema.learnRuns,
      schema.voiceLearnRuns,
      schema.waMessages,
      schema.waChats,
      schema.waContacts,
      schema.seenMarks,
    ]) {
      tx.delete(table).run();
    }
  });
  await forgetSeededDefaults();
  await clearAccountVoices();
  await emptyDir(wikiDir());
  await emptyDir(knowledgeDir());
  await scanLibrary();
  await lowerSeenFloor(new Date().toISOString());
}
