import { readFileSync } from "node:fs";
import { appVersion } from "../core/version.js";

/**
 * LLM prompt prose, loaded eagerly from the .md files in prompts/ so a missing
 * or renamed file fails at startup, not mid-turn. The files are raw prompt text
 * (every character ships to the model), so they carry no comments. Paths
 * resolve against import.meta.url, which the desktop build copies prompts/ next to.
 */

function read(name: string): string {
  return readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim();
}

/** The writing patterns that mark text as machine-written, spliced in at {{ai-writing-tells}}. */
const aiWritingTells = read("ai-writing-tells");

function withTells(text: string): string {
  return text.replaceAll("{{ai-writing-tells}}", aiWritingTells);
}

export const prompts = {
  /** The base system prompt; buildSystemPrompt appends the conditional sections. */
  system: withTells(read("system")).replaceAll("{{app-version}}", appVersion),
  /** User-facing app documentation, served by app_help, not spliced into any prompt. */
  appGuide: read("app-guide"),
  delegateWorker: read("delegate-worker"),
  compaction: read("compaction"),
  voiceExtract: read("voice-extract"),
  voiceMatch: read("voice-match"),
} as const;
