import fs from "node:fs";
import path from "node:path";
import type { VersionResolver } from "./rewrite-workspace-versions";

/**
 * Version-resolution seam for {@link rewriteWorkspaceVersions}.
 *
 * The scaffolding engine and `plugin-pack` both need to turn a
 * `workspace:*` range into a concrete one, but they source the concrete
 * version differently:
 *
 *   - In a monorepo, the version is read from the sibling package's own
 *     `package.json` on disk (a `name -> dir` workspace map). This is the
 *     behaviour `plugin-pack` has always had.
 *   - In a standalone scaffold (Phase 2), the version is resolved from the
 *     registry's `latest` dist-tag via `npm view`. That resolver lives in
 *     `create-checkstack-plugin`; the engine only sees the injected
 *     {@link VersionResolver} interface, so it stays registry-agnostic.
 *
 * Keeping the resolver injected (rather than hardcoded) is also what lets
 * the integration test point it at a local Verdaccio registry without any
 * network access.
 */

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

/**
 * Build a {@link VersionResolver} backed by a workspace `name -> dir` map.
 * Each resolved range is a caret on the sibling's current version
 * (`^<version>`), matching how `plugin-pack` has always rewritten and what
 * the runtime compatibility checker's `semver.satisfies` expects.
 *
 * Returns `undefined` for names not present in the map; the caller decides
 * whether an unresolved dep is fatal (`plugin-pack` throws, mirroring its
 * previous behaviour).
 */
export function createWorkspaceMapResolver({
  workspaceMap,
}: {
  workspaceMap: Map<string, string>;
}): VersionResolver {
  // The map read is synchronous, but the shared VersionResolver seam is
  // async (the standalone npm-view resolver needs it), so this resolver is
  // declared `async` to satisfy the shared Promise-returning signature.
  return async ({ packageName }) => {
    const dir = workspaceMap.get(packageName);
    if (!dir) return;
    const sibling = readJson<{ version: string }>(
      path.join(dir, "package.json"),
    );
    return `^${sibling.version}`;
  };
}
