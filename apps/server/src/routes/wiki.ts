import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { badRequest, notFound } from "../core/errors.js";
import { errorMessage } from "../core/utils/util.js";
import {
  createPage,
  deletePage,
  listPages,
  updatePage,
  writeNamedPage,
} from "../storage/wiki/store.js";

const pageBody = Type.Object({
  content: Type.String(),
  // Chosen page id on create (required for skills); ignored on update.
  name: Type.Optional(Type.String()),
  type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  // null clears this scope axis; omitted keeps it on update, except that setting
  // one axis moves the page there (the other clears). A page carries accountId
  // OR contactId, never both; sending both non-null is rejected (wiki/store.ts).
  accountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const idParams = Type.Object({ id: Type.String() });

// Pages are injected into the system prompt, rebuilt every turn (and per
// scheduled run), so an edit reaches the next message with no session reset.
export const wikiRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/wiki", async () => listPages());

  app.post("/api/wiki", { schema: { body: pageBody } }, async (req) => {
    const { content, name, type, accountId, contactId } = req.body;
    try {
      if (name?.trim()) {
        return await writeNamedPage(name, content, "user", { type, accountId, contactId });
      }
      const result = await createPage(content, "user", { type, accountId, contactId });
      return result.page;
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
  });

  app.put("/api/wiki/:id", { schema: { params: idParams, body: pageBody } }, async (req) => {
    let page: Awaited<ReturnType<typeof updatePage>>;
    try {
      page = await updatePage(req.params.id, req.body.content, {
        type: req.body.type,
        accountId: req.body.accountId,
        contactId: req.body.contactId,
      });
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    if (!page) throw notFound("wiki page not found");
    return page;
  });

  app.delete("/api/wiki/:id", { schema: { params: idParams } }, async (req) => {
    const deleted = await deletePage(req.params.id);
    if (!deleted) throw notFound("wiki page not found");
    return { ok: true };
  });
};
