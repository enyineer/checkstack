import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("browser-safety guard", () => {
  // This foundation leaf is imported by `*-common` packages that ship to the
  // browser (logstream-common, metricstream-common). A top-level `node:*`
  // import here would make Vite externalize the module and break the entire
  // frontend plugin at load time - the exact regression that split the pure
  // wire codec out of the backend-only ingest-utils. No shipped source file
  // may import a node builtin. (Test files are exempt; they never ship.)
  it("no shipped source file imports a node builtin", () => {
    const offenders: string[] = [];
    walk(import.meta.dir, offenders);
    expect(offenders).toEqual([]);
  });
});

/** Recursively collect shipped `.ts` files that import a `node:` builtin. */
function walk(dir: string, offenders: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, offenders);
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    const content = readFileSync(full, "utf8");
    if (/from\s+["']node:|require\(["']node:/.test(content)) {
      offenders.push(full);
    }
  }
}
