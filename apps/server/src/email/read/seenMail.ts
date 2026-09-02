import type { MailMessageSummary } from "./readProviders.js";

/**
 * The newest message the mail tools returned for each thread, keyed by account
 * and thread id. A report item then needs only its thread id: the card's
 * sender, subject and time come from what a tool actually returned, never from
 * the model retyping them. Process-local and bounded; a report is composed
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
  /** Every distinct message id a tool returned, so the report's "scanned" count is counted, not claimed. */
  messageIds: Set<string>;
}

/**
 * Search results belong to the agent session that read them. Keeping sessions
 * separate prevents two simultaneous reports with the same provider thread
 * id from resolving each other's sender, subject, or account.
 */
const sessions = new Map<string, SessionThreads>();

function keyOf(accountId: string, threadId: string): string {
  return `${accountId}\n${threadId}`;
}

function session(sessionId: string): SessionThreads {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.touchedAt = Date.now();
    return existing;
  }
  if (sessions.size >= SESSION_CAPACITY) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const created: SessionThreads = {
    touchedAt: Date.now(),
    threads: new Map(),
    messageIds: new Set(),
  };
  sessions.set(sessionId, created);
  return created;
}

function sessionThreads(sessionId: string): Map<string, SeenThread> {
  return session(sessionId).threads;
}

export function rememberMessages(
  sessionId: string,
  accountId: string,
  messages: MailMessageSummary[],
): void {
  const current = session(sessionId);
  const seen = current.threads;
  for (const message of messages) {
    current.messageIds.add(`${accountId}\n${message.messageId}`);
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

/** How many distinct messages the mail tools returned in this session. */
export function seenMessageCount(sessionId: string): number {
  return sessions.get(sessionId)?.messageIds.size ?? 0;
}

/** Release a finished ephemeral run immediately; pooled sessions age out via the session cap. */
export function forgetSeenMail(sessionId: string): void {
  sessions.delete(sessionId);
}
