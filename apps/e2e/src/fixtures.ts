import { test as base, expect } from "@playwright/test";
import { TEST_LANGUAGE } from "./i18n.js";
import { type StartedServer, startServer } from "./server.js";

interface WorkerFixtures {
  server: StartedServer;
  /** `test.use({ seeded: true })` boots the worker's server on the demo persona. */
  seeded: boolean;
}

interface TestFixtures {
  serverLogs: undefined;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  seeded: [false, { scope: "worker", option: true }],

  server: [
    async ({ seeded }, use, workerInfo) => {
      const server = await startServer(workerInfo.workerIndex, { seeded });
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],

  baseURL: async ({ server }, use) => {
    await use(server.baseURL);
  },

  // Seed only absent keys because this init script runs on every navigation.
  context: async ({ context }, use) => {
    await context.addInitScript(
      ([language]) => {
        const defaults: Record<string, string> = {
          "marlen-setup-dismissed": "1",
          "marlen-language": language as string,
          "marlen-theme": "light",
        };
        try {
          for (const [key, value] of Object.entries(defaults)) {
            if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
          }
        } catch {}
      },
      [TEST_LANGUAGE],
    );
    await use(context);
  },

  serverLogs: [
    async ({ server }, use, testInfo) => {
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("server.log", { body: server.logs(), contentType: "text/plain" });
      }
    },
    { auto: true },
  ],
});

export { expect };

/** Wait for navigation because the app's SSE connection prevents `networkidle`. */
export async function openApp(page: import("@playwright/test").Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("navigation").first()).toBeVisible();
}
