import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { isLanguage, SUPPORTED_LANGUAGES } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { resetSessions } from "../agent/sessionCache.js";
import { badRequest } from "../core/errors.js";
import { emitServerEvent } from "../core/events.js";
import {
  getAccountColors,
  getAccountPermissions,
  getAccountSignatures,
  getFileAccessSettings,
  getLanguageSetting,
  getTimezoneSetting,
  isValidTimezone,
  setAccountColors,
  setAccountPermissions,
  setAccountSignatures,
  setFileAccessSettings,
} from "../db/settings.js";
import { setLanguagePreference, setTimezonePreference } from "../services/appPreferences.js";
import { fetchInlineImage } from "../services/signatureImage.js";

const languageBody = Type.Object({ language: Type.String() });

const timezoneBody = Type.Object({ timezone: Type.String() });

const accountPermissionsBody = Type.Object({
  permissions: Type.Array(
    Type.Object({
      accountId: Type.String(),
      write: Type.Boolean(),
      send: Type.Boolean(),
      delete: Type.Boolean(),
    }),
  ),
});

const fileAccessBody = Type.Object({
  read: Type.Boolean(),
  write: Type.Boolean(),
  bash: Type.Boolean(),
});

const accountColorsBody = Type.Object({
  colors: Type.Array(Type.Object({ accountId: Type.String(), hex: Type.String() })),
});

// Includes inline image data after base64 expansion.
const accountSignaturesBody = Type.Object({
  signatures: Type.Array(
    Type.Object({ accountId: Type.String(), html: Type.String({ maxLength: 1_500_000 }) }),
  ),
});

const signatureImageBody = Type.Object({ url: Type.String({ maxLength: 4096 }) });

const ACTIVE_ELEMENTS = "script|style|iframe|object|embed|form|template|noscript";

/** Remove executable content while preserving mail-client signature layout. */
function sanitizeSignatureHtml(html: string): string {
  return (
    html
      .replace(new RegExp(`<(${ACTIVE_ELEMENTS})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "")
      // Remove unclosed active tags and redirect-capable metadata.
      .replace(new RegExp(`<\\/?(?:${ACTIVE_ELEMENTS}|base|meta|link)\\b[^>]*>`, "gi"), "")
      // HTML accepts slash as an event-handler attribute separator.
      .replace(/[\s/]+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(
        /\b(href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (whole, attribute: string, quoted?: string, single?: string, bare?: string) =>
          isScriptUrl(quoted ?? single ?? bare ?? "") ? `${attribute}="#"` : whole,
      )
  );
}

function decodeCodePoint(raw: string, base: number): string {
  const code = Number.parseInt(raw, base);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

function isScriptUrl(value: string): boolean {
  const normalized = value
    .replace(/&#x([0-9a-f]+);?/gi, (_whole, hex: string) => decodeCodePoint(hex, 16))
    .replace(/&#(\d+);?/g, (_whole, dec: string) => decodeCodePoint(dec, 10))
    // Browsers ignore controls and spaces inside a URL scheme.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\x00-\x20\x7f]/g, "")
    .toLowerCase();
  return normalized.startsWith("javascript:") || normalized.startsWith("vbscript:");
}

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/settings/language", async () => ({ language: await getLanguageSetting() }));

  app.put("/api/settings/language", { schema: { body: languageBody } }, async (req) => {
    const language = req.body.language;
    if (!isLanguage(language)) {
      throw badRequest(`language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}`);
    }
    await setLanguagePreference(language);
    return { language };
  });

  app.get("/api/settings/timezone", async () => ({ timezone: await getTimezoneSetting() }));

  app.put("/api/settings/timezone", { schema: { body: timezoneBody } }, async (req) => {
    const timezone = req.body.timezone;
    if (!isValidTimezone(timezone)) {
      throw badRequest("timezone must be a valid IANA timezone");
    }
    await setTimezonePreference(timezone);
    return { timezone };
  });

  app.get("/api/settings/permissions", async () => ({
    permissions: await getAccountPermissions(),
  }));

  app.put(
    "/api/settings/permissions",
    { schema: { body: accountPermissionsBody } },
    async (req) => {
      // Last entry wins; absence is the read-only default.
      const byId = new Map(req.body.permissions.map((p) => [p.accountId, p]));
      const permissions = [...byId.values()].filter((p) => p.write || p.send || p.delete);
      await setAccountPermissions(permissions);
      resetSessions();
      emitServerEvent("accounts");
      return { permissions };
    },
  );

  app.get("/api/settings/file-access", async () => ({
    fileAccess: await getFileAccessSettings(),
  }));

  app.put("/api/settings/file-access", { schema: { body: fileAccessBody } }, async (req) => {
    const fileAccess = req.body;
    await setFileAccessSettings(fileAccess);
    resetSessions();
    return { fileAccess };
  });

  app.get("/api/settings/account-colors", async () => ({
    colors: await getAccountColors(),
  }));

  app.put("/api/settings/account-colors", { schema: { body: accountColorsBody } }, async (req) => {
    await setAccountColors(req.body.colors);
    emitServerEvent("accounts");
    return { colors: req.body.colors };
  });

  app.post(
    "/api/settings/signature-image",
    { schema: { body: signatureImageBody } },
    async (req) => ({ dataUri: await fetchInlineImage(req.body.url) }),
  );

  app.get("/api/settings/account-signatures", async () => ({
    signatures: await getAccountSignatures(),
  }));

  app.put(
    "/api/settings/account-signatures",
    { schema: { body: accountSignaturesBody } },
    async (req) => {
      const byId = new Map(
        req.body.signatures.map((s) => [
          s.accountId,
          { accountId: s.accountId, html: sanitizeSignatureHtml(s.html).trim() },
        ]),
      );
      const signatures = [...byId.values()].filter((s) => s.html);
      await setAccountSignatures(signatures);
      resetSessions();
      emitServerEvent("accounts");
      return { signatures };
    },
  );
};
