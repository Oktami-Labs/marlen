import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Each worker gets an isolated cwd, state directory, port, and empty credentials. */

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");

const SERVER_ENTRY = join(repoRoot, "apps/server/src/index.ts");
const SEED_SCRIPT = join(repoRoot, "apps/server/scripts/seed-demo.ts");
const TSX_BIN = join(
  repoRoot,
  "apps/server/node_modules/.bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
const WEB_DIST = join(repoRoot, "apps/web/dist");

const BASE_PORT = 3210;
const READY_TIMEOUT_MS = 90_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface TestServer {
  baseURL: string;
  stateDir: string;
  logs: () => string;
}

/** Empty values prevent Node's env-file loader from restoring real credentials. */
const NEUTRALIZED = [
  "PIPEDREAM_CLIENT_ID",
  "PIPEDREAM_CLIENT_SECRET",
  "PIPEDREAM_PROJECT_ID",
  "PIPEDREAM_EXTERNAL_USER_ID",
  "ONOFFICE_TOKEN",
  "ONOFFICE_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "LOG_FILE",
  "DESKTOP_LOG_PATH",
] as const;

function serverEnv(stateDir: string, port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...Object.fromEntries(NEUTRALIZED.map((name) => [name, ""])),
    NODE_ENV: "test",
    PORT: String(port),
    HOST: "127.0.0.1",
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
    DATABASE_PATH: join(stateDir, "marlen.db"),
    AGENT_HOME_PATH: join(stateDir, "agent-home"),
    // Keep migration sources inside the worker's state directory.
    LEGACY_AGENT_HOME_PATH: join(stateDir, "legacy-home"),
    LIBRARY_PATH: join(stateDir, "legacy-library"),
    SKILLS_PATH: join(stateDir, "legacy-skills"),
    // Never reuse the developer's linked-device credentials.
    WHATSAPP_AUTH_PATH: join(stateDir, "whatsapp-auth"),
    // A stray CRM call can only reach a closed local port, never onOffice.
    ONOFFICE_API_URL: "http://127.0.0.1:9/onoffice-must-not-be-called",
    WEB_DIST_PATH: WEB_DIST,
  };
}

async function assertIsolated(baseURL: string): Promise<void> {
  const pipedream = (await (await fetch(`${baseURL}/api/pipedream`)).json()) as {
    configured: boolean;
  };
  if (pipedream.configured) {
    throw new Error(
      "e2e refused to start: the test server picked up real Pipedream credentials. " +
        "Linking or deleting accounts from a test would hit a live project.",
    );
  }
  const onoffice = (await (await fetch(`${baseURL}/api/onoffice`)).json()) as {
    configured: boolean;
  };
  if (onoffice.configured) {
    throw new Error("e2e refused to start: the test server picked up real onOffice credentials.");
  }
  const whatsapp = (await (await fetch(`${baseURL}/api/whatsapp`)).json()) as { linked: boolean };
  if (whatsapp.linked) {
    throw new Error(
      "e2e refused to start: the test server found a linked WhatsApp account. " +
        "Connecting would take over the real device session.",
    );
  }
}

async function waitForReady(baseURL: string, child: ChildProcess, logs: () => string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`the test server exited before it was ready.\n\n${logs()}`);
    }
    try {
      const res = await fetch(`${baseURL}/api/status`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the test server did not answer within ${READY_TIMEOUT_MS}ms.\n\n${logs()}`);
}

export interface StartedServer extends TestServer {
  stop: () => Promise<void>;
}

export interface StartServerOptions {
  /** Fill the state directory with the demo persona before the server boots. */
  seeded?: boolean;
}

export async function startServer(
  workerIndex: number,
  options: StartServerOptions = {},
): Promise<StartedServer> {
  if (!existsSync(WEB_DIST)) {
    throw new Error(
      `${WEB_DIST} is missing — the server serves the SPA from it.\n` +
        "Run `pnpm --filter @marlen/web build` (or `pnpm test:e2e`, which builds first).",
    );
  }
  if (!existsSync(TSX_BIN)) {
    throw new Error(`${TSX_BIN} is missing — run \`pnpm install\` at the repo root.`);
  }

  const stateDir = await mkdtemp(join(tmpdir(), `marlen-e2e-w${workerIndex}-`));
  const port = BASE_PORT + workerIndex;
  const baseURL = `http://127.0.0.1:${port}`;

  // Seeding before boot lets the server index the knowledge files and read
  // the account colors the way it would on any install.
  if (options.seeded) {
    const seed = spawnSync(TSX_BIN, [SEED_SCRIPT, "--yes"], {
      cwd: stateDir,
      env: serverEnv(stateDir, port),
      encoding: "utf8",
    });
    if (seed.status !== 0) {
      await rm(stateDir, { recursive: true, force: true });
      throw new Error(`seeding the demo data failed:\n${seed.stdout}${seed.stderr}`);
    }
  }

  const child = spawn(TSX_BIN, [SERVER_ENTRY], {
    cwd: stateDir,
    env: serverEnv(stateDir, port),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 200_000) output = output.slice(-100_000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const logs = () => output.trim() || "(no server output)";

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill("SIGTERM");
      const forced = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_TIMEOUT_MS);
      await exited;
      clearTimeout(forced);
    }
    if (!process.env.E2E_KEEP_STATE) await rm(stateDir, { recursive: true, force: true });
  };

  try {
    await waitForReady(baseURL, child, logs);
    await assertIsolated(baseURL);
  } catch (error) {
    await stop();
    throw error;
  }

  return { baseURL, stateDir, logs, stop };
}
