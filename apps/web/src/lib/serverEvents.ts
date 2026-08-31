import type { RunNotification, ServerEvent, ServerEventTopic } from "@marlen/shared";
import * as React from "react";

/**
 * One shared EventSource on GET /api/events. Created when the first
 * subscriber appears, closed when the last leaves. Events are debounced per
 * topic so a burst of server-side changes (an agent creating three drafts)
 * causes one refetch, not three, except "notification" events, whose
 * payloads are each delivered (see subscribeRunNotifications).
 */

const DEBOUNCE_MS = 300;

/** Matches the server's `retry: 3000` hint for the reconnects the browser won't do itself. */
const RECONNECT_MS = 3000;

/**
 * Three missed server heartbeats (15s "ping" events), past that the stream
 * is presumed dead even though the browser still reports it open: a proxy can
 * swallow the upstream's end without closing the browser-side socket, and
 * such a zombie never errors on its own.
 */
const STALE_MS = 45_000;
const WATCHDOG_TICK_MS = 5_000;

interface Subscription {
  topics: ServerEventTopic[];
  handler: () => void;
}

const subscriptions = new Set<Subscription>();
const notificationHandlers = new Set<(notification: RunNotification) => void>();
const connectionHandlers = new Set<(online: boolean) => void>();
const timers = new Map<ServerEventTopic, ReturnType<typeof setTimeout>>();
let source: EventSource | null = null;
let dropped = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let lastAlive = 0;
let online = true;

/** Publishes a change in whether the stream is carrying events right now. */
function setOnline(next: boolean): void {
  if (online === next) return;
  online = next;
  for (const handler of connectionHandlers) handler(next);
}

function markAlive(): void {
  lastAlive = Date.now();
}

/** True while anyone, topic subscription or notification handler, needs the stream. */
function hasSubscribers(): boolean {
  return subscriptions.size > 0 || notificationHandlers.size > 0;
}

function dispatch(topic: ServerEventTopic): void {
  for (const sub of subscriptions) {
    if (sub.topics.includes(topic)) sub.handler();
  }
}

function connect(): void {
  markAlive();
  source = new EventSource("/api/events");
  source.addEventListener("ping", markAlive);
  source.onmessage = (e: MessageEvent<string>) => {
    markAlive();
    let event: ServerEvent;
    try {
      event = JSON.parse(e.data) as ServerEvent;
    } catch {
      return;
    }
    // Each "notification" event carries a payload. The per-topic debounce
    // would swallow all but the last event in a burst, so notifications
    // dispatch immediately to their own handler set instead.
    if (event.topic === "notification") {
      if (event.notification) {
        for (const handler of notificationHandlers) handler(event.notification);
      }
      return;
    }
    const pending = timers.get(event.topic);
    if (pending) clearTimeout(pending);
    timers.set(
      event.topic,
      setTimeout(() => {
        timers.delete(event.topic);
        dispatch(event.topic);
      }, DEBOUNCE_MS),
    );
  };
  source.onerror = () => {
    dropped = true;
    setOnline(false);
    // The browser only auto-reconnects network-level drops (readyState
    // CONNECTING). An HTTP error reply, e.g. the dev proxy answering 502
    // while the server restarts, closes the source for good (readyState
    // CLOSED), so that case needs this manual reconnect loop; a failed
    // attempt lands back here and schedules the next one.
    if (source?.readyState === EventSource.CLOSED) {
      source = null;
      reconnectTimer ??= setTimeout(() => {
        reconnectTimer = null;
        if (hasSubscribers() && !source) connect();
      }, RECONNECT_MS);
    }
  };
  source.onopen = () => {
    markAlive();
    setOnline(true);
    if (!dropped) return;
    dropped = false;
    // Back after a drop: refetch everything to catch changes missed offline.
    for (const sub of subscriptions) sub.handler();
  };
  // Redial a stream that stays silent past STALE_MS because that failure does
  // not emit an error event. See the STALE_MS definition above.
  watchdog ??= setInterval(() => {
    if (!source || Date.now() - lastAlive < STALE_MS) return;
    dropped = true;
    setOnline(false);
    source.close();
    source = null;
    connect();
  }, WATCHDOG_TICK_MS);
}

function disconnect(): void {
  source?.close();
  source = null;
  dropped = false;
  // Nobody is listening any more, so there is no outage to report.
  online = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

/** Close the shared EventSource once the last subscriber of either kind is gone. */
function maybeDisconnect(): void {
  if (!hasSubscribers()) disconnect();
}

/** Raw subscription (the query bridge and useServerEvents build on it): handler fires debounced per matching topic. */
export function subscribeServerEvents(topics: ServerEventTopic[], handler: () => void): () => void {
  const sub: Subscription = { topics, handler };
  subscriptions.add(sub);
  if (!source) connect();
  return () => {
    subscriptions.delete(sub);
    maybeDisconnect();
  };
}

/**
 * Payload-carrying subscription to finished notify-flagged runs. Counts as a
 * subscriber of the shared EventSource just like a topic subscription; the
 * handler receives every notification undebounced.
 */
export function subscribeRunNotifications(
  handler: (notification: RunNotification) => void,
): () => void {
  notificationHandlers.add(handler);
  if (!source) connect();
  return () => {
    notificationHandlers.delete(handler);
    maybeDisconnect();
  };
}

/** Re-run a panel's loader whenever the server changes data under these topics. */
export function useServerEvents(topics: ServerEventTopic[], onChange: () => void): void {
  const handler = React.useRef(onChange);
  handler.current = onChange;
  const key = topics.join(",");
  React.useEffect(
    () => subscribeServerEvents(key.split(",") as ServerEventTopic[], () => handler.current()),
    [key],
  );
}

/**
 * Whether the server's event stream is carrying events right now. A dropped
 * stream is not a broken app (turns keep running on the server and the page
 * refetches on reconnect), but it does mean the screen has stopped updating
 * itself, which is worth saying out loud rather than looking idle.
 */
export function useServerConnection(): boolean {
  const [connected, setConnected] = React.useState(online);
  React.useEffect(() => {
    setConnected(online);
    connectionHandlers.add(setConnected);
    return () => {
      connectionHandlers.delete(setConnected);
    };
  }, []);
  return connected;
}
