import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { APP_DOC_SLUGS, docsPath } from "./docs-links";

/**
 * Guards the docs<->app contract: every user-guide page the app deep-links to
 * (navbar + "Learn more" links) MUST exist in the docs. If a page is renamed or
 * moved, the in-app links would silently 404; this test fails instead.
 *
 * Source of truth is the actual docs content (`docs/src/content/docs`), resolved
 * relative to this file (core/common/src -> repo root).
 */
const DOCS_ROOT = resolve(import.meta.dir, "../../../docs/src/content/docs");

/** A slug resolves if `<slug>.md(x)` or `<slug>/index.md(x)` exists. */
function slugExists(slug: string): boolean {
  return [
    `${slug}.md`,
    `${slug}.mdx`,
    `${slug}/index.md`,
    `${slug}/index.mdx`,
  ].some((candidate) => existsSync(resolve(DOCS_ROOT, candidate)));
}

describe("app doc links resolve to real docs pages", () => {
  test("the docs content root is found (guards the relative path)", () => {
    // If this fails the path is wrong, which would otherwise mask real
    // missing-page failures below.
    expect(existsSync(DOCS_ROOT)).toBe(true);
  });

  for (const [key, slug] of Object.entries(APP_DOC_SLUGS)) {
    test(`${key} -> "${slug}" exists in the docs`, () => {
      expect(slugExists(slug)).toBe(true);
    });
  }

  test("docsPath builds a /checkstack-based trailing-slash URL", () => {
    expect(docsPath(APP_DOC_SLUGS.teamsAndAccess)).toBe(
      "/checkstack/user-guide/concepts/teams-and-access/",
    );
  });
});
