import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@marlen/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { MailReadProvider } from "../../src/email/read/readProviders.js";

let draftStore: typeof import("../../src/db/draftStore.js");
let runExtractionSweep: typeof import("../../src/email/learn/extractor.js").runExtractionSweep;
let getAccountVoices: typeof import("../../src/db/settings.js").getAccountVoices;
let wikiStore: typeof import("../../src/storage/wiki/store.js");

const account: ConnectedAccount = {
  id: "learning-account",
  app: "test-mail",
  name: "writer@example.com",
  healthy: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const sentBodies = new Map<string, string>();

const reader: MailReadProvider = {
  newestInbound: async () => null,
  listSentSince: async () => [],
  getMessageBody: async (_account, messageId) => sentBodies.get(messageId) ?? null,
  getThread: async () => null,
  searchMessages: async () => [],
};

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-learning-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  await (await import("../../src/storage/home/agentHome.js")).ensureAgentHome();
  draftStore = await import("../../src/db/draftStore.js");
  ({ getAccountVoices } = await import("../../src/db/settings.js"));
  wikiStore = await import("../../src/storage/wiki/store.js");
  ({ runExtractionSweep } = await import("../../src/email/learn/extractor.js"));
}, 30_000);

async function addEditedSentDraft(index: number, targetAccount = account): Promise<void> {
  const providerDraftId = `${targetAccount.id}-draft-${index}`;
  const sentMessageId = `${targetAccount.id}-sent-${index}`;
  await draftStore.createDraftSnapshot({
    accountId: targetAccount.id,
    providerDraftId,
    subject: `Subject ${index}`,
    to: ["recipient@example.com"],
    body: `Agent wording ${index}`,
  });
  await draftStore.markDraftStatus(targetAccount.id, providerDraftId, "sent", sentMessageId);
  sentBodies.set(sentMessageId, `User wording ${index}`);
}

describe("email learning", () => {
  it("waits for three independent edited drafts before changing style memory", async () => {
    let extractionCalls = 0;
    const deps = {
      listAccounts: async () => [account],
      readerFor: () => reader,
      extract: async ({ pairs }: { pairs: Array<{ draftBody: string; sentBody: string }> }) => {
        extractionCalls += 1;
        expect(pairs).toHaveLength(3);
        return ["Prefer the user's concise wording."];
      },
    };

    await addEditedSentDraft(1);
    await addEditedSentDraft(2);

    expect(await runExtractionSweep(deps)).toMatchObject({ learned: 0, lessons: 0 });
    expect(extractionCalls).toBe(0);
    expect(await draftStore.listUnlearnedSentDrafts()).toHaveLength(2);

    await addEditedSentDraft(3);

    expect(await runExtractionSweep(deps)).toMatchObject({ learned: 3, lessons: 1 });
    expect(extractionCalls).toBe(1);
    expect(await draftStore.listUnlearnedSentDrafts()).toHaveLength(0);
  });

  it("keeps edited drafts pending when their lesson cannot be stored", async () => {
    for (let index = 4; index <= 6; index += 1) await addEditedSentDraft(index);

    const result = await runExtractionSweep({
      listAccounts: async () => [account],
      readerFor: () => reader,
      extract: async () => ["x".repeat(20_001)],
    });

    expect(result).toMatchObject({ learned: 0, lessons: 0 });
    expect(await draftStore.listUnlearnedSentDrafts()).toHaveLength(3);
  });

  it("does not overwrite a style page after the user edits it", async () => {
    const protectedAccount = { ...account, id: "protected-account", name: "owner@example.com" };
    const deps = {
      listAccounts: async () => [protectedAccount],
      readerFor: () => reader,
      extract: async () => ["Use a formal greeting."],
    };

    for (let index = 10; index <= 12; index += 1) {
      await addEditedSentDraft(index, protectedAccount);
    }
    expect(await runExtractionSweep(deps)).toMatchObject({ learned: 3, lessons: 1 });

    const voice = (await getAccountVoices()).find(
      (entry) => entry.accountId === protectedAccount.id,
    );
    const memoryId = voice?.styleMemoryIds?.[0];
    expect(memoryId).toBeTruthy();
    const custom = "My manually curated style rules stay authoritative.";
    await wikiStore.updatePage(memoryId as string, custom);

    for (let index = 13; index <= 15; index += 1) {
      await addEditedSentDraft(index, protectedAccount);
    }
    expect(await runExtractionSweep(deps)).toMatchObject({ learned: 3, lessons: 0 });
    expect((await wikiStore.readPage(memoryId as string))?.content).toBe(custom);
    expect(
      (await draftStore.listUnlearnedSentDrafts()).filter(
        (draft) => draft.accountId === protectedAccount.id,
      ),
    ).toHaveLength(0);
  });
});
