import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Automation,
  ChatMessage,
  ConversationListResponse,
  Lead,
  LibraryStatus,
  PinnedRun,
  Todo,
  WikiPage,
} from "@marlen/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
let seed: typeof import("../../src/services/demo/seed.js");
let settings: typeof import("../../src/db/settings.js");
let DEMO: typeof import("../../src/services/demo/fixtures.js").DEMO;

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-demo-seed-"));
  process.env.AGENT_HOME_PATH = join(scratch, "home");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  seed = await import("../../src/services/demo/seed.js");
  settings = await import("../../src/db/settings.js");
  ({ DEMO } = await import("../../src/services/demo/fixtures.js"));
  await seed.seedDemo();
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  await app?.close();
});

const get = async <T>(url: string): Promise<T> => {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res.json<T>();
};

/** What each panel would render, as one comparable snapshot. */
async function counts() {
  const [todos, leads, chats, runs, pages, library, automations] = await Promise.all([
    get<Todo[]>("/api/todos"),
    get<Lead[]>("/api/leads"),
    get<ConversationListResponse>("/api/conversations?type=chat"),
    get<{ total: number }>("/api/runs"),
    get<WikiPage[]>("/api/wiki"),
    get<LibraryStatus>("/api/library"),
    get<Automation[]>("/api/automations"),
  ]);
  return {
    todos: todos.length,
    leads: leads.length,
    chats: chats.total,
    runs: runs.total,
    pages: pages.length,
    documents: library.documents.length,
    automations: automations.length,
  };
}

describe("demo seed", () => {
  it("puts the persona in front of every panel", async () => {
    const pinned = await get<{ items: PinnedRun[] }>("/api/runs/pinned");
    expect(pinned.items.map((item) => item.automation.name)).toEqual([
      DEMO.briefingAutomation,
      DEMO.weeklyAutomation,
    ]);
    const report = pinned.items[0]?.run?.cards?.[0]?.card;
    if (report?.kind !== "report") throw new Error("the pinned run carries no report card");
    expect(report.headline).toBe(DEMO.briefingHeadline);
    expect(report.sections.map((section) => section.label)).toContain(DEMO.waitingSection);
    const items = report.sections.flatMap((section) => section.items);
    expect(items.map((item) => item.change)).toEqual(
      expect.arrayContaining(["new", "updated", "carried"]),
    );
    expect(items.some((item) => item.handled)).toBe(true);

    const todos = await get<Todo[]>("/api/todos?status=open");
    const decision = todos.find((todo) => todo.title === DEMO.decisionQuestion);
    expect(decision?.options.map((option) => option.label)).toContain(DEMO.decisionAnswer);
    const approvals = todos.filter((todo) => todo.kind === "approval");
    expect(approvals.map((todo) => todo.ref?.kind)).toEqual(
      expect.arrayContaining(["email_draft", "outbound"]),
    );
    expect(approvals.find((todo) => todo.body === DEMO.approvalQuestion)?.options).toHaveLength(2);

    const leads = await get<Lead[]>("/api/leads");
    expect(leads.map((lead) => lead.status)).toEqual(
      expect.arrayContaining(["new", "contacted", "engaged", "qualified", "won", "lost"]),
    );

    const chats = await get<ConversationListResponse>("/api/conversations?type=chat");
    expect(chats.items.map((chat) => chat.title)).toContain(DEMO.acmeChat);
    const acme = chats.items.find((chat) => chat.title === DEMO.acmeChat);
    const messages = await get<ChatMessage[]>(`/api/conversations/${acme?.id}/messages`);
    const last = messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.cards?.[0]?.card.kind).toBe("email_draft");
    expect(last?.toolCalls?.length).toBeGreaterThan(0);

    const pages = await get<WikiPage[]>("/api/wiki");
    expect(pages.find((page) => page.id === DEMO.acmePage)?.type).toBe("company");
    expect(pages.some((page) => page.type === "skill")).toBe(true);

    const library = await get<LibraryStatus>("/api/library");
    expect(library.documents.filter((doc) => doc.status === "indexed").length).toBeGreaterThan(4);
    expect(library.documents.some((doc) => doc.status === "error")).toBe(true);
  });

  it("reseeds in place without duplicating anything", async () => {
    const before = await counts();
    await seed.seedDemo();
    expect(await counts()).toEqual(before);
  });

  it("reset empties the content, keeps settings, and the defaults return with the next seed", async () => {
    await settings.setSetting("app.language", "en");
    await seed.resetContent();

    expect(await counts()).toEqual({
      todos: 0,
      leads: 0,
      chats: 0,
      runs: 0,
      pages: 0,
      documents: 0,
      automations: 0,
    });
    expect(await settings.getSetting("app.language")).toBe("en");

    await seed.seedDemo();
    const automations = await get<Automation[]>("/api/automations");
    expect(automations.map((automation) => automation.name)).toEqual(
      expect.arrayContaining([DEMO.briefingAutomation, DEMO.statsAutomation]),
    );
    expect(automations.filter((automation) => automation.pinned).map((a) => a.name)).toEqual(
      expect.arrayContaining([DEMO.briefingAutomation, DEMO.weeklyAutomation]),
    );
  });
});
