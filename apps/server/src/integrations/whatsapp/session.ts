import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WhatsAppConnection } from "@marlen/shared";
import makeWASocket, {
  Browsers,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
  type WAVersion,
} from "baileys";
import QRCode from "qrcode";
import { env } from "../../core/env.js";
import { emitServerEvent } from "../../core/events.js";
import { moduleLogger } from "../../core/logger.js";
import {
  clearWhatsAppStore,
  ingestChats,
  ingestContacts,
  ingestHistory,
  ingestMessages,
} from "./store.js";

const log = moduleLogger("whatsapp");

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

const CONNECTING_ATTEMPTS = 3;

const OUTDATED_VERSION_STATUS = 405;
const VERSION_LOOKUP_TIMEOUT_MS = 5_000;

/** Disconnect states that require user action rather than reconnecting. */
const UNRECOVERABLE_STATUS = new Set<number>([
  DisconnectReason.forbidden,
  DisconnectReason.multideviceMismatch,
  DisconnectReason.connectionReplaced,
]);

export interface WhatsAppRuntimeStatus {
  linked: boolean;
  connection: WhatsAppConnection;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  pushName: string | null;
}

interface LinkedAccount {
  id?: string;
  name?: string;
}

interface SessionState {
  socket: WASocket | null;
  connection: WhatsAppConnection;
  /** undefined until credentials are read; null when no account is paired. */
  linked: LinkedAccount | null | undefined;
  qr: string | null;
  qrDataUrl: string | null;
  generation: number;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  shuttingDown: boolean;
}

const state: SessionState = {
  socket: null,
  connection: "off",
  linked: undefined,
  qr: null,
  qrDataUrl: null,
  generation: 0,
  reconnectAttempts: 0,
  reconnectTimer: null,
  shuttingDown: false,
};

type LinkedChangeListener = () => void;
const linkedChangeListeners = new Set<LinkedChangeListener>();

export function onWhatsAppLinkedChange(listener: LinkedChangeListener): void {
  linkedChangeListeners.add(listener);
}

function authDir(): string {
  return resolve(process.cwd(), env.whatsappAuthPath);
}

function readCredsAccount(): LinkedAccount | null {
  try {
    const raw = readFileSync(join(authDir(), "creds.json"), "utf8");
    return (JSON.parse(raw) as { me?: LinkedAccount }).me ?? null;
  } catch {
    return null;
  }
}

function linkedAccount(): LinkedAccount | null {
  if (state.linked === undefined) state.linked = readCredsAccount();
  return state.linked;
}

export function isWhatsAppLinked(): boolean {
  return linkedAccount() !== null;
}

function rememberLinked(me: LinkedAccount | undefined): void {
  if (!me?.id) return;
  const current = linkedAccount();
  if (current && current.id === me.id && current.name === me.name) return;
  state.linked = { id: me.id, name: me.name };
  notifyStatusChanged();
}

function phoneNumberOfMeJid(jid: string | undefined): string | null {
  const digits = jid?.split("@")[0]?.split(":")[0] ?? "";
  return /^\d+$/.test(digits) ? digits : null;
}

export function getWhatsAppRuntimeStatus(): WhatsAppRuntimeStatus {
  const me = linkedAccount();
  return {
    linked: me !== null,
    connection: state.connection,
    qrDataUrl: state.connection === "pairing" ? state.qrDataUrl : null,
    phoneNumber: phoneNumberOfMeJid(me?.id),
    pushName: me?.name?.trim() || null,
  };
}

export function getWhatsAppSocket(): WASocket | null {
  return state.connection === "open" ? state.socket : null;
}

export async function dispatchWhatsApp(
  target: string,
  text: string,
): Promise<{ sentRef?: string }> {
  const socket = getWhatsAppSocket();
  if (!socket) {
    throw new Error(
      state.connection === "connecting"
        ? "The WhatsApp link is reconnecting, try again in a moment"
        : "The WhatsApp link is offline; reconnect it under Settings, Accounts",
    );
  }
  let jid = target;
  if (jid.endsWith("@s.whatsapp.net")) {
    const number = jid.split("@")[0] ?? "";
    // An undefined result is a failed lookup, not an answer: reporting it as
    // "not on WhatsApp" would blame a number that is fine.
    const matches = await socket.onWhatsApp(number);
    if (!matches) throw new Error(`Could not check whether +${number} is on WhatsApp`);
    const match = matches[0];
    if (!match?.exists) throw new Error(`+${number} is not on WhatsApp`);
    jid = match.jid;
  }
  const sent = await socket.sendMessage(jid, { text });
  // Mirror the sent message so follow-up reads show the full conversation.
  if (sent) ingestMessages([sent]);
  return { sentRef: sent?.key?.id ?? undefined };
}

let lastNotifiedLinked: boolean | null = null;

function notifyStatusChanged(): void {
  emitServerEvent("whatsapp");
  const linked = isWhatsAppLinked();
  if (lastNotifiedLinked !== null && linked !== lastNotifiedLinked) {
    for (const listener of linkedChangeListeners) listener();
  }
  lastNotifiedLinked = linked;
}

function setConnection(connection: WhatsAppConnection): void {
  if (state.connection === connection) return;
  state.connection = connection;
  if (connection !== "pairing") {
    state.qr = null;
    state.qrDataUrl = null;
  }
  log.info({ connection }, "WhatsApp connection state changed");
  notifyStatusChanged();
}

function renderQr(qr: string): void {
  state.qr = qr;
  state.qrDataUrl = null;
  QRCode.toDataURL(qr, { errorCorrectionLevel: "M", margin: 1, scale: 6 })
    .then((dataUrl) => {
      // QR payloads rotate while data URL rendering is in flight.
      if (state.qr !== qr) return;
      state.qrDataUrl = dataUrl;
      notifyStatusChanged();
    })
    .catch((err: unknown) => log.warn({ err }, "rendering the pairing QR failed"));
}

let waVersion: WAVersion | null = null;

/** Resolve and cache a current web client version, with the bundled version as fallback. */
async function resolveWaVersion(): Promise<WAVersion> {
  if (waVersion) return waVersion;
  const lookup = (async (): Promise<WAVersion | null> => {
    const web = await fetchLatestWaWebVersion();
    if (web.isLatest) return web.version;
    const mirror = await fetchLatestBaileysVersion();
    return mirror.isLatest ? mirror.version : null;
  })().then(
    (version) => {
      // Cache a late answer for the next attempt.
      if (version) waVersion = version;
      return version;
    },
    () => null,
  );
  const deadline = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), VERSION_LOOKUP_TIMEOUT_MS).unref();
  });
  const version = await Promise.race([lookup, deadline]);
  if (!version) {
    log.warn("looking up the live WhatsApp web version failed — falling back to the bundled one");
    return DEFAULT_CONNECTION_CONFIG.version;
  }
  log.info({ version: version.join(".") }, "resolved the WhatsApp web version");
  return version;
}

function scheduleReconnect(): void {
  if (state.reconnectTimer || state.shuttingDown) return;
  const delay =
    RECONNECT_DELAYS_MS[Math.min(state.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)] ??
    60_000;
  state.reconnectAttempts++;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect().catch((err: unknown) => {
      log.warn({ err }, "WhatsApp reconnect failed");
      scheduleReconnect();
    });
  }, delay);
  state.reconnectTimer.unref();
  log.debug({ delay, attempt: state.reconnectAttempts }, "WhatsApp reconnect scheduled");
}

function disconnectStatusCode(error: unknown): number | undefined {
  const output = (error as { output?: { statusCode?: number } } | undefined)?.output;
  return typeof output?.statusCode === "number" ? output.statusCode : undefined;
}

function dialingConnection(): WhatsAppConnection {
  return state.reconnectAttempts <= CONNECTING_ATTEMPTS ? "connecting" : "off";
}

function handleClose(generation: number, error: unknown): void {
  if (generation !== state.generation) return;
  state.socket = null;
  const statusCode = disconnectStatusCode(error);

  // Refresh a client version rejected as outdated.
  if (statusCode === OUTDATED_VERSION_STATUS) waVersion = null;

  if (statusCode === DisconnectReason.loggedOut) {
    log.info("WhatsApp logged out remotely — clearing the link");
    void wipeLink();
    return;
  }
  if (state.shuttingDown) {
    setConnection("off");
    return;
  }
  if (!isWhatsAppLinked()) {
    log.info({ statusCode }, "WhatsApp pairing ended without a link");
    setConnection("off");
    return;
  }
  if (statusCode !== undefined && UNRECOVERABLE_STATUS.has(statusCode)) {
    // Keep credentials unless the phone explicitly logs out.
    log.warn({ statusCode }, "WhatsApp ended the session — not reconnecting");
    state.reconnectAttempts = 0;
    setConnection("off");
    return;
  }
  setConnection(dialingConnection());
  if (statusCode === DisconnectReason.restartRequired) {
    connect().catch((err: unknown) => {
      log.warn({ err }, "WhatsApp post-pairing restart failed");
      scheduleReconnect();
    });
  } else {
    log.info({ statusCode }, "WhatsApp connection closed — reconnecting");
    scheduleReconnect();
  }
}

async function connect(): Promise<void> {
  if (state.socket || state.shuttingDown) return;
  const generation = ++state.generation;
  const wasLinked = isWhatsAppLinked();
  setConnection(wasLinked ? dialingConnection() : "pairing");

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir());
  const version = await resolveWaVersion();
  const socketLogger = log.child({ lib: "baileys" }, { level: "warn" });
  const socket = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, socketLogger),
    },
    logger: socketLogger,
    browser: Browsers.macOS("Marlene"),
    // Avoid importing the account's full message history.
    syncFullHistory: false,
    // Do not suppress notifications on the user's phone.
    markOnlineOnConnect: false,
  });
  if (generation !== state.generation) {
    void socket.end(undefined);
    return;
  }
  state.socket = socket;

  socket.ev.on("creds.update", (update) => {
    rememberLinked(update.me);
    saveCreds().catch((err: unknown) => {
      log.warn({ err }, "saving the WhatsApp credentials failed");
    });
  });
  socket.ev.on("connection.update", (update) => {
    if (generation !== state.generation) return;
    if (update.qr) {
      setConnection("pairing");
      renderQr(update.qr);
    }
    if (update.connection === "open") {
      state.reconnectAttempts = 0;
      setConnection("open");
    } else if (update.connection === "close") {
      handleClose(generation, update.lastDisconnect?.error);
    }
  });

  const guarded = (what: string, run: () => void) => {
    try {
      run();
    } catch (err) {
      log.warn({ err }, `ingesting WhatsApp ${what} failed`);
    }
  };
  socket.ev.on("messaging-history.set", (payload) => {
    if (generation !== state.generation) return;
    guarded("history", () => ingestHistory(payload));
  });
  socket.ev.on("messages.upsert", ({ messages }) => {
    if (generation !== state.generation) return;
    guarded("messages", () => ingestMessages(messages));
  });
  socket.ev.on("contacts.upsert", (contacts) => {
    if (generation !== state.generation) return;
    guarded("contacts", () => ingestContacts(contacts));
  });
  socket.ev.on("contacts.update", (contacts) => {
    if (generation !== state.generation) return;
    guarded("contacts", () => ingestContacts(contacts));
  });
  socket.ev.on("chats.upsert", (chats) => {
    if (generation !== state.generation) return;
    guarded("chats", () => ingestChats(chats));
  });
}

export function startWhatsApp(): void {
  lastNotifiedLinked = isWhatsAppLinked();
  if (!lastNotifiedLinked) return;
  connect().catch((err: unknown) => {
    log.warn({ err }, "WhatsApp connect on boot failed");
    scheduleReconnect();
  });
}

export async function beginWhatsAppPairing(): Promise<void> {
  state.shuttingDown = false;
  await connect();
}

async function wipeLink(): Promise<void> {
  state.generation++;
  state.linked = null;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.reconnectAttempts = 0;
  const socket = state.socket;
  state.socket = null;
  if (socket) await socket.end(undefined).catch(() => {});
  try {
    rmSync(authDir(), { recursive: true, force: true });
  } catch (err) {
    log.warn({ err }, "removing the WhatsApp auth folder failed");
  }
  await clearWhatsAppStore().catch((err: unknown) => {
    log.warn({ err }, "clearing the WhatsApp mirror failed");
  });
  setConnection("off");
  notifyStatusChanged();
}

export async function unlinkWhatsApp(): Promise<void> {
  const socket = state.socket;
  if (socket && state.connection === "open") {
    await socket.logout().catch((err: unknown) => {
      log.warn({ err }, "remote WhatsApp logout failed — unlinking locally anyway");
    });
  }
  await wipeLink();
}

export async function stopWhatsApp(): Promise<void> {
  state.shuttingDown = true;
  state.generation++;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  const socket = state.socket;
  state.socket = null;
  if (socket) await socket.end(undefined).catch(() => {});
  state.connection = "off";
}
