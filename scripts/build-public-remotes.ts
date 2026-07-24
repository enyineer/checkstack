/**
 * Build every CORE frontend plugin that ships a public Module Federation remote
 * (`checkstack.publicRemote: true` in its package.json) into `dist/` with an
 * `mf-manifest.json` + `remoteEntry.js`, so the backend can serve it under
 * `/assets/plugins/<name>/` to the lean public status-page bundle.
 *
 * Single source of truth: the SAME `checkstack.publicRemote` marker the backend
 * discovery (`core/backend/src/utils/plugin-discovery.ts`) uses to sync the
 * plugin's `plugins` row - so the build set and the served set cannot drift.
 *
 * Wired into `Dockerfile` (builder stage) and the e2e `pretest:e2e`, both of
 * which otherwise build only the host frontend. NODE_ENV=production is forced so
 * the MF Vite plugin emits the remote (it skips it under NODE_ENV=test).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dir, "..");

function findPublicRemotePackages(): string[] {
  const names: string[] = [];
  for (const scanDir of ["core", "plugins"]) {
    const base = path.join(repoRoot, scanDir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(base, entry.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
          checkstack?: { publicRemote?: boolean };
        };
        if (pkg.name && pkg.checkstack?.publicRemote === true) {
          names.push(pkg.name);
        }
      } catch {
        // ignore unreadable/non-JSON package.json
      }
    }
  }
  return names.toSorted();
}

const packages = findPublicRemotePackages();
if (packages.length === 0) {
  console.log("[build-public-remotes] no publicRemote plugins found; nothing to build.");
} else {
  console.log(`[build-public-remotes] building ${packages.length} public remote(s): ${packages.join(", ")}`);
  for (const name of packages) {
    console.log(`[build-public-remotes] -> ${name}`);
    const result = spawnSync("bun", ["run", "--filter", name, "build"], {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    });
    if (result.status !== 0) {
      throw new Error(`[build-public-remotes] build failed for ${name} (exit ${result.status})`);
    }
  }
  console.log("[build-public-remotes] done.");
}
