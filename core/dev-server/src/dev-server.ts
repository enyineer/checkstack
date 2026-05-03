#!/usr/bin/env bun
/**
 * `bunx @checkstack/scripts dev` — local Checkstack dev server for plugin
 * authors.
 *
 * Spawns the platform's production backend entry (`@checkstack/backend`)
 * as a child process, with three env vars wiring it into "dev mode":
 *
 *   - CHECKSTACK_DEV_PLUGIN_PATH=<cwd>: tells the backend to skip
 *     filesystem discovery and load the plugin in this directory as a
 *     manual plugin.
 *   - CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS=<JSON array>: paths to
 *     `@checkstack/*-backend` packages co-loaded as additional manual
 *     plugins (resolved by walking the plugin's package.json#deps).
 *   - CHECKSTACK_DEV_AUTH=true: bypasses login. Every access rule the
 *     platform registers is auto-granted to a synthetic dev user.
 *
 * On every save under the plugin's `src/` (any file), we kill the child
 * and respawn. Bun cold-starts in <1s for a single plugin, so the loop
 * is fast enough for everyday work.
 *
 * The child process is the *real* `core/backend/src/index.ts` — same
 * boot code as production. No alternative dev-only stack to drift from.
 *
 * Pure logic lives in `dev-internals.ts`, lifecycle in `dev-lifecycle.ts`,
 * and Vite spawn in `dev-frontend.ts`. This file only wires real adapters
 * to those building blocks.
 */
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { extractErrorMessage } from "@checkstack/common";
import { resolveCorePluginDeps } from "./dev-deps-resolver";
import { startFrontendDevServer } from "./dev-frontend";
import {
  parseDevArgs,
  validatePluginPackageJson,
  resolveBackendEntry,
  shouldSpawnFrontend,
  buildBackendChildEnv,
  createDebouncedWatcher,
} from "./dev-internals";
import { createBackendLifecycle, nodeSpawner } from "./dev-lifecycle";

export async function runDevServer(rawArgs: string[]): Promise<number> {
  const args = parseDevArgs({ raw: rawArgs });
  if (args.showHelp) {
    printHelp();
    return 0;
  }

  // 1. Validate package.json
  const validation = validatePluginPackageJson({ cwd: args.cwd });
  if (!validation.ok) {
    if ("missingPackageJson" in validation) {
      console.error(
        `❌ No package.json found at ${args.cwd}. Run from a plugin's repo root.`,
      );
    } else {
      console.error(
        "❌ Plugin package.json failed install-time validation. The dev server boots the same code path as production, so the metadata must match what `plugin-pack` would accept:",
      );
      for (const issue of validation.issues) {
        console.error(`   - ${issue}`);
      }
    }
    return 1;
  }
  const pkg = validation.metadata;
  console.log(
    `🛠 Booting Checkstack dev server for ${pkg.name}@${pkg.version} (${pkg.checkstack.type})`,
  );

  // 2. Resolve @checkstack/backend entry
  const backendEntry = resolveBackendEntry({ fromCwd: args.cwd });
  if (!backendEntry) {
    console.error(
      "❌ Could not locate @checkstack/backend. Add it to your plugin's devDependencies, or install @checkstack/scripts which depends on it transitively.",
    );
    return 1;
  }

  // 3. Walk @checkstack/*-backend deps so we co-load the platform
  // plugins the user's plugin needs at runtime.
  const corePluginDeps = resolveCorePluginDeps({ pluginDir: args.cwd });
  if (corePluginDeps.length > 0) {
    console.log(
      `📦 Co-loading ${corePluginDeps.length} core plugin dep${
        corePluginDeps.length === 1 ? "" : "s"
      }: ${corePluginDeps.map((d) => d.name).join(", ")}`,
    );
  }

  // 4. Build the child env
  const childEnv = buildBackendChildEnv({
    args,
    parentEnv: process.env,
    extraPluginPaths: corePluginDeps.map((d) => d.modulePath),
  });

  // 5. Wire the backend lifecycle (spawn → restart → shutdown)
  let exitCode: number | null = 0;
  let shutdownResolve!: (code: number) => void;
  const shutdownPromise = new Promise<number>((resolve) => {
    shutdownResolve = resolve;
  });
  const lifecycle = createBackendLifecycle({
    spawnArgs: {
      command: "bun",
      args: ["run", backendEntry],
      env: childEnv,
    },
    spawner: nodeSpawner({ spawnFn: spawn }),
    hooks: {
      onNaturalExit: (code) => {
        exitCode = code;
        shutdownResolve(code ?? 0);
      },
    },
  });

  // 6. Watcher (debounced) → restart
  const srcDir = path.join(args.cwd, "src");
  if (args.watch && fs.existsSync(srcDir)) {
    const watcher = createDebouncedWatcher({ onTrigger: lifecycle.restart });
    fs.watch(srcDir, { recursive: true }, (_event, filename) => {
      watcher.feed(filename ?? undefined);
    });
    console.log(`👀 Watching ${srcDir} for changes`);
  }

  // 7. Frontend dev server (Vite) when applicable
  let viteServer:
    | Awaited<ReturnType<typeof startFrontendDevServer>>
    | undefined;
  if (shouldSpawnFrontend(pkg)) {
    try {
      viteServer = await startFrontendDevServer({
        pluginCwd: args.cwd,
        port: args.frontendPort,
        backendUrl: `http://localhost:${args.port}`,
      });
    } catch (error) {
      console.error(
        `⚠ Frontend dev server failed to start: ${extractErrorMessage(error)}`,
      );
      console.error(
        "  The backend will still run — your -frontend plugin just won't have HMR.",
      );
    }
  }

  // 8. Signal forwarding
  const onSignal = (signal: NodeJS.Signals) => {
    lifecycle.shutdown(signal);
    void viteServer?.close();
    setTimeout(() => process.exit(exitCode ?? 0), 200).unref();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  // 9. Boot
  lifecycle.start();
  return shutdownPromise;
}

function printHelp(): void {
  console.log(String.raw`Usage: checkstack-scripts dev [options]

Spins up a local Checkstack dev server with the current directory's
plugin loaded. Same boot code as production — the only differences are:
  * filesystem discovery is skipped (only your plugin loads)
  * a synthetic dev auth grants every access rule (no login)
  * the backend restarts on changes under ./src

Options:
  --cwd <dir>             Plugin directory (default: process.cwd())
  --port <num>            Backend HTTP port (default: 3000 or $PORT)
  --frontend-port <num>   Frontend Vite dev port (default: 5173 or $FRONTEND_PORT)
  --db-url <url>          Postgres URL (default: $DATABASE_URL or
                          postgresql://checkstack:checkstack@localhost:5432/checkstack)
  --no-watch              Disable file watching / auto-restart
  --help, -h              Show this message

Prerequisites: a running Postgres reachable at --db-url. The simplest
local setup is:

  docker run --name checkstack-dev-pg -d -p 5432:5432 \
    -e POSTGRES_USER=checkstack -e POSTGRES_PASSWORD=checkstack \
    -e POSTGRES_DB=checkstack postgres:16-alpine
`);
}

if (import.meta.main) {
  const code = await runDevServer(process.argv.slice(2));
  process.exit(code);
}
