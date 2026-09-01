import { createReadStream, createWriteStream, type Dirent, type Stats } from "node:fs";
import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, posix, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { type ArchiverError, ZipArchive } from "archiver";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../core/env.js";
import { moduleLogger } from "../core/logger.js";
import { contentDisposition } from "../core/utils/fileResponse.js";
import { appVersion } from "../core/version.js";
import { sqlite } from "../db/index.js";
import { settings } from "../db/schema.js";
import { getAgentHomeDir } from "../storage/home/agentHome.js";

const log = moduleLogger("backup");

interface BundleFile {
  source: string;
  name: string;
  stats: Stats;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function collectFiles(
  root: string,
  archiveRoot: string,
  include: (parts: string[]) => boolean = () => true,
  exclude: (source: string) => boolean = () => false,
): Promise<BundleFile[]> {
  const files: BundleFile[] = [];

  const visit = async (dir: string, parentParts: string[]): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const parts = [...parentParts, entry.name];
      const source = join(dir, entry.name);
      if (exclude(source)) continue;
      let stats: Stats;
      try {
        stats = await lstat(source);
      } catch (error) {
        if (hasCode(error, "ENOENT")) continue;
        throw error;
      }
      if (stats.isDirectory()) {
        await visit(source, parts);
      } else if (stats.isFile() && include(parts)) {
        files.push({ source, name: posix.join(archiveRoot, ...parts), stats });
      }
    }
  };

  await visit(root, []);
  return files;
}

function isUnsafeAgentHomeExportPath(source: string): boolean {
  const path = resolve(source);
  const databasePath = resolve(process.cwd(), env.databasePath);
  const dataDir = dirname(databasePath);
  const whatsappDir = resolve(process.cwd(), env.whatsappAuthPath);
  if (path === whatsappDir || path.startsWith(whatsappDir + sep)) return true;
  if (dirname(path) !== dataDir) return false;

  const name = basename(path);
  const databaseName = basename(databasePath);
  if (
    name === databaseName ||
    name.startsWith(`${databaseName}-`) ||
    name.startsWith(`${databaseName}.`)
  ) {
    return true;
  }
  return ["auth.json", "pipedream-secret.json", "onoffice-secret.json"].some(
    (secret) => name === secret || name.startsWith(`${secret}.`) || name.startsWith(`.${secret}.`),
  );
}

async function collectLogs(configuredPath: string | undefined, archiveRoot: string) {
  if (!configuredPath) return [];
  const path = resolve(process.cwd(), configuredPath);
  const extension = extname(path);
  const stem = basename(path, extension);
  return collectFiles(dirname(path), archiveRoot, (parts) => {
    if (parts.length !== 1) return false;
    const [name] = parts;
    return (
      name === basename(path) ||
      (name?.startsWith(`${stem}.`) === true && (!extension || name.endsWith(extension)))
    );
  });
}

const README = `Marlene data export

This archive contains private customer data. Share it only with Marlene support.

Included:
- the complete SQLite database, including chat history, tool calls, drafts, and automations
- the agent home, including wiki memory and original knowledge files
- available server and desktop diagnostic logs

Excluded:
- AI provider sign-ins and API keys
- Pipedream and onOffice credentials
- WhatsApp session keys

Chats and documents are preserved verbatim. A credential pasted into their content remains part of that content.
`;

function sanitizeDatabaseExport(path: string): void {
  const snapshot = new Database(path);
  try {
    // DELETE mode commits into the one file we ship; VACUUM removes the deleted secret from free pages.
    snapshot.pragma("journal_mode = DELETE");
    drizzle(snapshot).delete(settings).where(eq(settings.key, "pipedream.clientSecret")).run();
    snapshot.exec("VACUUM");
  } finally {
    snapshot.close();
  }
}

async function buildArchive(tempDir: string): Promise<string> {
  const databasePath = join(tempDir, "marlen.db");
  const archivePath = join(tempDir, "marlen-export.zip");

  await sqlite.backup(databasePath);
  sanitizeDatabaseExport(databasePath);

  const [agentFiles, serverLogs, desktopLogs] = await Promise.all([
    collectFiles(getAgentHomeDir(), "agent-home", () => true, isUnsafeAgentHomeExportPath),
    collectLogs(env.logFile, "logs/server"),
    collectLogs(env.desktopLogPath, "logs/desktop"),
  ]);

  const manifest = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    system: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.versions.node,
    },
    databaseSchemaVersion: sqlite.pragma("user_version", { simple: true }) as number,
    files: {
      agentHome: agentFiles.length,
      serverLogs: serverLogs.length,
      desktopLogs: desktopLogs.length,
    },
    excludedCredentialStores: [
      "data/auth.json",
      "data/pipedream-secret.json",
      "data/onoffice-secret.json",
      "data/whatsapp-auth/",
    ],
    redactedDatabaseSettings: ["pipedream.clientSecret"],
  };

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (error: ArchiverError) => {
    if (hasCode(error, "ENOENT")) {
      log.warn({ err: error }, "export source disappeared while building the archive");
      return;
    }
    archive.destroy(error);
  });
  archive.append(README, { name: "README.txt" });
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: "manifest.json" });
  archive.file(databasePath, { name: "database/marlen.db" });
  for (const file of [...agentFiles, ...serverLogs, ...desktopLogs]) {
    archive.file(file.source, { name: file.name, stats: file.stats });
  }

  const writing = pipeline(archive, createWriteStream(archivePath));
  await Promise.all([archive.finalize(), writing]);
  return archivePath;
}

async function cleanTempDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch((error: unknown) =>
    log.warn({ err: error, tempDir }, "removing export temp folder failed"),
  );
}

export const backupRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/backup", async (_req, reply) => {
    const tempDir = await mkdtemp(join(tmpdir(), "marlen-export-"));
    let archivePath: string;
    try {
      archivePath = await buildArchive(tempDir);
    } catch (error) {
      await cleanTempDir(tempDir);
      throw error;
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const stream = createReadStream(archivePath);
    stream.on("close", () => void cleanTempDir(tempDir));
    return reply
      .header("Content-Type", "application/zip")
      .header("Cache-Control", "no-store")
      .header("Content-Disposition", contentDisposition("attachment", `marlen-export-${stamp}.zip`))
      .send(stream);
  });
};
