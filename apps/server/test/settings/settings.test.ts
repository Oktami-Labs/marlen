import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AccountSignature } from "@marlen/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let settings: typeof import("../../src/db/settings.js");
let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "marlen-settings-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  settings = await import("../../src/db/settings.js");
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  await app?.close();
});

async function saveSignature(html: string): Promise<string> {
  const res = await app.inject({
    method: "PUT",
    url: "/api/settings/account-signatures",
    payload: { signatures: [{ accountId: "acc-1", html }] },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ signatures: AccountSignature[] }>().signatures[0]?.html ?? "";
}

describe("settings", () => {
  it("keeps every key when writes race the first read of the cache", async () => {
    // Both writes reach an unpopulated cache, so both trigger a load. Sharing
    // that load is what keeps them in the same Map; without it one write lands
    // in an orphaned copy and reads back as undefined for the process's life.
    await Promise.all([
      settings.setSetting("e2e.first", "one"),
      settings.setSetting("e2e.second", "two"),
      settings.setSetting("e2e.third", "three"),
    ]);

    expect(await settings.getSetting("e2e.first")).toBe("one");
    expect(await settings.getSetting("e2e.second")).toBe("two");
    expect(await settings.getSetting("e2e.third")).toBe("three");
  });

  it("keeps a pasted signature's formatting", async () => {
    const pasted =
      '<table><tr><td style="color:#333">Max Mustermann<br>' +
      '<a href="https://example.com">example.com</a></td></tr></table>';
    const saved = await saveSignature(pasted);
    expect(saved).toContain("Max Mustermann");
    expect(saved).toContain('style="color:#333"');
    expect(saved).toContain('href="https://example.com"');
  });

  it("keeps a sized inline logo through the sanitizer", async () => {
    const pixel =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
    const saved = await saveSignature(
      `<div><img src="data:image/png;base64,${pixel}" width="180" ` +
        `style="width: 180px; height: auto; max-width: 100%;"></div>`,
    );
    expect(saved).toContain(`base64,${pixel}`);
    expect(saved).toContain('width="180"');
    expect(saved).toContain("width: 180px");
  });

  it("strips everything executable from a signature", async () => {
    const saved = await saveSignature(
      [
        "<p>Max Mustermann</p>",
        "<script>fetch('/api/backup')</script>",
        "<script src='https://evil.example/x.js'>",
        '<img src="x" onerror="alert(1)">',
        "<svg/onload=alert(1)>",
        "<a href=javascript:alert(1)>klick</a>",
        '<a href="&#106;avascript:alert(1)">klick</a>',
        '<a href="java&#09;script:alert(1)">klick</a>',
        '<iframe src="https://evil.example"></iframe>',
        '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      ].join(""),
    );

    expect(saved).toContain("Max Mustermann");
    for (const forbidden of ["<script", "onerror", "onload", "<iframe", "<meta", "evil.example"]) {
      expect(saved, `signature still carries ${forbidden}`).not.toContain(forbidden);
    }
    expect(saved.toLowerCase()).not.toContain("javascript:");
  });
});

/**
 * The editor hands this route every http(s) image a pasted signature points
 * at, so it is a fetch driven by copied content. Two things must hold: it
 * cannot be aimed at the machine's own network, and it cannot bring back
 * something that isn't an image.
 */
describe("pasted signature images", () => {
  const fetchImage = (url: string) =>
    app.inject({ method: "POST", url: "/api/settings/signature-image", payload: { url } });

  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );

  it("reads the image Outlook left in the clipboard's temp folder", async () => {
    const file = join(scratch, "clip_image001.png");
    await writeFile(file, PNG);
    const res = await fetchImage(pathToFileURL(file).href);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ dataUri: string }>().dataUri).toBe(
      `data:image/png;base64,${PNG.toString("base64")}`,
    );
  });

  it("reads nothing but an actual image out of that folder", async () => {
    // A path that only ends in .png: the bytes decide, not the name.
    const disguised = join(scratch, "secret.png");
    await writeFile(disguised, "ssh-rsa AAAA...");
    expect((await fetchImage(pathToFileURL(disguised).href)).statusCode).toBe(400);

    const wrongExtension = join(scratch, "notes.txt");
    await writeFile(wrongExtension, PNG);
    expect((await fetchImage(pathToFileURL(wrongExtension).href)).statusCode).toBe(400);
  });

  it("refuses a local image outside the temp folder", async () => {
    const outside = join(process.cwd(), "clipboard-probe.png");
    await writeFile(outside, PNG);
    try {
      expect((await fetchImage(pathToFileURL(outside).href)).statusCode).toBe(400);
    } finally {
      await rm(outside, { force: true });
    }
  });

  /**
   * Sandboxed Outlook and Word on macOS have their temp dir redirected into
   * their own container, so their clipboard images never appear in tmpdir().
   * Their container tree also holds the app's own data, which stays as
   * unreadable as any other local file.
   */
  it.runIf(process.platform === "darwin")(
    "reads a clipboard image out of a sandboxed app's container temp folder",
    async () => {
      // Outside the OS temp dir on purpose: inside it every path passes on the
      // first rule and the container shape would never be exercised.
      const fakeHome = await mkdtemp(join(process.cwd(), "marlen-home-test-"));
      const container = join(fakeHome, "Library", "Containers", "com.microsoft.Outlook", "Data");
      await mkdir(join(container, "tmp"), { recursive: true });
      await mkdir(join(container, "Library"), { recursive: true });
      const clipboard = join(container, "tmp", "clip_image001.png");
      const appData = join(container, "Library", "avatar.png");
      await writeFile(clipboard, PNG);
      await writeFile(appData, PNG);

      const home = process.env.HOME;
      process.env.HOME = fakeHome;
      try {
        expect((await fetchImage(pathToFileURL(clipboard).href)).statusCode).toBe(200);
        expect((await fetchImage(pathToFileURL(appData).href)).statusCode).toBe(400);
      } finally {
        if (home === undefined) delete process.env.HOME;
        else process.env.HOME = home;
        await rm(fakeHome, { recursive: true, force: true });
      }
    },
  );

  it("refuses addresses that are not somewhere on the web", async () => {
    for (const url of [
      "http://127.0.0.1:3001/api/status",
      "http://localhost/logo.png",
      "http://[::1]/logo.png",
      "http://192.168.1.10/logo.png",
      "http://10.0.0.5/logo.png",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "not a url",
    ]) {
      const res = await fetchImage(url);
      expect(res.statusCode, `${url} was fetched`).toBe(400);
    }
  });
});
