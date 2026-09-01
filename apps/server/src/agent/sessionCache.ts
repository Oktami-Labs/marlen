import type { Agent } from "@earendil-works/pi-agent-core";
import { moduleLogger, type TurnLogger } from "../core/logger.js";
import { forgetSeenMail } from "../email/read/seenMail.js";
import { buildAgent } from "./assembly.js";
import { sessionCapabilities } from "./capabilities.js";
import { compactedMessages } from "./compaction.js";
import { type EmailToolset, loadEmailTools } from "./emailToolset.js";
import { loadHistory, recordCompactionMarker } from "./history.js";
import { buildSystemPrompt } from "./prompt.js";
import { type RunHandlers, runPrompt } from "./run.js";

const log = moduleLogger("sessionCache");

export interface AgentSession {
  agent: Agent;
  toolset: EmailToolset;
  inFlight: number;
  retired: boolean;
  lastUsed: number;
  runTurn(
    prompt: string,
    handlers?: RunHandlers,
    signal?: AbortSignal,
    log?: TurnLogger,
  ): Promise<string>;
}

export interface EphemeralSessionOptions {
  /** Rebuild the durable transcript before creating this one-run agent. */
  resumeHistory?: boolean;
  /** Isolates transient provider evidence from the transcript's stable id. */
  toolSessionId?: string;
}

function createAgentSession(
  agent: Agent,
  toolset: EmailToolset,
  conversationId: string,
): AgentSession {
  const session: AgentSession = {
    agent,
    toolset,
    inFlight: 0,
    retired: false,
    lastUsed: Date.now(),
    async runTurn(prompt, handlers, signal, turnLog) {
      session.inFlight++;
      try {
        return await runPrompt(session, prompt, {
          handlers,
          signal,
          log: turnLog,
          compact: async (options) => {
            const next = await compactedMessages(session.agent.state, turnLog, options);
            if (!next) return false;
            session.agent.state.messages = next;
            await recordCompactionMarker(conversationId, next).catch((err: unknown) => {
              (turnLog ?? log).warn(
                { err, conversationId },
                "persisting the compaction marker failed",
              );
            });
            return true;
          },
        });
      } finally {
        session.inFlight--;
        session.lastUsed = Date.now();
        if (session.retired && session.inFlight === 0) closeToolset(session, conversationId);
      }
    },
  };
  return session;
}

const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const SESSION_MAX_COUNT = 20;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map<string, AgentSession>();
const pendingSessions = new Map<string, Promise<AgentSession>>();

function closeToolset(session: AgentSession, conversationId: string): void {
  forgetSeenMail(conversationId);
  void session.toolset.close().catch((err: unknown) => {
    log.warn({ err, conversationId }, "closing a retired session's MCP sessions failed");
  });
}

/** Never close a toolset while its turn is running. */
function retireSession(conversationId: string, session: AgentSession): void {
  sessions.delete(conversationId);
  if (session.inFlight > 0) {
    session.retired = true;
    return;
  }
  closeToolset(session, conversationId);
}

function sweepSessions(): void {
  const now = Date.now();
  for (const [conversationId, session] of sessions) {
    if (session.inFlight > 0) continue;
    if (now - session.lastUsed > SESSION_IDLE_TTL_MS) retireSession(conversationId, session);
  }
  if (sessions.size > SESSION_MAX_COUNT) {
    const evictable = [...sessions.entries()]
      .filter(([, session]) => session.inFlight === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [conversationId, session] of evictable.slice(0, sessions.size - SESSION_MAX_COUNT)) {
      retireSession(conversationId, session);
    }
  }
}

const sweepTimer = setInterval(sweepSessions, SESSION_SWEEP_INTERVAL_MS);
sweepTimer.unref();

export async function getOrCreateSession(conversationId: string): Promise<AgentSession> {
  const existing = sessions.get(conversationId);
  if (existing) {
    existing.lastUsed = Date.now();
    // Refresh mutable context without changing a stable provider prefix.
    existing.agent.state.systemPrompt = await buildSystemPrompt();
    return existing;
  }

  // Share one session creation per conversation.
  const inFlight = pendingSessions.get(conversationId);
  if (inFlight) return inFlight;

  const creation = (async (): Promise<AgentSession> => {
    const caps = await sessionCapabilities(true);
    const toolsetPromise = loadEmailTools({ interactive: caps.interactive });
    try {
      const [toolset, history] = await Promise.all([toolsetPromise, loadHistory(conversationId)]);
      const session = createAgentSession(
        await buildAgent(toolset, history, caps, conversationId),
        toolset,
        conversationId,
      );
      sessions.set(conversationId, session);
      if (sessions.size > SESSION_MAX_COUNT) sweepSessions();
      return session;
    } catch (error) {
      // The toolset may have opened connections before session creation failed.
      await toolsetPromise
        .then((t) => t.close())
        .catch((err: unknown) => {
          log.warn({ err, conversationId }, "closing the failed session's MCP sessions failed");
        });
      throw error;
    }
  })();
  pendingSessions.set(conversationId, creation);
  try {
    return await creation;
  } finally {
    pendingSessions.delete(conversationId);
  }
}

export function resetSessions(): void {
  for (const [conversationId, session] of [...sessions]) retireSession(conversationId, session);
}

export function disposeSession(conversationId: string): void {
  const session = sessions.get(conversationId);
  if (session) retireSession(conversationId, session);
}

export async function createEphemeralSession(
  conversationId: string,
  options: EphemeralSessionOptions = {},
): Promise<AgentSession> {
  const [caps, history] = await Promise.all([
    sessionCapabilities(false),
    options.resumeHistory ? loadHistory(conversationId) : Promise.resolve([]),
  ]);
  const toolset = await loadEmailTools({ interactive: caps.interactive });
  try {
    return createAgentSession(
      await buildAgent(
        toolset,
        history,
        caps,
        options.toolSessionId ?? conversationId,
        conversationId,
      ),
      toolset,
      conversationId,
    );
  } catch (error) {
    await toolset.close().catch((err: unknown) => {
      log.warn({ err }, "closing the ephemeral session's MCP sessions failed");
    });
    throw error;
  }
}
