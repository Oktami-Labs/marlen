import de from "../../web/src/locales/de.json" with { type: "json" };
import en from "../../web/src/locales/en.json" with { type: "json" };

const BUNDLES = { de, en } as const;

export type TestLanguage = keyof typeof BUNDLES;

export const TEST_LANGUAGE: TestLanguage = "de";

function lookup(bundle: unknown, key: string): string {
  let node: unknown = bundle;
  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) return "";
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : "";
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const raw = lookup(BUNDLES[TEST_LANGUAGE], key) || lookup(BUNDLES.en, key);
  if (!raw) throw new Error(`no translation for "${key}" in ${TEST_LANGUAGE} or en`);
  return raw.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
