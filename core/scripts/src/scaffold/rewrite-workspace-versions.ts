/**
 * Shared `workspace:*` -> concrete-version rewriting.
 *
 * Two consumers use this:
 *   - `plugin-pack`, which rewrites a package's `workspace:*` deps to the
 *     sibling's actual version before packing a tarball (so the published
 *     artifact installs outside the monorepo).
 *   - the scaffolding engine, which rewrites a freshly rendered template's
 *     `workspace:*` deps to concrete published versions when generating a
 *     standalone (non-monorepo) plugin repo.
 *
 * Both share the same range-detection shape (`startsWith("workspace:")`),
 * so it lives here once. The *source* of the concrete version differs by
 * caller, so it is injected via a {@link VersionResolver}.
 */

/** The dependency sections we rewrite, in a stable order. */
export const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

/**
 * Resolves the concrete semver range to substitute for a `workspace:*`
 * dependency. Implementations decide where the version comes from (a
 * workspace sibling's `package.json`, an npm `latest` dist-tag, a test
 * stub, ...). Returning `undefined` means "cannot resolve" and the caller
 * decides whether that is fatal.
 *
 * The resolver is **async**: the standalone scaffolder's default resolver
 * queries the registry (`npm view <pkg> version`) per dependency, and
 * `@checkstack/*` versions are not lockstepped (0.x, resolved
 * independently), so each lookup is its own network call that the engine
 * fans out concurrently. The monorepo resolver is synchronous in spirit
 * (it reads a sibling's `package.json` on disk) but returns a `Promise`
 * to satisfy this single shared seam.
 *
 * @param packageName the dependency name, e.g. `@checkstack/common`.
 * @param workspaceRange the original range, e.g. `workspace:*`.
 */
export type VersionResolver = (args: {
  packageName: string;
  workspaceRange: string;
}) => Promise<string | undefined>;

/** A `package.json` shape exposing the dependency sections we rewrite. */
export type RewritablePackageJson = {
  name?: string;
} & Partial<Record<DependencySection, Record<string, string>>>;

export interface RewriteResult {
  /** Whether any range was changed. */
  rewritten: boolean;
  /** Dependency names whose range began with `workspace:` but resolved to nothing. */
  unresolved: string[];
}

/**
 * Rewrite every `workspace:`-prefixed range in the given package's
 * dependency sections, mutating the package object in place.
 *
 * The resolver is invoked once per `workspace:` dep, and all invocations
 * are fanned out concurrently (the standalone resolver hits the registry
 * per package, so serializing them would be needlessly slow). When a
 * resolver returns `undefined`, the range is left untouched and the name
 * is recorded in {@link RewriteResult.unresolved} so the caller can fail
 * loudly.
 */
export async function rewriteWorkspaceVersions({
  pkg,
  resolveVersion,
}: {
  pkg: RewritablePackageJson;
  resolveVersion: VersionResolver;
}): Promise<RewriteResult> {
  const targets: { section: DependencySection; packageName: string }[] = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const block = pkg[section];
    if (!block) continue;
    for (const [packageName, range] of Object.entries(block)) {
      if (!range.startsWith("workspace:")) continue;
      targets.push({ section, packageName });
    }
  }

  const resolutions = await Promise.all(
    targets.map(async ({ section, packageName }) => {
      const workspaceRange = pkg[section]?.[packageName] ?? "";
      const resolved = await resolveVersion({ packageName, workspaceRange });
      return { section, packageName, resolved };
    }),
  );

  let rewritten = false;
  const unresolved: string[] = [];
  for (const { section, packageName, resolved } of resolutions) {
    if (resolved === undefined) {
      unresolved.push(packageName);
      continue;
    }
    const block = pkg[section];
    if (!block) continue;
    block[packageName] = resolved;
    rewritten = true;
  }

  return { rewritten, unresolved };
}
