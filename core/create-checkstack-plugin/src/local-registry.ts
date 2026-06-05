import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** The package.json fields this harness reads. Unknown keys are ignored. */
const packageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  private: z.boolean().optional(),
});

/** Read + zod-parse a package.json, returning the fields we care about. */
function readPackageJson(pkgPath: string): z.infer<typeof packageJsonSchema> {
  return packageJsonSchema.parse(
    JSON.parse(fs.readFileSync(pkgPath, "utf8")) as unknown,
  );
}

/**
 * Local-registry publish harness for the external-plugin lifecycle
 * integration test (#251 Phase 3).
 *
 * The published-tarball path is what the integration test guards, so it
 * needs a real registry serving the *current* working tree's
 * `@checkstack/*` packages — not whatever is live on npm. We spin up a
 * throwaway [Verdaccio](https://verdaccio.org/) on `localhost`, publish
 * every non-private workspace package into it, and point the scaffolder +
 * `bun install` at it.
 *
 * Publish-protocol caveat (plan §7.2 step 1.3): `scripts/publish-packages.ts`
 * publishes to the REAL npm registry via `bun publish` and skips
 * already-published versions, so it is not directly reusable here. We use
 * the plan's preferred default (a): `bun publish --registry <localUrl>` per
 * package. `bun publish` (unlike `npm publish`) resolves `workspace:*` to
 * concrete versions at pack time — the same reason `publish-packages.ts`
 * uses it — so the published tarballs install cleanly outside the monorepo.
 *
 * Everything network/process-touching is injectable so the pure builders
 * (config, `.npmrc`, arg vectors) stay unit-testable without spawning
 * anything.
 */

/** Default host:port the throwaway Verdaccio listens on. */
export const DEFAULT_REGISTRY_PORT = 4873;
export const DEFAULT_REGISTRY_URL = `http://localhost:${DEFAULT_REGISTRY_PORT}`;

/**
 * Build a Verdaccio `config.yaml` that allows anonymous publish for the
 * scope(s) the test publishes, with auth disabled (a throwaway token still
 * satisfies the publish protocol — see {@link buildNpmrc}). Uglify/web UI
 * are off to keep the boot fast.
 */
export function buildVerdaccioConfig({
  storageDir,
  port = DEFAULT_REGISTRY_PORT,
}: {
  storageDir: string;
  port?: number;
}): string {
  // Anonymous publish is intentional: this registry is ephemeral, bound to
  // localhost, and never persists past the test. `$all` / `$anonymous`
  // groups let the publish step skip a real login flow.
  return [
    `storage: ${JSON.stringify(storageDir)}`,
    "uplinks:",
    "  npmjs:",
    "    url: https://registry.npmjs.org/",
    "packages:",
    "  '@checkstack/*':",
    "    access: $all",
    "    publish: $anonymous",
    "    unpublish: $anonymous",
    "  'create-checkstack-plugin':",
    "    access: $all",
    "    publish: $anonymous",
    "    unpublish: $anonymous",
    // Everything else proxies to the public registry so transitive
    // third-party deps (drizzle-orm, @orpc/*, vite, ...) still resolve.
    "  '**':",
    "    access: $all",
    "    publish: $anonymous",
    "    proxy: npmjs",
    // Bundled platform packages (e.g. @checkstack/frontend, @checkstack/ui)
    // ship large tarballs that blow past Verdaccio's 10mb default body cap and
    // get rejected with a 413. Raise the ceiling well above the largest pack.
    "max_body_size: 500mb",
    "log: { type: stdout, format: pretty, level: warn }",
    `listen: 0.0.0.0:${port}`,
    "",
  ].join("\n");
}

/**
 * Build a throwaway `.npmrc` that (a) pins the `@checkstack` scope +
 * `create-checkstack-plugin` fetches to the local registry and (b) carries
 * a fake `_authToken` so the publish protocol is satisfied even though the
 * registry accepts anonymous writes.
 */
export function buildNpmrc({
  registryUrl = DEFAULT_REGISTRY_URL,
}: {
  registryUrl?: string;
} = {}): string {
  const hostPath = registryUrl.replace(/^https?:/, "");
  return [
    `registry=${registryUrl}`,
    `@checkstack:registry=${registryUrl}`,
    `${hostPath}/:_authToken=fake-checkstack-it-token`,
    "always-auth=false",
    "",
  ].join("\n");
}

/** Build the `bun publish` argv for one package dir against the local registry. */
export function buildBunPublishArgs({
  registryUrl = DEFAULT_REGISTRY_URL,
}: {
  registryUrl?: string;
} = {}): string[] {
  // `--access public` mirrors publish-packages.ts; `--no-git-checks` is not
  // a bun flag, so we simply publish from the package dir. bun resolves
  // workspace:* to concrete versions automatically.
  return ["publish", "--registry", registryUrl, "--access", "public"];
}

/** Build the `npm view <pkg> version` argv against the local registry. */
export function buildNpmViewVersionArgs({
  packageName,
  registryUrl = DEFAULT_REGISTRY_URL,
}: {
  packageName: string;
  registryUrl?: string;
}): string[] {
  return ["view", `${packageName}`, "version", "--registry", registryUrl];
}

/** A workspace package the harness publishes. */
export interface WorkspacePackage {
  name: string;
  version: string;
  dir: string;
  private: boolean;
}

/**
 * Discover every publishable workspace package (`core/*`, `plugins/*`),
 * skipping `private: true` and `_`-prefixed scaffold/test dirs. We publish
 * the FULL set rather than a hand-maintained ~11 because the scaffolded
 * plugin depends on `@checkstack/backend`, whose transitive closure spans
 * most of the platform — a partial list would break `bun install`.
 */
export function discoverWorkspacePackages({
  monorepoRoot,
}: {
  monorepoRoot: string;
}): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const wsDir of ["core", "plugins"]) {
    const wsPath = path.join(monorepoRoot, wsDir);
    if (!fs.existsSync(wsPath)) continue;
    for (const entry of fs.readdirSync(wsPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const pkgPath = path.join(wsPath, entry.name, "package.json");
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = readPackageJson(pkgPath);
      if (!pkg.name || !pkg.version) continue;
      packages.push({
        name: pkg.name,
        version: pkg.version,
        dir: path.join(wsPath, entry.name),
        private: pkg.private === true,
      });
    }
  }
  return packages;
}

/** Result of one package publish attempt. */
export interface PublishOutcome {
  name: string;
  version: string;
  status: number;
  stderr: string;
}

/** Injectable subprocess runner so the publish loop is testable. */
export type CommandRunner = (args: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => { status: number; stderr: string };

const defaultRunner: CommandRunner = ({ command, args, cwd, env }) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stderr: `${result.stderr ?? ""}${result.error ? result.error.message : ""}`,
  };
};

/**
 * Publish every non-private discovered package to the local registry via
 * `bun publish --registry <url>`. Returns one outcome per attempted
 * package; the caller asserts each `status === 0`.
 */
export function publishWorkspacePackages({
  packages,
  registryUrl = DEFAULT_REGISTRY_URL,
  npmrcPath,
  run = defaultRunner,
  env = process.env,
}: {
  packages: WorkspacePackage[];
  registryUrl?: string;
  npmrcPath: string;
  run?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): PublishOutcome[] {
  const publishArgs = buildBunPublishArgs({ registryUrl });
  // Route bun/npm auth + registry through the throwaway .npmrc.
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    NPM_CONFIG_USERCONFIG: npmrcPath,
    BUN_CONFIG_REGISTRY: registryUrl,
  };
  const outcomes: PublishOutcome[] = [];
  for (const pkg of packages) {
    if (pkg.private) continue;
    const { status, stderr } = run({
      command: "bun",
      args: publishArgs,
      cwd: pkg.dir,
      env: childEnv,
    });
    outcomes.push({ name: pkg.name, version: pkg.version, status, stderr });
  }
  return outcomes;
}

/** A live Verdaccio process handle plus its base URL. */
export interface RegistryHandle {
  url: string;
  child: ChildProcess;
  stop: () => Promise<void>;
}

/**
 * Spawn Verdaccio via `npx verdaccio --config <file>` and wait until the
 * registry answers HTTP. Used by the integration test only.
 */
export async function startVerdaccio({
  configPath,
  url = DEFAULT_REGISTRY_URL,
  readyTimeoutMs = 60_000,
}: {
  configPath: string;
  url?: string;
  readyTimeoutMs?: number;
}): Promise<RegistryHandle> {
  const child = spawn("npx", ["--yes", "verdaccio", "--config", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        child.on("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  };

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/-/ping`);
      if (res.ok || res.status === 404) {
        // 404 still means the HTTP server is up and routing.
        return { url, child, stop };
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`Verdaccio did not become ready at ${url} in time`);
}

/**
 * Locate the monorepo root by walking up from a starting dir until a
 * `package.json` whose name is `checkstack-monorepo` (the root workspace)
 * is found.
 */
export function findMonorepoRoot({ from }: { from: string }): string {
  let dir = from;
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = readPackageJson(pkgPath);
      if (pkg.name === "checkstack-monorepo") return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find checkstack-monorepo root above ${from}`);
}
