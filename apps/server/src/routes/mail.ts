import { extname } from "node:path";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { MailSearchHit, MailSearchResponse } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { findAccount } from "../agent/accounts.js";
import { badRequest, notFound, toProviderError } from "../core/errors.js";
import { contentDisposition, inlineForMime, mimeForExt } from "../core/utils/fileResponse.js";
import { errorMessage } from "../core/utils/util.js";
import { fetchAttachment } from "../email/attachmentFetch.js";
import { getMailReadProvider, type ThreadDetail } from "../email/read/readProviders.js";
import { listAccounts } from "../integrations/pipedream/connect.js";
import { saveUpload } from "../storage/library/ingest.js";

const attachmentQuery = Type.Object({
  accountId: Type.String(),
  messageId: Type.String(),
  filename: Type.String(),
});

const attachmentBody = Type.Object({
  accountId: Type.String(),
  messageId: Type.String(),
  filename: Type.String(),
});

const threadQuery = Type.Object({
  accountId: Type.String(),
  // Empty would reach the provider as a malformed id query (Graph: ErrorInvalidIdEmpty).
  threadId: Type.String({ minLength: 1 }),
});

const searchQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 500 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
});

export const mailRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/api/mail/search",
    { schema: { querystring: searchQuery } },
    async (req): Promise<MailSearchResponse> => {
      const text = req.query.q?.trim() ?? "";
      const limit = req.query.limit ?? 12;
      const accounts = await listAccounts();
      const searched = await Promise.all(
        accounts.map(async (account) => {
          const provider = getMailReadProvider(account.app);
          if (!provider) return { items: [] as MailSearchHit[], failed: false };
          try {
            const messages = await provider.searchMessages(account, {
              ...(text ? { text } : {}),
              folder: text ? "all" : "inbox",
              limit,
            });
            return {
              failed: false,
              items: messages.map((message) => ({
                threadId: message.threadId,
                accountId: account.id,
                accountName: account.name,
                messageId: message.messageId,
                subject: message.subject,
                from: message.from,
                date: message.date,
                snippet: message.snippet,
              })),
            };
          } catch (error) {
            req.log.warn({ err: error, accountId: account.id }, "searching mail account failed");
            return { items: [] as MailSearchHit[], failed: true };
          }
        }),
      );

      return {
        items: searched
          .flatMap((result) => result.items)
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
          .slice(0, limit),
        partial: searched.some((result) => result.failed),
      };
    },
  );

  // The served MIME comes from the filename extension, never the provider's
  // declared type, so foreign content can't be served as executable text/html.
  app.get(
    "/api/mail/attachments/open",
    { schema: { querystring: attachmentQuery } },
    async (req, reply) => {
      const { accountId, messageId, filename } = req.query;
      const { filename: name, bytes } = await fetchAttachment(accountId, messageId, filename).catch(
        (error: unknown) => {
          // A provider 404 means the message is gone; anything else is a 502,
          // never the raw SDK error whose statusCode (e.g. a Pipedream 401)
          // would masquerade as this API's own.
          throw toProviderError(error, "attachment not found");
        },
      );

      const mime = mimeForExt(extname(name));
      const disposition = contentDisposition(inlineForMime(mime) ? "inline" : "attachment", name);
      return reply
        .header("Content-Type", mime)
        .header("Content-Disposition", disposition)
        .send(bytes);
    },
  );

  app.post("/api/mail/attachments/save", { schema: { body: attachmentBody } }, async (req) => {
    const { accountId, messageId, filename } = req.body;
    const { filename: name, bytes } = await fetchAttachment(accountId, messageId, filename).catch(
      (error: unknown) => {
        throw toProviderError(error, "attachment not found");
      },
    );
    try {
      return { saved: await saveUpload(name, bytes) };
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
  });

  app.get(
    "/api/mail/threads",
    { schema: { querystring: threadQuery } },
    async (req): Promise<ThreadDetail> => {
      const { accountId, threadId } = req.query;
      const account = findAccount(await listAccounts(), accountId);
      if (!account) throw notFound("connected account not found");

      const provider = getMailReadProvider(account.app);
      if (!provider) throw badRequest(`${account.app} has no thread read support`);

      const thread = await provider.getThread(account, threadId).catch((error: unknown) => {
        throw toProviderError(error, "thread not found");
      });
      if (!thread) throw notFound("thread not found");
      return thread;
    },
  );
};
