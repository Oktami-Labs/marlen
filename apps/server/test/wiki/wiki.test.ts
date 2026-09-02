import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let wikiDir: string;
let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;

interface Page {
  id: string;
  revision: string;
  type: string | null;
  content: string;
  source: string;
  accountId: string | null;
  contactId: string | null;
  pinned: boolean;
}

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-wiki-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  const home = await import("../../src/storage/home/agentHome.js");
  await home.ensureAgentHome();
  wikiDir = home.wikiDir();
  app = await (await import("../../src/app.js")).buildApp();
}, 120_000);

afterAll(async () => {
  await app?.close();
});

async function post(content: string, extra: Partial<Page> & { name?: string } = {}): Promise<Page> {
  const res = await app.inject({
    method: "POST",
    url: "/api/wiki",
    payload: { content, ...extra },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Page>();
}

async function list(): Promise<Page[]> {
  return (await app.inject({ method: "GET", url: "/api/wiki" })).json<Page[]>();
}

describe("wiki", () => {
  it("stores a page as a slug-named markdown file", async () => {
    const page = await post("Der Kunde bevorzugt Besichtigungen am Vormittag.");
    expect(page.id).toBe("der-kunde-bevorzugt-besichtigungen-am-vormittag");
    expect(await readdir(wikiDir)).toContain(`${page.id}.md`);
  });

  it("keeps summary and body together in one page", async () => {
    const content = "Huber GmbH: Bestandskunde seit 2024.\n\nHistorie: zwei Einheiten gekauft.";
    const page = await post(content, { name: "huber-gmbh-history" });
    expect(page.id).toBe("huber-gmbh-history");
    expect(page.content).toBe(content);
  });

  it("dedups within one scope but allows the same fact in another", async () => {
    await post("Signatur endet mit Beste Grüße.");
    await post("Signatur endet mit Beste Grüße.");
    expect((await list()).filter((p) => p.content.startsWith("Signatur"))).toHaveLength(1);

    const scoped = await post("Signatur endet mit Beste Grüße.", { accountId: "acc-1" });
    expect(scoped.accountId).toBe("acc-1");
    expect((await list()).filter((p) => p.content.startsWith("Signatur"))).toHaveLength(2);
  });

  it("rejects empty and oversized content as 400", async () => {
    for (const content of ["   ", "x".repeat(20_001)]) {
      const res = await app.inject({ method: "POST", url: "/api/wiki", payload: { content } });
      expect(res.statusCode).toBe(400);
    }
  });

  it("moves scope on update, clearing the other axis, and keeps the page's id", async () => {
    const page = await post("Frau Weber duzt man nicht.", { contactId: "Weber@Example.com" });
    expect(page.contactId).toBe("weber@example.com");

    const res = await app.inject({
      method: "PUT",
      url: `/api/wiki/${page.id}`,
      payload: {
        content: "Frau Weber wird gesiezt.",
        accountId: "acc-2",
        baseRevision: page.revision,
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Page>();
    expect(updated.accountId).toBe("acc-2");
    expect(updated.contactId).toBeNull();
    expect(updated.id).toBe(page.id);
    expect(updated.content).toBe("Frau Weber wird gesiezt.");
    expect(await readdir(wikiDir)).toContain(`${page.id}.md`);
  });

  it("finds pages by subject words in any inflection, rarest words first", async () => {
    await post("Maier GmbH: Bestandskunde seit 2024.\n\nHistorie: zwei Objekte gekauft.", {
      name: "maier-gmbh",
    });
    await post("Termine mit Herrn Maier immer vormittags.", { name: "maier-termine" });
    await post("Besichtigungen dauern eine Stunde.", { name: "besichtigungen" });

    const search = async (q: string) =>
      (await app.inject({ method: "GET", url: `/api/wiki?q=${encodeURIComponent(q)}` }))
        .json<Page[]>()
        .map((p) => p.id);

    expect(await search("Maier Termin")).toEqual(["maier-termine", "maier-gmbh"]);
    expect(await search("Objekt")).toEqual(["maier-gmbh"]);
    expect(await search("Stunden")).toEqual(["besichtigungen"]);
    expect(await search("zzz-nothing")).toEqual([]);
  });

  it("keeps a skill's id stable across content edits", async () => {
    const skill = await post("Nachfassen bei stillen Leads.\n\nFrage freundlich nach.", {
      name: "Follow Up",
      type: "skill",
    });
    expect(skill.id).toBe("follow-up");
    expect(skill.type).toBe("skill");

    const overwrite = await app.inject({
      method: "POST",
      url: "/api/wiki",
      payload: {
        name: "Follow Up",
        content: "A stale create must not replace the existing skill.",
        type: "skill",
      },
    });
    expect(overwrite.statusCode).toBe(400);

    const res = await app.inject({
      method: "PUT",
      url: "/api/wiki/follow-up",
      payload: {
        content: "Nachfassen nach drei Tagen.\n\nFrage freundlich und knapp nach.",
        baseRevision: skill.revision,
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Page>();
    expect(updated.id).toBe("follow-up");
    expect(updated.type).toBe("skill");
    expect(await readdir(wikiDir)).toContain("follow-up.md");
  });

  it("rejects an update based on an older page revision", async () => {
    const page = await post("Original knowledge.", { name: "revision-check" });
    expect(page.revision).toBeTruthy();

    const first = await app.inject({
      method: "PUT",
      url: `/api/wiki/${page.id}`,
      payload: { content: "First editor wins.", baseRevision: page.revision },
    });
    expect(first.statusCode).toBe(200);

    const stale = await app.inject({
      method: "PUT",
      url: `/api/wiki/${page.id}`,
      payload: { content: "Stale editor overwrites it.", baseRevision: page.revision },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: string }>().error).toMatch(/changed.*reload/i);
    expect((await list()).find((entry) => entry.id === page.id)?.content).toBe(
      "First editor wins.",
    );
  });

  it("deletes a page's file", async () => {
    const page = await post("Wegwerfnotiz für den Löschtest.");
    const res = await app.inject({ method: "DELETE", url: `/api/wiki/${page.id}` });
    expect(res.statusCode).toBe(200);
    expect(await readdir(wikiDir)).not.toContain(`${page.id}.md`);
  });

  it("treats a hand-dropped bare markdown file as a global user page", async () => {
    await writeFile(join(wikiDir, "handnotiz.md"), "Der Steuerberater heißt Schulz.\n", "utf8");
    const page = (await list()).find((p) => p.id === "handnotiz");
    expect(page?.content).toBe("Der Steuerberater heißt Schulz.");
    expect(page?.source).toBe("user");
    expect(page?.type).toBeNull();
    expect(page?.accountId).toBeNull();
    expect(page?.contactId).toBeNull();
  });
});
