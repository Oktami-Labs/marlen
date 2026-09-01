import { and, eq } from "drizzle-orm";
import { resolveCheapModel } from "../../agent/llm/registry.js";
import { runOneShot } from "../../agent/oneShot.js";
import { emitServerEvent } from "../../core/events.js";
import { moduleLogger } from "../../core/logger.js";
import { db, schema } from "../../db/index.js";

const log = moduleLogger("conversationTitle");
const TITLE_MAX_CHARS = 80;

function cleanTitle(value: string): string {
  return (
    value
      .split("\n", 1)[0]
      ?.replace(/^[\s"'„“”`#*-]+|[\s"'„“”`#*-]+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, TITLE_MAX_CHARS)
      .trim() ?? ""
  );
}

/** Improve only the untouched provisional title; a user's rename always wins. */
export async function titleNewConversation(
  conversationId: string,
  provisionalTitle: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  try {
    const model = await resolveCheapModel();
    const raw = await runOneShot({
      model,
      systemPrompt:
        "Name a personal-assistant conversation in 3–7 specific words. Capture its actual topic " +
        "or outcome, not the opening phrase. Return only the title, with no quotes or punctuation.",
      prompt:
        `User:\n${userText.slice(0, 2_000)}\n\n` + `Assistant:\n${assistantText.slice(0, 2_000)}`,
    });
    const title = cleanTitle(raw);
    if (!title || title === provisionalTitle) return;
    const changed = await db
      .update(schema.conversations)
      .set({ title })
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.title, provisionalTitle),
        ),
      );
    if (changed.changes > 0) emitServerEvent("conversations");
  } catch (error) {
    log.warn({ err: error, conversationId }, "generating a conversation title failed");
  }
}
