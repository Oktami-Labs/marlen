import type { ConnectedAccount, EmailDraft } from "@marlen/shared";
import { emitServerEvent } from "../core/events.js";
import { moduleLogger } from "../core/logger.js";
import { createFetchCache } from "../core/utils/fetchCache.js";
import { JobLoop } from "../core/utils/jobs.js";
import { listAccounts, pipedreamConfigured } from "../integrations/pipedream/connect.js";
import { syncFetchedDrafts } from "../services/approvals.js";
import { getDraftProvider } from "./providers.js";

/**
 * Shared stale-while-revalidate drafts cache, one entry per account: a stale
 * entry is served immediately and a single deduped background refresh brings
 * it current, emitting "drafts" only when the refreshed list actually differs.
 * Failed fetches never update the cache.
 */

const log = moduleLogger("drafts-cache");

const cache = createFetchCache<EmailDraft[]>({ ttlMs: 60_000 });

/** Accounts with a background refresh scheduled, so a second stale hit doesn't queue another. */
const refreshing = new Set<string>();

/** Order-sensitive equality is fine: both sides come from the same provider-sorted list. */
function draftsEqual(a: EmailDraft[], b: EmailDraft[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function providerFor(account: ConnectedAccount) {
  const provider = getDraftProvider(account.app);
  if (!provider) throw new Error(`no draft provider registered for app "${account.app}"`);
  return provider;
}

/**
 * Deduped live fetch; the result lands in the cache only if no invalidate ran
 * while it was in flight (`stored` reports which). A stored list is the
 * mailbox's current truth, so it also updates the agenda's approvals, whoever
 * asked for it: the UI, the agent's draft tools, or the refresh loop.
 */
async function fetchDrafts(account: ConnectedAccount) {
  const result = await cache.fetch(account.id, () => providerFor(account).listDrafts(account));
  if (result.stored) syncFetchedDrafts(account, result.value);
  return result;
}

/** Background refresh for one account; never throws, so a failure leaves the stale entry in place. */
function scheduleBackgroundRefresh(account: ConnectedAccount, previous: EmailDraft[]): void {
  if (refreshing.has(account.id)) return;
  refreshing.add(account.id);
  fetchDrafts(account)
    .then(({ value: drafts, stored }) => {
      // Invalidated mid-flight: the result is pre-mutation and uncached, so it
      // does not drive a UI notification (the mutation's own invalidate+emit does).
      if (!stored) return;
      // Notify only on an actual change, or a quiet account triggers a refetch storm every TTL.
      if (!draftsEqual(previous, drafts)) emitServerEvent("drafts");
    })
    .catch((error) => {
      log.warn({ err: error, accountId: account.id }, "background drafts refresh failed");
    })
    .finally(() => {
      refreshing.delete(account.id);
    });
}

export async function listDraftsCached(
  account: ConnectedAccount,
  opts: { refresh?: boolean } = {},
): Promise<EmailDraft[]> {
  if (!opts.refresh) {
    const entry = cache.peek(account.id);
    if (entry) {
      if (!entry.fresh) scheduleBackgroundRefresh(account, entry.value);
      return entry.value;
    }
  }
  return (await fetchDrafts(account)).value;
}

/**
 * Drop the cached list and bump the generation (stops an in-flight fetch from
 * re-caching its now-stale result). Call directly only when no UI refetch
 * should follow; mutations go through draftsMutated.
 */
export function invalidateDraftsCache(accountId: string): void {
  cache.invalidate(accountId);
}

/**
 * Every draft mutation's epilogue: invalidate, THEN emit "drafts". The order
 * stops the SSE-driven refetch from racing the cache and receiving stale data.
 */
export function draftsMutated(accountId: string): void {
  invalidateDraftsCache(accountId);
  emitServerEvent("drafts");
}

/**
 * Keeps every draft account's list no older than this without a request:
 * the agenda's email approvals ride on each fetch, and an automation that
 * drafts while Home is closed must still reach the agent's own todo list.
 */
const REFRESH_INTERVAL_MS = 5 * 60_000;

async function refreshAllOnce(): Promise<void> {
  if (!(await pipedreamConfigured())) return;
  const accounts = (await listAccounts()).filter((a) => getDraftProvider(a.app) !== null);
  await Promise.allSettled(accounts.map((account) => listDraftsCached(account)));
}

const refresh = new JobLoop({
  name: "drafts-refresh",
  run: refreshAllOnce,
  intervalMs: REFRESH_INTERVAL_MS,
});

export function startDraftsRefresh(): void {
  refresh.start();
}

export function stopDraftsRefresh(): void {
  refresh.stop();
}
