import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { WikiPage } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { badRequest, conflict, notFound } from "../core/errors.js";
import { errorMessage } from "../core/utils/util.js";
import { searchPages } from "../storage/wiki/search.js";
import {
  createPage,
  deletePage,
  listPages,
  updatePage,
  WikiPageConflictError,
  writeNamedPage,
} from "../storage/wiki/store.js";

/** Ranked hits a search returns; the unfiltered listing is the whole wiki. */
const SEARCH_LIMIT = 50;

const pageProperties = {
  content: Type.String(),
  // Chosen page id on create (required for skills); ignored on update.
  name: Type.Optional(Type.String()),
  type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  // null clears this scope axis; omitted keeps it on update, except that setting
  // one axis moves the page there (the other clears). A page carries accountId
  // OR contactId, never both; sending both non-null is rejected (wiki/store.ts).
  accountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  pinned: Type.Optional(Type.Boolean()),
};

const pageBody = Type.Object(pageProperties);
const pageUpdateBody = Type.Object({
  ...pageProperties,
  baseRevision: Type.String(),
});

const idParams = Type.Object({ id: Type.String() });

// Pages are injected into the system prompt, rebuilt every turn (and per
// scheduled run), so an edit reaches the next message with no session reset.
export const wikiRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/api/wiki",
    { schema: { querystring: Type.Object({ q: Type.Optional(Type.String()) }) } },
    async (req): Promise<WikiPage[]> => {
      const pages = await listPages();
      const query = req.query.q?.trim();
      if (!query) return pages;
      return searchPages(pages, query, SEARCH_LIMIT).map((hit) => hit.page);
    },
  );

  app.post("/api/wiki", { schema: { body: pageBody } }, async (req) => {
    const { content, name, type, accountId, contactId, pinned } = req.body;
    try {
      if (name?.trim()) {
        return await writeNamedPage(name, content, "user", {
          type,
          accountId,
          contactId,
          pinned,
        });
      }
      const result = await createPage(content, "user", { type, accountId, contactId, pinned });
      return result.page;
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
  });

  app.put("/api/wiki/:id", { schema: { params: idParams, body: pageUpdateBody } }, async (req) => {
    let page: WikiPage | null;
    try {
      page = await updatePage(
        req.params.id,
        req.body.content,
        {
          type: req.body.type,
          accountId: req.body.accountId,
          contactId: req.body.contactId,
          pinned: req.body.pinned,
        },
        { baseRevision: req.body.baseRevision },
      );
    } catch (error) {
      if (error instanceof WikiPageConflictError) {
        throw conflict("wiki page changed since it was opened; reload it and apply the edit again");
      }
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
