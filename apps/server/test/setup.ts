import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate every destructive migration input from real user data.
const scratch = mkdtempSync(join(tmpdir(), "marlen-test-"));
process.env.AGENT_HOME_PATH ??= join(scratch, "home");
process.env.LEGACY_AGENT_HOME_PATH ??= join(scratch, "legacy-home");
process.env.DATABASE_PATH ??= join(scratch, "marlen.db");
process.env.SKILLS_PATH ??= join(scratch, "legacy-skills");
process.env.LIBRARY_PATH ??= join(scratch, "legacy-library");
