/**
 * Pure helpers used by `dev-server.ts`. Extracted into their own module
 * so they're trivially unit-testable without spawning real processes,
 * watching real filesystems, or hitting Postgres.
 *
 * Anything in this file is deterministic given its inputs. Side-effecting
 * code (process spawn, fs.watch, vite startup) lives in dev-server.ts
 * proper.
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  installPackageMetadataSchema,
  type InstallPackageMetadata,
} from "@checkstack/common";

// ─────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────

export interface DevArgs {
  cwd: string;
  port: number;
  frontendPort: number;
  databaseUrl: string;
  watch: boolean;
  showHelp: boolean;
}

/**
 * Parse the dev command's CLI arguments. Pure: any env-var fallbacks are
 * passed in via `env` so tests can drive them without touching
 * `process.env`.
 */
export function parseDevArgs({
  raw,
  env = process.env,
  cwd = process.cwd(),
}: {
  raw: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
}): DevArgs {
  const args: DevArgs = {
    cwd,
    port: env.PORT ? Number(env.PORT) : 3000,
    frontendPort: env.FRONTEND_PORT ? Number(env.FRONTEND_PORT) : 5173,
    databaseUrl:
      env.DATABASE_URL ??
      "postgresql://checkstack:checkstack@localhost:5432/checkstack",
    watch: true,
    showHelp: false,
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    switch (a) {
      case "--cwd": {
        args.cwd = path.resolve(raw[++i]);
        break;
      }
      case "--port": {
        args.port = Number(raw[++i]);
        break;
      }
      case "--frontend-port": {
        args.frontendPort = Number(raw[++i]);
        break;
      }
      case "--db-url": {
        args.databaseUrl = raw[++i];
        break;
      }
      case "--no-watch": {
        args.watch = false;
        break;
      }
      case "--help":
      case "-h": {
        args.showHelp = true;
        break;
      }
    }
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────
// Plugin metadata validation
// ─────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; metadata: InstallPackageMetadata }
  | { ok: false; missingPackageJson: true }
  | { ok: false; issues: string[] };

/**
 * Validate the plugin author's `package.json` against the install-time
 * schema. The dev server runs the same boot code path as production, so
 * it must accept the same metadata that `plugin-pack` produces.
 *
 * The `readFile` injection makes this trivially unit-testable.
 */
export function validatePluginPackageJson({
  cwd,
  readFile = (p) => fs.readFileSync(p, "utf8"),
  exists = (p) => fs.existsSync(p),
}: {
  cwd: string;
  readFile?: (p: string) => string;
  exists?: (p: string) => boolean;
}): ValidationResult {
  const pkgJsonPath = path.join(cwd, "package.json");
  if (!exists(pkgJsonPath)) {
    return { ok: false, missingPackageJson: true };
  }
  const raw = JSON.parse(readFile(pkgJsonPath)) as unknown;
  const result = installPackageMetadataSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    return { ok: false, issues };
  }
  return { ok: true, metadata: result.data };
}

// ─────────────────────────────────────────────────────────────────────
// Backend entry resolution
// ─────────────────────────────────────────────────────────────────────

/**
 * Locate `@checkstack/backend`'s main entry from the plugin author's
 * node_modules so `bun run <entry>` works whether they pulled in
 * `@checkstack/scripts` (which transitively brings backend in) or
 * `@checkstack/backend` directly.
 *
 * Returns `undefined` when the package can't be resolved at all
 * (probably means `bun install` hasn't run yet).
 */
export function resolveBackendEntry({
  fromCwd,
  resolveFrom,
  readFile = (p) => fs.readFileSync(p, "utf8"),
}: {
  fromCwd: string;
  /** Optional injection point for tests. Defaults to Node's `createRequire`. */
  resolveFrom?: (from: string, request: string) => string | undefined;
  readFile?: (p: string) => string;
}): string | undefined {
  const resolver =
    resolveFrom ??
    ((from: string, request: string): string | undefined => {
      try {
        return createRequire(from).resolve(request);
      } catch {
        return undefined;
      }
    });
  const pkgJsonPath = resolver(
    path.join(fromCwd, "package.json"),
    "@checkstack/backend/package.json",
  );
  if (!pkgJsonPath) return undefined;
  let pkg: { main?: string };
  try {
    pkg = JSON.parse(readFile(pkgJsonPath)) as { main?: string };
  } catch {
    return undefined;
  }
  const main = pkg.main ?? "src/index.ts";
  return path.join(path.dirname(pkgJsonPath), main);
}

// ─────────────────────────────────────────────────────────────────────
// Frontend Vite spawn decision
// ─────────────────────────────────────────────────────────────────────

/**
 * Determine whether the dev command should also spawn a Vite frontend
 * dev server. True when the plugin under dev is itself a `-frontend`,
 * or when it's a bundle primary (e.g. `-backend`) that ships a
 * `-frontend` sibling in `checkstack.bundle`.
 */
export function shouldSpawnFrontend(
  metadata: Pick<InstallPackageMetadata, "checkstack">,
): boolean {
  if (metadata.checkstack.type === "frontend") return true;
  for (const sibling of metadata.checkstack.bundle ?? []) {
    if (sibling.endsWith("-frontend")) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Child-process env construction
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the env block for the backend child process. Wraps the dev-mode
 * env vars + sensible defaults for required production env (DB URL,
 * AUTH_SECRET, …). Inputs are explicit so the test can verify the env
 * var shape without spawning anything.
 */
export function buildBackendChildEnv({
  args,
  parentEnv,
  extraPluginPaths,
}: {
  args: DevArgs;
  parentEnv: Record<string, string | undefined>;
  extraPluginPaths: string[];
}): Record<string, string | undefined> {
  return {
    ...parentEnv,
    CHECKSTACK_DEV_PLUGIN_PATH: args.cwd,
    CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS: JSON.stringify(extraPluginPaths),
    CHECKSTACK_DEV_AUTH: "true",
    PORT: String(args.port),
    DATABASE_URL: args.databaseUrl,
    BASE_URL: parentEnv.BASE_URL ?? `http://localhost:${args.port}`,
    AUTH_SECRET: parentEnv.AUTH_SECRET ?? "checkstack-dev-secret",
    NODE_ENV: parentEnv.NODE_ENV ?? "development",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Watcher debouncer
// ─────────────────────────────────────────────────────────────────────

/**
 * Tiny event coalescer — multiple file events within the debounce window
 * trigger a single `onTrigger` call. Editors fire several events per
 * save (write a temp file, rename, touch metadata); we want one restart.
 *
 * Returns a function that consumers call once per filesystem event;
 * it filters dotfiles and tilde-suffixed editor swap files so they don't
 * cause spurious restarts.
 *
 * The `setTimer`/`clearTimer` pair is injectable so tests can drive the
 * timer synchronously without sleeping.
 */
export interface DebouncedWatcher {
  feed(filename: string | undefined): void;
}

export function createDebouncedWatcher({
  onTrigger,
  delayMs = 150,
  setTimer = (fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle,
  clearTimer = (h: TimerHandle) => clearTimeout(h as unknown as Parameters<typeof clearTimeout>[0]),
}: {
  onTrigger: () => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
}): DebouncedWatcher {
  let pending: TimerHandle | undefined;
  return {
    feed(filename) {
      if (!filename) return;
      // Skip editor temp/swap files and dotfiles. These fire on every
      // save in Vim, VS Code, and IntelliJ and would otherwise restart
      // the backend twice per actual edit.
      if (filename.endsWith("~") || filename.startsWith(".")) return;
      if (pending !== undefined) clearTimer(pending);
      pending = setTimer(() => {
        pending = undefined;
        onTrigger();
      }, delayMs);
    },
  };
}

// Opaque timer handle — `setTimeout`/`clearTimeout` differ in shape
// between Node, Bun, and the browser. We don't care about the runtime
// type, only that it round-trips through `setTimer`/`clearTimer`.
export type TimerHandle = unknown;
