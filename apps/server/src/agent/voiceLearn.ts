import { createHash } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  type AccountVoice,
  type AccountVoiceInfo,
  type ConnectedAccount,
  EMAIL_APPS,
  WIKI_SUMMARY_MAX_LENGTH,
} from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { moduleLogger } from "../core/logger.js";
import { errorMessage } from "../core/utils/util.js";
import { getAccountVoices, patchAccountVoice } from "../db/settings.js";
import {
  deleteVoiceLearnRun,
  failInterruptedVoiceLearnRuns,
  finishVoiceLearnRun,
  listVoiceLearnRuns,
  markVoiceLearnRunning,
} from "../db/voiceRuns.js";
import { normalizeAddressSet } from "../email/learn/addressSubject.js";
import { getMailReadProvider, type SentMessage } from "../email/read/readProviders.js";
import { listAccounts } from "../integrations/pipedream/connect.js";
import {
  createPage,
  deletePage,
  listPages,
  updatePage,
  WikiPageConflictError,
} from "../storage/wiki/store.js";
import { activeModelConfigured } from "./llm/registry.js";
import { type ReportToolSpec, runReportPrompt } from "./oneShot.js";
import { appLanguageName } from "./prompt.js";
import { textResult, tool } from "./toolkit.js";

const log = moduleLogger("voiceLearn");

const SAMPLE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const FETCH_LIMIT = 40;
const MAX_SAMPLES = 15;
const MAX_BODY_CHARS = 2000;

const inFlight = new Set<string>();

class NoSentMailError extends Error {}

const NO_MODEL_ERROR = "no LLM configured — sign in under Settings → AI";

function styleHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function recordedLearn<T>(accountId: string, learn: () => Promise<T>): Promise<T> {
  if (inFlight.has(accountId)) {
    throw new Error("a voice learn for this account is already running — wait for it to finish");
  }
  inFlight.add(accountId);
  try {
    await markVoiceLearnRunning(accountId);
    const result = await learn();
    await finishVoiceLearnRun(accountId);
    return result;
  } catch (error) {
    if (error instanceof NoSentMailError) {
      await deleteVoiceLearnRun(accountId).catch((recordError: unknown) => {
        log.warn({ err: recordError, accountId }, "failed to clear the skipped voice learn's row");
      });
    } else {
      await finishVoiceLearnRun(accountId, errorMessage(error)).catch((recordError: unknown) => {
        log.warn({ err: recordError, accountId }, "failed to record the voice learn's outcome");
      });
    }
    throw error;
  } finally {
    inFlight.delete(accountId);
  }
}

function systemPromptFor(accountName: string, languageName: string): string {
  return `You are a writing-style analyst for Marlene, a personal email assistant. Your only job is
to study the user's OWN sent messages from the connected account ${accountName} — provided below in
the prompt — and report back their writing style, nothing else. Study how the user writes: greeting,
sign-off, tone, length, language(s). Write every directive in ${languageName}. When you are done,
call the report_style tool exactly once with your findings.`;
}

/** Prefer recent messages across distinct threads and recipient sets. */
function sampleSentMessages(sent: SentMessage[]): SentMessage[] {
  const newestFirst = [...sent].reverse();
  const seenThreads = new Set<string>();
  const seenRecipients = new Set<string>();
  const distinct: SentMessage[] = [];
  const fallback: SentMessage[] = [];
  for (const message of newestFirst) {
    if (!message.bodyText.trim()) continue;
    if (seenThreads.has(message.providerThreadId)) continue;
    seenThreads.add(message.providerThreadId);
    const recipientKey = [...normalizeAddressSet(message.to)].sort().join(",");
    if (seenRecipients.has(recipientKey)) {
      fallback.push(message);
      continue;
    }
    seenRecipients.add(recipientKey);
    distinct.push(message);
  }
  return [...distinct, ...fallback].slice(0, MAX_SAMPLES);
}

function renderSamples(accountName: string, samples: SentMessage[]): string {
  const blocks = samples.map((message, index) => {
    const body =
      message.bodyText.length > MAX_BODY_CHARS
        ? `${message.bodyText.slice(0, MAX_BODY_CHARS)}\n[truncated]`
        : message.bodyText;
    return `--- Message ${index + 1} ---
To: ${message.to.join(", ")}
Subject: ${message.subject}
Date: ${message.date}

${body}`;
  });
  return `Sent messages from ${accountName} (${samples.length} samples, newest first):

${blocks.join("\n\n")}

Report this account's writing style via report_style as instructed.`;
}

interface LearnedVoice {
  style: string[];
}

const reportStyleTool: ReportToolSpec<LearnedVoice> = {
  name: "report_style",
  label: "Report writing style",
  description:
    `Record the writing-style analysis for this account. Call this exactly once, after reading ` +
    `the sample messages, to finish the job.`,
  parameters: Type.Object({
    style: Type.Array(Type.String(), {
      minItems: 1,
      description:
        `3-6 short, self-contained directives another assistant can follow when drafting as ` +
        `this account, one aspect per entry — typical greeting, typical sign-off, ` +
        `formality/tone, typical message length, language(s) used and when, and any quirks or ` +
        `audience shifts (e.g. formal with clients, casual with colleagues). Each entry is ONE ` +
        `sentence, written as an instruction ("Greets clients with 'Hallo Herr/Frau <Nachname>' ` +
        `…"), not an observation about counts, and under 280 characters.`,
    }),
  }),
  narrow: (params) => {
    const { style } = (params ?? {}) as Record<string, unknown>;
    return {
      style: Array.isArray(style)
        ? style
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim().slice(0, 300))
            .filter(Boolean)
            .slice(0, 6)
        : [],
    };
  },
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry sent-mail reads while newly created proxy credentials settle. */
async function fetchSentSample(
  provider: NonNullable<ReturnType<typeof getMailReadProvider>>,
  account: ConnectedAccount,
  attempts: number,
  retryDelayMs: number,
): Promise<SentMessage[]> {
  const since = new Date(Date.now() - SAMPLE_WINDOW_MS).toISOString();
  for (let attempt = 1; ; attempt++) {
    try {
      return await provider.listSentSince(account, since, { limit: FETCH_LIMIT });
    } catch (error) {
      if (attempt >= attempts) throw error;
      log.warn(
        { err: errorMessage(error), accountId: account.id, attempt },
        "sent-mail fetch failed — retrying",
      );
      await sleep(retryDelayMs);
    }
  }
}

async function learnVoiceCore(
  accountId: string,
  fetchAttempts = 1,
  fetchRetryDelayMs = 0,
): Promise<AccountVoice> {
  const account = (await listAccounts()).find((a) => a.id === accountId);
  if (!account) throw new Error(`No connected account with id ${accountId}.`);
  if (!account.name.includes("@")) {
    throw new Error(`${account.name} is not an email account — voice learning needs sent mail.`);
  }
  const provider = getMailReadProvider(account.app);
  if (!provider) {
    throw new Error(`Voice learning isn't supported for ${account.appName} accounts yet.`);
  }

  const sent = await fetchSentSample(provider, account, fetchAttempts, fetchRetryDelayMs);
  const samples = sampleSentMessages(sent);
  if (samples.length === 0) {
    throw new NoSentMailError(
      `${account.name} has no recent sent mail to learn from — write a few emails first.`,
    );
  }

  const learned = await runReportPrompt({
    systemPrompt: systemPromptFor(account.name, await appLanguageName()),
    tool: reportStyleTool,
    prompt: renderSamples(account.name, samples),
    missingReportError: "the style analysis finished without calling report_style — try again",
  });

  const previous = (await getAccountVoices()).find((voice) => voice.accountId === accountId);
  const previousPages = new Map((await listPages()).map((page) => [page.id, page]));
  const protectedIds: string[] = [];
  const replaceableIds = new Map<string, string>();
  for (const id of previous?.styleMemoryIds ?? []) {
    const page = previousPages.get(id);
    if (!page) continue;
    const generatedHash = previous?.generatedStyleHashes?.[id];
    if (generatedHash && generatedHash === styleHash(page.content)) {
      replaceableIds.set(id, page.revision);
    } else protectedIds.push(id);
  }

  // Persist the replacement and its pointer before deleting prior generated pages.
  const styleMemoryIds: string[] = [];
  const generatedStyleHashes: Record<string, string> = {};
  const body = learned.style.map((directive) => `- ${directive}`).join("\n");
  if (body) {
    const { page, created } = await createPage(body, "agent", { accountId, type: "style" });
    styleMemoryIds.push(page.id);
    // Exact-content dedup can return a user-owned page. Claim ownership only
    // for a page created here or one already tracked as generated.
    if (created || replaceableIds.has(page.id)) {
      generatedStyleHashes[page.id] = styleHash(page.content);
    }
  }
  for (const id of protectedIds) if (!styleMemoryIds.includes(id)) styleMemoryIds.push(id);

  const next = await patchAccountVoice(accountId, () => {
    return {
      accountId,
      learnedAt: new Date().toISOString(),
      styleMemoryIds,
      generatedStyleHashes,
    };
  });

  // Delete only unchanged machine-generated pages after the new voice is durable.
  for (const [id, revision] of replaceableIds) {
    if (styleMemoryIds.includes(id)) continue;
    try {
      await deletePage(id, { baseRevision: revision });
    } catch (error) {
      if (error instanceof WikiPageConflictError) {
        await patchAccountVoice(accountId, (existing) => {
          const hashes = { ...existing?.generatedStyleHashes };
          delete hashes[id];
          return {
            ...existing,
            accountId,
            styleMemoryIds: [...new Set([...(existing?.styleMemoryIds ?? []), id])],
            generatedStyleHashes: hashes,
          };
        });
      }
      log.warn({ err: error, accountId, memoryId: id }, "failed to delete old style memory");
    }
  }

  return next;
}

export type StyleDirectiveMergeResult =
  | { status: "updated"; added: number }
  | { status: "unchanged" | "protected"; added: 0 };

export async function mergeStyleDirectives(
  accountId: string,
  directives: string[],
): Promise<StyleDirectiveMergeResult> {
  const dedupKey = (line: string) =>
    line
      .replace(/^[-*]\s*/, "")
      .replace(/\s+/g, " ")
      .replace(/\.$/, "")
      .trim()
      .toLowerCase();

  const voice = (await getAccountVoices()).find((v) => v.accountId === accountId);
  const pages = await listPages();
  const byId = new Map(pages.map((p) => [p.id, p]));
  const target = (voice?.styleMemoryIds ?? [])
    .map((id) => byId.get(id))
    .find((m) => m !== undefined);

  const generatedHash = target ? voice?.generatedStyleHashes?.[target.id] : undefined;
  if (target && (!generatedHash || generatedHash !== styleHash(target.content))) {
    return { status: "protected", added: 0 };
  }

  let content = target?.content ?? "";
  const seen = new Set(content.split("\n").map(dedupKey));
  let added = 0;
  for (const directive of directives) {
    const key = dedupKey(directive);
    if (!key || seen.has(key)) continue;
    const next = content ? `${content}\n- ${directive}` : `- ${directive}`;
    if (next.length > WIKI_SUMMARY_MAX_LENGTH) {
      throw new Error(
        `style memory is full (${WIKI_SUMMARY_MAX_LENGTH} characters); shorten it before learning more`,
      );
    }
    seen.add(key);
    content = next;
    added++;
  }
  if (added === 0) {
    return { status: "unchanged", added: 0 };
  }

  if (target) {
    const updated = await updatePage(target.id, content, {}, { baseRevision: target.revision });
    if (!updated) throw new Error(`style memory ${target.id} no longer exists`);
    await patchAccountVoice(accountId, (existing) => ({
      ...existing,
      accountId,
      generatedStyleHashes: {
        ...existing?.generatedStyleHashes,
        [updated.id]: styleHash(updated.content),
      },
    }));
  } else {
    const { page } = await createPage(content, "agent", { accountId, type: "style" });
    await patchAccountVoice(accountId, (existing) => ({
      ...existing,
      accountId,
      styleMemoryIds: [...(existing?.styleMemoryIds ?? []), page.id],
      generatedStyleHashes: {
        ...existing?.generatedStyleHashes,
        [page.id]: styleHash(page.content),
      },
    }));
  }
  return { status: "updated", added };
}

export async function listAccountVoiceInfos(): Promise<AccountVoiceInfo[]> {
  const [voices, pages] = await Promise.all([getAccountVoices(), listPages()]);
  const byId = new Map(pages.map((p) => [p.id, p.content]));
  return voices.flatMap((voice) => {
    const ids = voice.styleMemoryIds ?? [];
    const directives = ids
      .flatMap((id) => (byId.get(id) ?? "").split("\n"))
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    if (directives.length === 0) return [];
    const memoryId = ids.find((id) => byId.has(id));
    return [
      {
        accountId: voice.accountId,
        ...(voice.learnedAt ? { learnedAt: voice.learnedAt } : {}),
        ...(memoryId ? { memoryId } : {}),
        directives,
      },
    ];
  });
}

/** The learned style for one account, or nothing when it has none yet or the read fails. */
export async function accountVoiceDirectives(accountId: string): Promise<string[] | undefined> {
  try {
    const infos = await listAccountVoiceInfos();
    return infos.find((info) => info.accountId === accountId)?.directives;
  } catch {
    return undefined;
  }
}

export const voiceLearnTool: AgentTool = tool({
  name: "voice_learn",
  label: "Learn account voice",
  description:
    `Analyze an account's sent mail to learn the user's writing style, then save the style ` +
    `as a style page scoped to that account (used for every future draft). Use when the user ` +
    `asks to learn or mimic their style from past emails.`,
  account: "required",
  accountDescription: "The connected account's email address to learn from.",
  params: {},
  catchToText: true,
  execute: async (_params, { account }) => {
    const voice = await recordedLearn(account.id, () => learnVoiceCore(account.id));

    const pages = await listPages();
    const byId = new Map(pages.map((p) => [p.id, p.content]));
    const styleLines = (voice.styleMemoryIds ?? [])
      .map((id) => byId.get(id))
      .filter((content): content is string => !!content);
    const styleText =
      styleLines.length > 0
        ? `Learned ${account.name}'s writing style, saved as a memory for this account ` +
          `(review or edit it on the Knowledge page):\n${styleLines.join("\n")}`
        : `No consistent writing-style pattern was found for ${account.name}.`;

    return textResult(styleText);
  },
});

const CONNECT_FETCH_ATTEMPTS = 3;
const CONNECT_FETCH_RETRY_DELAY_MS = 10_000;

export interface VoiceLearnDeps {
  listAccounts: (opts?: { refresh?: boolean }) => Promise<ConnectedAccount[]>;
  modelConfigured: () => Promise<boolean>;
  learn: (accountId: string) => Promise<unknown>;
}

const defaultDeps: VoiceLearnDeps = {
  listAccounts: (opts) => listAccounts(opts),
  modelConfigured: () => activeModelConfigured(),
  learn: (accountId) =>
    learnVoiceCore(accountId, CONNECT_FETCH_ATTEMPTS, CONNECT_FETCH_RETRY_DELAY_MS),
};

async function resolveEmailAccount(
  accountId: string,
  deps: VoiceLearnDeps,
): Promise<ConnectedAccount | null> {
  const accounts = await deps.listAccounts({ refresh: true });
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  return (EMAIL_APPS as readonly string[]).includes(account.app) ? account : null;
}

export async function runVoiceLearnOnConnect(
  accountId: string,
  deps: VoiceLearnDeps = defaultDeps,
): Promise<void> {
  if (inFlight.has(accountId)) return;
  try {
    await recordedLearn(accountId, async () => {
      if (!(await deps.modelConfigured())) {
        throw new Error(NO_MODEL_ERROR);
      }
      if (!(await resolveEmailAccount(accountId, deps))) {
        throw new Error("not a connected email account");
      }
      await deps.learn(accountId);
    });
    log.info({ accountId }, "voice learn finished");
  } catch (error) {
    if (error instanceof NoSentMailError) {
      log.info({ accountId }, "voice learn skipped: no sent mail to learn from");
    } else {
      log.warn({ err: errorMessage(error), accountId }, "voice learn failed");
    }
  }
}

export function startVoiceLearnOnConnect(accountId: string): void {
  void runVoiceLearnOnConnect(accountId);
}

/** Learn unattempted accounts sequentially and leave actionable failures for manual retry. */
export async function reconcileVoiceLearns(deps: VoiceLearnDeps = defaultDeps): Promise<void> {
  try {
    await failInterruptedVoiceLearnRuns();
    if (!(await deps.modelConfigured())) {
      log.info("voice-learn reconcile skipped: no LLM configured");
      return;
    }
    const [accounts, runs, voices] = await Promise.all([
      deps.listAccounts(),
      listVoiceLearnRuns(),
      getAccountVoices(),
    ]);
    const attempted = new Set(
      runs.filter((run) => run.error !== NO_MODEL_ERROR).map((run) => run.accountId),
    );
    const learned = new Set(voices.map((voice) => voice.accountId));
    for (const account of accounts) {
      if (!(EMAIL_APPS as readonly string[]).includes(account.app)) continue;
      if (attempted.has(account.id) || learned.has(account.id)) continue;
      log.info({ accountId: account.id }, "voice-learn reconcile: learning account");
      await runVoiceLearnOnConnect(account.id, deps);
    }
  } catch (error) {
    log.warn({ err: errorMessage(error) }, "voice-learn reconcile failed");
  }
}
