import type { MailMessageSummary } from "./readProviders.js";

/**
 * The newest message the mail tools returned for each thread, keyed by account
 * and thread id. A briefing item then needs only its thread id: the card's
 * sender, subject and time come from what a tool actually returned, never from
 * the model retyping them. Process-local and bounded; a briefing is composed
 * in the run that searched.
 */

export interface SeenThread extends MailMessageSummary {
  accountId: string;
}

const CAPACITY_PER_SESSION = 1000;
const SESSION_CAPACITY = 50;

interface SessionThreads {
  touchedAt: number;
  threads: Map<string, SeenThread>;
}

/**
 * Search results belong to the agent session that read them. Keeping sessions
 * separate prevents two simultaneous briefings with the same provider thread
 * id from resolving each other's sender, subject, or account.
 */
const sessions = new Map<string, SessionThreads>();

function keyOf(accountId: string, threadId: string): string {
  return `${accountId}\n${threadId}`;
}

function sessionThreads(sessionId: string): Map<string, SeenThread> {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.touchedAt = Date.now();
    return existing.threads;
  }
  if (sessions.size >= SESSION_CAPACITY) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const created: SessionThreads = { touchedAt: Date.now(), threads: new Map() };
  sessions.set(sessionId, created);
  return created.threads;
}

export function rememberMessages(
  sessionId: string,
  accountId: string,
  messages: MailMessageSummary[],
): void {
  const seen = sessionThreads(sessionId);
  for (const message of messages) {
    const key = keyOf(accountId, message.threadId);
    const known = seen.get(key);
    if (known && known.date > message.date) continue;
    // Re-inserting moves the entry to the young end of the map's insertion order.
    seen.delete(key);
    seen.set(key, { ...message, accountId });
    if (seen.size > CAPACITY_PER_SESSION) {
      const oldest = seen.keys().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
  }
}

/** The thread as last seen in `accountId`, or the unique account that returned it. */
export function recallThread(
  sessionId: string,
  threadId: string,
  accountId?: string,
): SeenThread | undefined {
  const seen = sessionThreads(sessionId);
  if (accountId) return seen.get(keyOf(accountId, threadId));
  const matches = [...seen.values()].filter((entry) => entry.threadId === threadId);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Release a finished ephemeral run immediately; pooled sessions age out via the session cap. */
export function forgetSeenMail(sessionId: string): void {
  sessions.delete(sessionId);
}
