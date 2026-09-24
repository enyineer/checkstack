import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Repo-wide access-rule consistency guard.
 *
 * Access rules only reach the role editor, the default-role grants and the
 * boot-time orphan sweep if they are REGISTERED (backend plugin
 * `registerAccessRules` / host `registerCoreAccessRules`). A rules array
 * that is defined and exported but never registered fails silently: the
 * rule shows up for nobody, is not grantable, and hand-inserted DB rows are
 * deleted on the next boot. This exact gap shipped for `api-docs.read`.
 *
 * These tests fail when:
 * 1. an exported `*AccessRules` array has no registering consumer, or
 * 2. two rules in one access.ts share the same local id
 *    (`resource.level`), which collapses them into one grantable rule.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

/** Directories scanned for access.ts definitions and registering consumers. */
const SCOPE_DIRS = ["core", "plugins"];
/** Plugin scaffolds are templates, not registered code. */
const EXCLUDED_DIR_NAMES = new Set([
  "_test-scaffolds",
  "node_modules",
  "generated",
  "drizzle",
  ".tsbuild",
]);

function walkSrcFiles(rootDir: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (EXCLUDED_DIR_NAMES.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      // Tests and type declarations never register rules.
      if (/\.(test|it\.test|d)\.tsx?$/.test(entry)) continue;
      out.push(full);
    }
  };
  visit(rootDir);
  return out;
}

function repoScopeDirs(): string[] {
  return SCOPE_DIRS.map((d) => path.join(REPO_ROOT, d)).filter((d) =>
    existsSync(d),
  );
}

/** All package-level access.ts definition files (each at PKG/src/access.ts). */
function findAccessDefinitionFiles(): string[] {
  return repoScopeDirs().flatMap((scopeDir) =>
    readdirSync(scopeDir)
      .map((pkg) => path.join(scopeDir, pkg, "src", "access.ts"))
      .filter((f) => existsSync(f)),
  );
}

/** Package root (e.g. `<repo>/core/api-docs-common`) of a src file. */
function packageRootOf(file: string): string {
  return path.dirname(path.dirname(file));
}

const ACCESS_RULES_ARRAY_RE = /export const (\w*AccessRules)\b/g;
const ACCESS_CALL_ARGS_RE = /access\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;

const allSrcFiles = repoScopeDirs().flatMap((d) => walkSrcFiles(d));
const accessDefFiles = findAccessDefinitionFiles();
const contentsByFile = new Map<string, string>(
  allSrcFiles.map((f) => [f, readFileSync(f, "utf8")]),
);

describe("access rule definitions", () => {
  it("discovers the repo's access.ts files (layout guard)", () => {
    expect(accessDefFiles.length).toBeGreaterThanOrEqual(25);
  });

  it("every exported *AccessRules array has a registering consumer", () => {
    const unconsumed: string[] = [];
    for (const defFile of accessDefFiles) {
      const content = contentsByFile.get(defFile) ?? "";
      const arrayNames = [...content.matchAll(ACCESS_RULES_ARRAY_RE)].map(
        (m) => m[1],
      );
      const pkgRoot = packageRootOf(defFile);
      for (const name of arrayNames) {
        const hasConsumer = allSrcFiles.some((file) => {
          if (file === defFile) return false;
          const fileContent = contentsByFile.get(file) ?? "";
          if (!fileContent.includes(name)) return false;
          const outsideDefiningPackage = !file.startsWith(pkgRoot + path.sep);
          const isRegistrationSite =
            fileContent.includes("registerAccessRules(") ||
            fileContent.includes("registerCoreAccessRules(");
          return outsideDefiningPackage || isRegistrationSite;
        });
        if (!hasConsumer) unconsumed.push(`${path.relative(REPO_ROOT, defFile)}: ${name}`);
      }
    }
    expect(unconsumed).toEqual([]);
  });

  it("no two rules in one access.ts share a local id (resource.level)", () => {
    const duplicates: string[] = [];
    for (const defFile of accessDefFiles) {
      const content = contentsByFile.get(defFile) ?? "";
      const seen = new Map<string, number>();
      for (const match of content.matchAll(ACCESS_CALL_ARGS_RE)) {
        const localId = `${match[1]}.${match[2]}`;
        seen.set(localId, (seen.get(localId) ?? 0) + 1);
      }
      for (const [localId, count] of seen) {
        if (count > 1) {
          duplicates.push(`${path.relative(REPO_ROOT, defFile)}: ${localId} x${count}`);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });
});
