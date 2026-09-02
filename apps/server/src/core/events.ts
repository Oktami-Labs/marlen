import { EventEmitter } from "node:events";
import type { RunNotification, ServerEvent, ServerEventTopic } from "@marlen/shared";

/**
 * In-process bus for "data changed" notifications, fanned out to the web UI
 * over GET /api/events. Emits live in the lowest-level mutation functions, so
 * every path is covered once.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitServerEvent(topic: ServerEventTopic): void {
  bus.emit("event", { topic } satisfies ServerEvent);
}

/**
 * An emitter for a topic that changes many times a second (streamed text,
 * tool steps): the first change goes out at once, the rest ride one trailing
 * emit per interval. The web debounces topics anyway, so nothing arrives later
 * than it would have been acted on.
 */
export function coalescedEmitter(topic: ServerEventTopic, intervalMs: number): () => void {
  let emittedAt = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  return () => {
    const now = Date.now();
    if (now - emittedAt >= intervalMs) {
      emittedAt = now;
      emitServerEvent(topic);
      return;
    }
    if (pending) return;
    pending = setTimeout(
      () => {
        pending = null;
        emittedAt = Date.now();
        emitServerEvent(topic);
      },
      intervalMs - (now - emittedAt),
    );
  };
}

/** Emit the only server event topic that carries a payload. */
export function emitRunNotification(notification: RunNotification): void {
  bus.emit("event", { topic: "notification", notification } satisfies ServerEvent);
}

export function onServerEvent(listener: (event: ServerEvent) => void): () => void {
  bus.on("event", listener);
  return () => {
    bus.off("event", listener);
  };
}
