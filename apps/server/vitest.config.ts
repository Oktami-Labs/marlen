import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // An empty test/ directory is a valid state and must not fail `pnpm check`.
    passWithNoTests: true,
    // Most behavioral suites boot a full Fastify app, SQLite database and the
    // agent module graph. Give that real setup room to finish and keep boots
    // serial instead of making them compete for the same machine.
    hookTimeout: 120_000,
    testTimeout: 15_000,
    maxWorkers: 1,
    // Isolates AGENT_HOME_PATH so no test can write the real agent home.
    setupFiles: ["./test/setup.ts"],
  },
});
