import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { lazyStatement } from "../db/index.js";
import { buildFtsMatch } from "../db/sql.js";
import { textResult, tool } from "./toolkit.js";

interface ConversationHit {
  conversationId: string;
  title: string;
  role: "user" | "assistant";
  createdAt: string;
  snippet: string;
}

const searchStmt = lazyStatement(`
  SELECT m.conversation_id AS conversationId,
         c.title AS title,
         m.role AS role,
         m.created_at AS createdAt,
         snippet(messages_fts, 0, '', '', ' … ', 28) AS snippet
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    JOIN conversations c ON c.id = m.conversation_id
   WHERE messages_fts MATCH ?
     AND c.type = 'chat'
     AND c.id <> ?
     AND m.role IN ('user', 'assistant')
   ORDER BY bm25(messages_fts), m.created_at DESC
   LIMIT ?
`);

function search(query: string, conversationId: string, limit: number): ConversationHit[] {
  const run = (match: string | null) =>
    match ? (searchStmt().all(match, conversationId, limit) as ConversationHit[]) : [];
  const strict = run(buildFtsMatch(query, "AND"));
  return strict.length > 0 ? strict : run(buildFtsMatch(query, "OR"));
}

/** Search is explicit: old chats stay out of every prompt until the model needs one. */
export function buildConversationSearchTool(conversationId: string): AgentTool {
  return tool({
    name: "conversation_search",
    label: "Search past chats",
    description:
      "Search the user's earlier Marlen conversations when they refer to a prior discussion, " +
      "decision or answer that is not present in this chat, or when a run needs to know what " +
      "the user has been asking for. Returns matched excerpts with the conversation id, title, " +
      "speaker and date. Do not use it speculatively on every turn.",
    params: {
      query: Type.String({
        minLength: 1,
        description: "Concrete names, topics or phrases to find.",
      }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12, default: 6 })),
    },
    execute: async ({ query, limit = 6 }) => {
      const hits = search(query.trim(), conversationId, limit);
      if (hits.length === 0) return textResult("No earlier chat matched that search.");
      return textResult(
        hits
          .map(
            (hit, index) =>
              `${index + 1}. ${hit.title} · ${hit.createdAt} · ${hit.role} ` +
              `· conversation ${hit.conversationId}\n${hit.snippet}`,
          )
          .join("\n\n"),
      );
    },
  });
}
