#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Records the demo project against a seeded isolated server, then puts each
 * recording where a person will find it: an MP4 (WebM without ffmpeg) plus the
 * final screenshot under ~/Movies/agent-demos/marlen, opened in the default
 * player. `--no-open` skips the opening; any other argument narrows the run to
 * demos whose title contains it.
 */

const e2eRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsDir = path.join(e2eRoot, "test-results");
const args = process.argv.slice(2);
const open = !args.includes("--no-open");
const grep = args.filter((arg) => arg !== "--no-open").join(" ");

const run = spawnSync(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "--project=demo",
    "--reporter=list",
    ...(grep ? ["--grep", grep] : []),
  ],
  { cwd: e2eRoot, stdio: "inherit", env: { ...process.env, DEMO: "1" } },
);
if (run.status !== 0) process.exit(run.status ?? 1);

function has(command) {
  return spawnSync(process.platform === "win32" ? "where" : "which", [command]).status === 0;
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

const movies = path.join(homedir(), "Movies");
const outDir = path.join(
  existsSync(movies) ? movies : path.join(homedir(), "Videos"),
  "agent-demos",
  "marlen",
);
mkdirSync(outDir, { recursive: true });
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

const opener =
  process.platform === "darwin"
    ? ["open"]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", ""]
      : ["xdg-open"];
// A result folder is named after its spec file plus a garbled title, so the
// artifact takes the spec's name; a second demo in the same file gets a number.
const specStems = readdirSync(path.join(e2eRoot, "tests"))
  .filter((file) => file.endsWith(".spec.ts"))
  .map((file) => file.replace(/\.spec\.ts$/, ""))
  .sort((a, b) => b.length - a.length);
const used = new Map();
function slugFor(testDir) {
  const base = path.basename(testDir);
  const stem = specStems.find((candidate) => base.startsWith(`${candidate}-`)) ?? base;
  const count = (used.get(stem) ?? 0) + 1;
  used.set(stem, count);
  return count === 1 ? stem : `${stem}-${count}`;
}

const delivered = [];
// Playwright empties test-results before a run, so every recording here is from this one.
for (const webm of [...files(resultsDir)].filter((file) => file.endsWith(".webm"))) {
  const testDir = path.dirname(webm);
  const slug = slugFor(testDir);
  const mp4 = path.join(outDir, `${slug}-${stamp}.mp4`);
  const converted =
    has("ffmpeg") &&
    spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        webm,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4,
      ],
      { stdio: "inherit" },
    ).status === 0;
  const video = converted ? mp4 : path.join(outDir, `${slug}-${stamp}.webm`);
  if (!converted) copyFileSync(webm, video);
  const finalShot = path.join(testDir, "final.png");
  const screenshot = existsSync(finalShot) ? path.join(outDir, `${slug}-${stamp}.png`) : undefined;
  if (screenshot) copyFileSync(finalShot, screenshot);
  delivered.push({ video, screenshot });
  if (open) spawnSync(opener[0], [...opener.slice(1), video], { stdio: "ignore" });
}
process.stdout.write(`${JSON.stringify(delivered, null, 2)}\n`);
