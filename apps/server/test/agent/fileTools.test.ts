import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let fileToolsFor: typeof import("../../src/agent/fileTools.js").fileToolsFor;
let home: string;

const NO_GRANTS = { read: false, write: false, bash: false };
const ALL_GRANTS = { read: true, write: true, bash: true };

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "marlen-filetools-home-"));
  process.env.AGENT_HOME_PATH = home;
  ({ fileToolsFor } = await import("../../src/agent/fileTools.js"));
  await mkdir(join(home, "wiki"), { recursive: true });
  await writeFile(join(home, "notiz.md"), "Der Inhalt der Notiz.\n", "utf8");
});

describe("confined file tools", () => {
  it("reads inside the home and rejects escapes with steering text", async () => {
    const tools = await fileToolsFor(NO_GRANTS, true, home);
    const read = tools.find((t) => t.name === "file_read");
    if (!read) throw new Error("file_read not mounted");

    const inside = await read.execute("t1", { path: "notiz.md" });
    expect(resultText(inside)).toContain("Der Inhalt der Notiz.");

    for (const path of ["../outside.md", "/etc/passwd", "~/anything"]) {
      const result = await read.execute("t2", { path });
      expect(resultText(result)).toContain("outside your Marlene home folder");
    }
  });

  it("mounts no write or bash tools unattended, regardless of grants", async () => {
    const tools = await fileToolsFor(ALL_GRANTS, false, home);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["file_ls", "file_find", "file_grep", "file_read"]);
    // Unattended read stays confined even with the read grant armed.
    const read = tools.find((t) => t.name === "file_read");
    if (!read) throw new Error("file_read not mounted");
    const result = await read.execute("t3", { path: "/etc/passwd" });
    expect(resultText(result)).toContain("outside your Marlene home folder");
  });

  it("swaps in unconfined variants when grants are armed interactively", async () => {
    const tools = await fileToolsFor(ALL_GRANTS, true, home);
    const names = tools.map((t) => t.name);
    expect(names).toContain("file_write");
    expect(names).toContain("file_bash");
    // With the read grant armed the same tool name reaches beyond the home.
    const read = tools.find((t) => t.name === "file_read");
    if (!read) throw new Error("file_read not mounted");
    const outside = await mkdtemp(join(tmpdir(), "marlen-filetools-outside-"));
    await writeFile(join(outside, "extern.txt"), "Draußen.\n", "utf8");
    const result = await read.execute("t4", { path: join(outside, "extern.txt") });
    expect(resultText(result)).toContain("Draußen.");
  });

  it("routes wiki writes through the page store even with filesystem write access", async () => {
    const tools = await fileToolsFor(ALL_GRANTS, true, home);
    const write = tools.find((tool) => tool.name === "file_write");
    if (!write) throw new Error("file_write not mounted");

    const path = join(home, "wiki", "raw-bypass.md");
    const result = await write.execute("t5", { path, content: "unmanaged memory" });
    expect(resultText(result)).toContain("write and change pages with page_write and page_update");
    await expect(access(path)).rejects.toThrow();
  });
});
