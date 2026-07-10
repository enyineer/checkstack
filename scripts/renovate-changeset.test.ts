import { describe, expect, it } from "bun:test";
import {
  diffPackages,
  owningWorkspaces,
  parseLock,
  renderChangeset,
  resolveOwners,
  reachableAncestors,
  splitId,
} from "./renovate-changeset";

/**
 * Mirrors the real shape: `fast-uri` is transitive (reached only via `ajv`),
 * `tar` is direct. `@x/e2e` reaches `ajv` through a DEV edge and `@x/private`
 * is unpublishable - both must be excluded from attribution. Trailing commas
 * exercise the JSONC strip.
 */
const BASE_LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "root", "devDependencies": { "typescript": "^5.0.0" } },
    "core/backend": { "name": "@x/backend", "dependencies": { "tar": "^7.0.0", "@x/common": "workspace:*" } },
    "core/ui": { "name": "@x/ui", "dependencies": { "ajv": "^8.0.0" } },
    "core/e2e": { "name": "@x/e2e", "devDependencies": { "ajv": "^8.0.0" } },
    "core/secret": { "name": "@x/secret", "dependencies": { "ajv": "^8.0.0" } },
  },
  "packages": {
    "tar": ["tar@7.5.16", "", {}, "sha-a"],
    "ajv": ["ajv@8.18.0", "", { "dependencies": { "fast-uri": "^3.0.1" } }, "sha-b"],
    "fast-uri": ["fast-uri@3.1.2", "", {}, "sha-c"],
    "typescript": ["typescript@5.7.2", "", {}, "sha-d"],
  },
}`;

const HEAD_LOCK = BASE_LOCK.replace("tar@7.5.16", "tar@7.5.19").replace(
  "fast-uri@3.1.2",
  "fast-uri@3.1.3",
);

const isPublic = (name: string): boolean => name !== "@x/secret";

describe("splitId", () => {
  it("splits an unscoped id", () => {
    expect(splitId({ id: "tar@7.5.16" })).toEqual({ name: "tar", version: "7.5.16" });
  });

  it("splits a scoped id on the LAST @", () => {
    expect(splitId({ id: "@scope/pkg@1.2.3" })).toEqual({
      name: "@scope/pkg",
      version: "1.2.3",
    });
  });
});

describe("parseLock", () => {
  it("tolerates the trailing commas bun.lock emits", () => {
    expect(() => parseLock({ raw: BASE_LOCK })).not.toThrow();
  });

  it("indexes packages by name and records their edges", () => {
    const lock = parseLock({ raw: BASE_LOCK });
    expect(lock.packages.get("ajv")).toEqual({ version: "8.18.0", deps: ["fast-uri"] });
    expect(lock.packages.get("tar")?.version).toBe("7.5.16");
  });

  it("skips the root workspace and drops workspace: links from dep lists", () => {
    const lock = parseLock({ raw: BASE_LOCK });
    expect(lock.workspaces.map((w) => w.name).sort()).toEqual([
      "@x/backend",
      "@x/e2e",
      "@x/secret",
      "@x/ui",
    ]);
    const backend = lock.workspaces.find((w) => w.name === "@x/backend");
    expect(backend?.prodDeps).toEqual(["tar"]); // "@x/common" is workspace:*
  });
});

describe("diffPackages", () => {
  it("reports only changed resolutions", () => {
    const base = parseLock({ raw: BASE_LOCK });
    const head = parseLock({ raw: HEAD_LOCK });
    expect(diffPackages({ base, head })).toEqual([
      { name: "fast-uri", from: "3.1.2", to: "3.1.3" },
      { name: "tar", from: "7.5.16", to: "7.5.19" },
    ]);
  });

  it("returns nothing when the lockfiles agree", () => {
    const lock = parseLock({ raw: BASE_LOCK });
    expect(diffPackages({ base: lock, head: lock })).toEqual([]);
  });
});

describe("reachableAncestors", () => {
  it("walks external-only edges up from the target", () => {
    const lock = parseLock({ raw: BASE_LOCK });
    expect([...reachableAncestors({ lock, target: "fast-uri" })].sort()).toEqual([
      "ajv",
      "fast-uri",
    ]);
  });

  it("includes the target even with no parents", () => {
    const lock = parseLock({ raw: BASE_LOCK });
    expect([...reachableAncestors({ lock, target: "tar" })]).toEqual(["tar"]);
  });
});

describe("owningWorkspaces", () => {
  it("charges a transitive dep to the nearest workspace ancestor", () => {
    const lock = parseLock({ raw: HEAD_LOCK });
    // @x/ui declares ajv (prod). NOT @x/backend, which never reaches fast-uri.
    expect(owningWorkspaces({ lock, target: "fast-uri", isPublic })).toEqual(["@x/ui"]);
  });

  it("charges a direct dep to its declarer", () => {
    const lock = parseLock({ raw: HEAD_LOCK });
    expect(owningWorkspaces({ lock, target: "tar", isPublic })).toEqual(["@x/backend"]);
  });

  it("excludes private packages - they cannot publish, so cannot trigger the image build", () => {
    const lock = parseLock({ raw: HEAD_LOCK });
    // @x/secret declares ajv (prod) but is private.
    expect(owningWorkspaces({ lock, target: "fast-uri", isPublic })).not.toContain("@x/secret");
    // With everything public it WOULD be an owner - proving the filter is what excludes it.
    expect(owningWorkspaces({ lock, target: "fast-uri", isPublic: () => true })).toContain(
      "@x/secret",
    );
  });

  it("excludes dev-only edges - the image is built with --production", () => {
    const lock = parseLock({ raw: HEAD_LOCK });
    // @x/e2e reaches ajv only through devDependencies.
    expect(owningWorkspaces({ lock, target: "fast-uri", isPublic })).not.toContain("@x/e2e");
  });
});

describe("resolveOwners", () => {
  it("unions owners across every changed package", () => {
    const base = parseLock({ raw: BASE_LOCK });
    const head = parseLock({ raw: HEAD_LOCK });
    const changes = diffPackages({ base, head });
    expect(resolveOwners({ head, changes, isPublic })).toEqual(["@x/backend", "@x/ui"]);
  });

  it("yields no owners when only a dev-only dependency moved", () => {
    const base = parseLock({ raw: BASE_LOCK });
    const head = parseLock({ raw: BASE_LOCK.replace("typescript@5.7.2", "typescript@5.7.3") });
    const changes = diffPackages({ base, head });
    expect(changes).toEqual([{ name: "typescript", from: "5.7.2", to: "5.7.3" }]);
    // typescript is only a ROOT devDependency -> nothing shippable changed.
    expect(resolveOwners({ head, changes, isPublic })).toEqual([]);
  });
});

describe("renderChangeset", () => {
  it("emits patch bumps and an itemised dependency list", () => {
    const md = renderChangeset({
      owners: ["@x/backend", "@x/ui"],
      changes: [{ name: "tar", from: "7.5.16", to: "7.5.19" }],
    });
    expect(md).toStartWith('---\n"@x/backend": patch\n"@x/ui": patch\n---');
    expect(md).toContain("- `tar` 7.5.16 -> 7.5.19");
  });
});
