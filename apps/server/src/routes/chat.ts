import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { ChatStreamEvent, Conversation, ConversationListResponse } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { parseStoredCards } from "../agent/cards.js";
import { parseStoredRefs } from "../agent/emailRefs.js";
import { applyConversationFocus, clearConversationFocus } from "../agent/focus.js";
import { parseStoredToolCalls } from "../agent/history.js";
import { liveTurn, startLiveTurn } from "../agent/liveTurns.js";
import { buildSystemPrompt } from "../agent/prompt.js";
import { isRateLimitFailure } from "../agent/run.js";
import { disposeSession } from "../agent/sessionCache.js";
import {
  beginTurn,
  isTurnInFlight,
  stopTurn,
  type Turn,
  TurnInFlightError,
  TurnStoppedError,
} from "../agent/turnRecorder.js";
import { badRequest, conflict, requireRow } from "../core/errors.js";
import { emitServerEvent } from "../core/events.js";
import { errorMessage } from "../core/utils/util.js";
import { deleteConversationCascade } from "../db/conversationStore.js";
import { db, lazyStatement, schema } from "../db/index.js";
import { likeContains, likePattern } from "../db/like.js";
import { buildFtsMatch } from "../db/sql.js";
import { openSse } from "./sse.js";

const conversationsQuery = Type.Object({
  q: Type.Optional(Type.String()),
  type: Type.Optional(Type.Union([Type.Literal("chat"), Type.Literal("automation")])),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const idParams = Type.Object({ id: Type.String() });

const conversationPatchBody = Type.Object({
  title: Type.Optional(Type.String()),
  focusAccountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const chatBody = Type.Object({
  conversationId: Type.Optional(Type.String()),
  focusAccountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  message: Type.String(),
  refs: Type.Optional(
    Type.Array(
      Type.Object({
        threadId: Type.String(),
        accountId: Type.String(),
        accountName: Type.Optional(Type.String()),
        messageId: Type.Optional(Type.String()),
        subject: Type.Optional(Type.String()),
        from: Type.Optional(Type.String()),
        date: Type.Optional(Type.String()),
      }),
      { maxItems: 8 },
    ),
  ),
});

const messageMatchStmt = lazyStatement(`
  SELECT DISTINCT m.conversation_id AS conversationId
  FROM messages_fts
  JOIN messages m ON m.rowid = messages_fts.rowid
  WHERE messages_fts MATCH ?
`);

const conversationActivity = db
  .select({
    conversationId: schema.messages.conversationId,
    updatedAt: sql<string>`max(${schema.messages.createdAt})`.as("updated_at"),
  })
  .from(schema.messages)
  .groupBy(schema.messages.conversationId)
  .as("conversation_activity");

const rankedUserMessages = db
  .select({
    conversationId: schema.messages.conversationId,
    preview:
      sql<string>`trim(substr(replace(replace(${schema.messages.content}, char(13), ' '), char(10), ' '), 1, 160))`.as(
        "preview",
      ),
    rank: sql<number>`row_number() over (
      partition by ${schema.messages.conversationId}
      order by ${schema.messages.createdAt} desc, ${schema.messages.id} desc
    )`.as("message_rank"),
  })
  .from(schema.messages)
  .where(eq(schema.messages.role, "user"))
  .as("ranked_user_messages");

const lastActivityAt = sql<string>`coalesce(
  ${conversationActivity.updatedAt},
  ${schema.conversations.createdAt}
)`;

const conversationPreview = sql<string | null>`case
  when ${schema.conversations.type} = 'chat' then ${rankedUserMessages.preview}
  else null
end`;

export const chatRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/api/conversations",
    { schema: { querystring: conversationsQuery } },
    async (req): Promise<ConversationListResponse> => {
      const q = req.query.q?.trim();
      const limit = Math.min(req.query.limit ?? 50, 200);
      const offset = req.query.offset ?? 0;

      // Empty FTS syntax falls back to title matching.
      const pattern = q ? likeContains(q) : undefined;
      const ftsMatch = q ? buildFtsMatch(q, "AND") : null;
      const matchedConversationIds = ftsMatch
        ? (messageMatchStmt().all(ftsMatch) as { conversationId: string }[]).map(
            (row) => row.conversationId,
          )
        : [];
      const searchWhere = pattern
        ? or(
            likePattern(schema.conversations.title, pattern),
            ...(matchedConversationIds.length > 0
              ? [inArray(schema.conversations.id, matchedConversationIds)]
              : []),
          )
        : undefined;
      const typeWhere = req.query.type ? eq(schema.conversations.type, req.query.type) : undefined;
      const where = and(typeWhere, searchWhere);

      const itemsQuery = db
        .select({
          id: schema.conversations.id,
          title: schema.conversations.title,
          type: schema.conversations.type,
          focusAccountId: schema.conversations.focusAccountId,
          focusThreadId: schema.conversations.focusThreadId,
          focusThreadSubject: schema.conversations.focusThreadSubject,
          createdAt: schema.conversations.createdAt,
          updatedAt: lastActivityAt.as("updated_at"),
          preview: conversationPreview,
        })
        .from(schema.conversations)
        .leftJoin(
          conversationActivity,
          eq(conversationActivity.conversationId, schema.conversations.id),
        )
        .leftJoin(
          rankedUserMessages,
          and(
            eq(rankedUserMessages.conversationId, schema.conversations.id),
            eq(rankedUserMessages.rank, 1),
          ),
        );
      const items = await (where ? itemsQuery.where(where) : itemsQuery)
        .orderBy(desc(lastActivityAt), desc(schema.conversations.createdAt))
        .limit(limit)
        .offset(offset);

      const totalQuery = db.select({ count: sql<number>`count(*)` }).from(schema.conversations);
      const [totalRow] = await (where ? totalQuery.where(where) : totalQuery);

      return {
        items: items.map((item) => ({ ...item, running: isTurnInFlight(item.id) })),
        total: Number(totalRow?.count ?? 0),
      };
    },
  );

  app.get(
    "/api/conversations/:id",
    { schema: { params: idParams } },
    async (req): Promise<Conversation> => {
      const conversation = await requireRow(
        db.select().from(schema.conversations).where(eq(schema.conversations.id, req.params.id)),
        "not found",
      );
      return { ...conversation, running: isTurnInFlight(conversation.id) };
    },
  );

  app.patch(
    "/api/conversations/:id",
    { schema: { params: idParams, body: conversationPatchBody } },
    async (req) => {
      const { title, focusAccountId } = req.body;
      if (title === undefined && focusAccountId === undefined) {
        throw badRequest("nothing to update");
      }
      const trimmed = title?.trim();
      if (title !== undefined && !trimmed) throw badRequest("title is required");
      await requireRow(
        db
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, req.params.id)),
        "not found",
      );

      if (trimmed) {
        await db
          .update(schema.conversations)
          .set({ title: trimmed })
          .where(eq(schema.conversations.id, req.params.id));
        emitServerEvent("conversations");
      }

      if (focusAccountId === null) {
        await clearConversationFocus(req.params.id);
      } else if (focusAccountId !== undefined) {
        await applyConversationFocus(req.params.id, {
          accountId: focusAccountId,
          threadId: null,
        });
      }
      return { ok: true };
    },
  );

  app.delete("/api/conversations/:id", { schema: { params: idParams } }, async (req) => {
    await requireRow(
      db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, req.params.id)),
      "not found",
    );
    // Do not delete while the turn can still append its assistant row.
    if (isTurnInFlight(req.params.id)) {
      throw conflict("a reply is in progress for this conversation");
    }
    // Remove the cached session before deleting its transcript.
    disposeSession(req.params.id);
    deleteConversationCascade(req.params.id);
    return { ok: true };
  });

  app.get("/api/chat/system-prompt", async () => ({ prompt: await buildSystemPrompt() }));

  app.get("/api/chat/:id/live", { schema: { params: idParams } }, async (req) => ({
    turn: liveTurn(req.params.id),
  }));

  app.get("/api/conversations/:id/messages", { schema: { params: idParams } }, async (req) => {
    const rows = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, req.params.id),
          inArray(schema.messages.role, ["user", "assistant"]),
        ),
      )
      .orderBy(schema.messages.createdAt);

    return rows.map(({ cards, toolCalls, refs, memoryIds, compactionCutoff: _, ...row }) => ({
      ...row,
      cards: parseStoredCards(cards),
      toolCalls: parseStoredToolCalls(toolCalls),
      refs: parseStoredRefs(refs),
      memoryIds: memoryIds ? (JSON.parse(memoryIds) as string[]) : undefined,
    }));
  });

  app.post("/api/chat", { schema: { body: chatBody } }, async (req, reply) => {
    const message = req.body.message.trim();
    if (!message) throw badRequest("message is required");

    // Acquire the turn guard before hijacking the HTTP response.
    const conversationId = req.body.conversationId ?? randomUUID();
    let turn: Turn;
    try {
      turn = beginTurn(conversationId);
    } catch (error) {
      if (error instanceof TurnInFlightError) {
        throw conflict("a reply is already in progress for this conversation");
      }
      throw error;
    }

    // A disconnected client does not cancel the durable turn.
    const stream = openSse<ChatStreamEvent>(reply, () => {});
    const send = (event: ChatStreamEvent) => stream.send(event);

    let streamedText = "";
    const live = startLiveTurn(conversationId);
    try {
      emitServerEvent("conversations");

      send({ type: "conversation", conversationId });

      let thinkingSent = false;
      const { text } = await turn.run({
        prompt: message,
        refs: req.body.refs,
        focusAccountId: req.body.focusAccountId,
        session: "pooled",
        conversation: { type: "chat", title: message.slice(0, 80) },
        handlers: {
          onTextDelta: (delta) => {
            streamedText += delta;
            live.text(delta);
            send({ type: "text_delta", delta });
          },
          onThinking: () => {
            if (!thinkingSent) {
              thinkingSent = true;
              live.thinking();
              send({ type: "thinking" });
            }
          },
          onToolStart: (toolCallId, toolName, toolLabel, parameters) => {
            live.toolStart({
              id: toolCallId,
              name: toolName,
              label: toolLabel,
              isError: false,
              done: false,
              parameters,
              contentOffset: streamedText.length,
            });
            send({
              type: "tool_start",
              toolCallId,
              toolName,
              toolLabel,
              parameters,
              contentOffset: streamedText.length,
            });
          },
          onToolUpdate: (toolCallId, toolName, detail) => {
            live.toolUpdate(toolCallId, detail);
            send({ type: "tool_update", toolCallId, toolName, detail });
          },
          onToolEnd: (toolCallId, toolName, isError, result) => {
            live.toolEnd(toolCallId, isError, result);
            send({ type: "tool_end", toolCallId, toolName, isError, result });
          },
          onCard: (toolCallId, card) => {
            live.card(toolCallId, card);
            send({ type: "card", toolCallId, card });
          },
        },
        log: req.log.child({ conversationId }),
      });

      send({ type: "done", text });
    } catch (error) {
      if (error instanceof TurnStoppedError) {
        send({ type: "stopped", text: error.text });
        return;
      }
      req.log.error(error, "chat failed");
      const message = errorMessage(error);
      send(
        isRateLimitFailure(message)
          ? { type: "error", message, kind: "rate_limit" }
          : { type: "error", message },
      );
    } finally {
      live.finish();
      emitServerEvent("conversations");
      stream.end();
    }
  });

  app.post("/api/chat/:id/stop", { schema: { params: idParams } }, async (req) => {
    return { stopped: stopTurn(req.params.id) };
  });
};
