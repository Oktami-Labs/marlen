import { resolve } from "node:path";

/**
 * Fill this instance with the demo persona (src/services/demo/). Run from
 * apps/server so the same cwd-relative paths as `pnpm dev` apply, or set
 * DATABASE_PATH and AGENT_HOME_PATH for another instance.
 *
 *   pnpm seed:demo                 add or refresh the demo rows next to existing data
 *   pnpm seed:demo --reset --yes   empty all content first (settings and credentials stay)
 */

process.env.LOG_LEVEL ??= "warn";

const args = process.argv.slice(2);
const known = new Set(["--reset", "--yes"]);
const unknown = args.filter((arg) => !known.has(arg));
if (unknown.length > 0) {
  process.stderr.write(`unknown argument ${unknown.join(" ")}; use --reset and --yes\n`);
  process.exit(2);
}
const reset = args.includes("--reset");
const confirmed = args.includes("--yes");

const { env } = await import("../src/core/env.js");
const { getAgentHomeDir } = await import("../src/storage/home/agentHome.js");
const dbPath = resolve(process.cwd(), env.databasePath);
const home = getAgentHomeDir();

if (reset && !confirmed) {
  process.stderr.write(
    `--reset empties every conversation, run, todo, lead, draft, wiki page and knowledge file in\n` +
      `  ${dbPath}\n  ${home}\n` +
      "Settings and credentials stay. Add --yes to confirm.\n",
  );
  process.exit(1);
}

const { closeDb } = await import("../src/db/index.js");
const { resetContent, seedDemo } = await import("../src/services/demo/seed.js");
try {
  if (reset) {
    await resetContent();
    process.stdout.write("Content reset; settings and credentials kept.\n");
  }
  const summary = await seedDemo();
  process.stdout.write(
    `Seeded ${summary.automations} automations, ${summary.runs} runs, ${summary.chats} chats, ` +
      `${summary.todos} todos, ${summary.leads} leads, ${summary.wikiPages} wiki pages and ` +
      `${summary.documents} documents (${summary.documentErrors} unreadable) into\n  ${dbPath}\n  ${home}\n` +
      "Restart a running server so it picks up the account colors.\n",
  );
} finally {
  closeDb();
}
