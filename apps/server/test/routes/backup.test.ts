import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_ZIP_COMMENT_SIZE = 65_535;

function readZip(buffer: Buffer): Map<string, Buffer> {
  let endOffset = -1;
  const firstPossibleOffset = Math.max(0, buffer.length - END_RECORD_SIZE - MAX_ZIP_COMMENT_SIZE);
  for (let offset = buffer.length - END_RECORD_SIZE; offset >= firstPossibleOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("ZIP end record not found");

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let directoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(directoryOffset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error(`invalid ZIP directory entry ${index}`);
    }
    const method = buffer.readUInt16LE(directoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(directoryOffset + 20);
    const nameLength = buffer.readUInt16LE(directoryOffset + 28);
    const extraLength = buffer.readUInt16LE(directoryOffset + 30);
    const commentLength = buffer.readUInt16LE(directoryOffset + 32);
    const localOffset = buffer.readUInt32LE(directoryOffset + 42);
    const name = buffer.toString("utf8", directoryOffset + 46, directoryOffset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`invalid local ZIP header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(contentOffset, contentOffset + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(compressed));
    else if (method === 8) entries.set(name, inflateRawSync(compressed));
    else throw new Error(`unsupported ZIP compression method ${method}`);

    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "marlen-export-test-"));
  const agentHome = join(scratch, "agent-home");
  const dataDir = join(agentHome, "data");
  const serverLogs = join(scratch, "server-logs");
  const desktopLogs = join(scratch, "desktop-logs");

  process.env.DATABASE_PATH = join(dataDir, "marlen.db");
  process.env.AGENT_HOME_PATH = agentHome;
  process.env.WHATSAPP_AUTH_PATH = join(dataDir, "whatsapp-auth");
  process.env.LOG_FILE = join(serverLogs, "marlen.log");
  process.env.DESKTOP_LOG_PATH = join(desktopLogs, "main.log");
  process.env.MARLEN_APP_VERSION = "9.8.7-test";
  process.env.LOG_LEVEL = "silent";
  process.env.ONOFFICE_TOKEN = "";
  process.env.ONOFFICE_SECRET = "";

  await Promise.all([
    mkdir(join(agentHome, "wiki"), { recursive: true }),
    mkdir(join(agentHome, "knowledge"), { recursive: true }),
    mkdir(join(dataDir, "whatsapp-auth"), { recursive: true }),
    mkdir(serverLogs, { recursive: true }),
    mkdir(desktopLogs, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(agentHome, "wiki", "customer.md"), "support-wiki-memory"),
    writeFile(join(agentHome, "knowledge", "case.txt"), "support-knowledge-document"),
    writeFile(join(serverLogs, "marlen.99.log"), "support-server-log"),
    writeFile(join(desktopLogs, "main.old.log"), "support-desktop-log"),
    writeFile(join(dataDir, "auth.json"), '{"apiKey":"auth-file-secret"}'),
    writeFile(
      join(dataDir, "pipedream-secret.json"),
      '{"clientSecret":"pipedream-credential-value"}',
    ),
    writeFile(join(dataDir, "whatsapp-auth", "creds.json"), '{"token":"whatsapp-secret"}'),
  ]);

  app = await (await import("../../src/app.js")).buildApp();
  const saved = await app.inject({
    method: "PUT",
    url: "/api/onoffice",
    payload: { token: "onoffice-token-value", secret: "onoffice-credential-value" },
  });
  expect(saved.statusCode).toBe(200);

  const { db, schema } = await import("../../src/db/index.js");
  await db.insert(schema.conversations).values({
    id: "support-chat",
    title: "Support chat",
    createdAt: "2026-09-01T12:00:00.000Z",
  });
  await db.insert(schema.messages).values({
    id: "support-message",
    conversationId: "support-chat",
    role: "user",
    content: "support-chat-history",
    createdAt: "2026-09-01T12:00:01.000Z",
  });
  await db.insert(schema.settings).values({
    key: "pipedream.clientSecret",
    value: "legacy-database-credential",
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
});

describe("full data export", () => {
  it("exports support data while leaving application credential stores out", async () => {
    const response = await app.inject({ method: "GET", url: "/api/backup" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-disposition"]).toMatch(/marlen-export-.*\.zip/);

    const entries = readZip(response.rawPayload);
    expect(entries.get("agent-home/wiki/customer.md")?.toString()).toBe("support-wiki-memory");
    expect(entries.get("agent-home/knowledge/case.txt")?.toString()).toBe(
      "support-knowledge-document",
    );
    expect(entries.get("logs/server/marlen.99.log")?.toString()).toBe("support-server-log");
    expect(entries.get("logs/desktop/main.old.log")?.toString()).toBe("support-desktop-log");
    expect([...entries.keys()].filter((name) => name.startsWith("agent-home/data/"))).toEqual([]);

    const manifest = JSON.parse(entries.get("manifest.json")?.toString() ?? "") as {
      appVersion: string;
      files: { agentHome: number; serverLogs: number; desktopLogs: number };
      excludedCredentialStores: string[];
      redactedDatabaseSettings: string[];
    };
    expect(manifest).toMatchObject({
      appVersion: "9.8.7-test",
      files: { agentHome: 2, desktopLogs: 1 },
    });
    expect(manifest.files.serverLogs).toBeGreaterThanOrEqual(1);
    expect(manifest.excludedCredentialStores).toContain("data/auth.json");
    expect(manifest.redactedDatabaseSettings).toEqual(["pipedream.clientSecret"]);

    const exportedDbPath = join(scratch, "exported.db");
    await writeFile(exportedDbPath, entries.get("database/marlen.db") ?? Buffer.alloc(0));
    const exportedDb = new Database(exportedDbPath, { readonly: true });
    try {
      const message = exportedDb
        .prepare("SELECT content FROM messages WHERE id = ?")
        .get("support-message") as { content: string } | undefined;
      expect(message?.content).toBe("support-chat-history");
      const legacyCredential = exportedDb
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("pipedream.clientSecret");
      expect(legacyCredential).toBeUndefined();
    } finally {
      exportedDb.close();
    }

    const contents = Buffer.concat([...entries.values()]).toString("utf8");
    for (const secret of [
      "auth-file-secret",
      "pipedream-credential-value",
      "legacy-database-credential",
      "onoffice-token-value",
      "onoffice-credential-value",
      "whatsapp-secret",
    ]) {
      expect(contents).not.toContain(secret);
    }
  });
});
