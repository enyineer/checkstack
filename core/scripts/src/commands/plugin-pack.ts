#!/usr/bin/env bun
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { create as tarCreate } from "tar";
import {
  installPackageMetadataSchema,
  pluginBundleManifestSchema,
  type InstallPackageMetadata,
  type PluginBundleManifest,
} from "@checkstack/common";

/**
 * `plugin-pack` CLI.
 *
 * Two modes:
 *   - default (per-package): packs the cwd into a single `.tgz` matching what
 *     `bun pm pack` would produce, with extra metadata validation. This is
 *     what gets uploaded to npm.
 *   - `--bundle`: packs the cwd's primary package + every sibling listed in
 *     `package.json#checkstack.bundle`, then wraps them into an outer tarball
 *     containing `bundle.json` + `packages/<name>-<version>.tgz`. This is the
 *     artifact attached to a GitHub release / uploaded directly via the
 *     plugin manager UI.
 *
 * Workspace-resolution: `workspace:*` deps in any sibling's `package.json` are
 * rewritten to the matching package's actual version before packing. Resolution
 * walks the nearest ancestor `package.json` containing a `workspaces` field;
 * if none is found we treat the cwd as standalone (no rewriting needed).
 */

interface Args {
  bundle: boolean;
  outDir: string;
  cwd: string;
  validateOnly: boolean;
}

export async function runPluginPack(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);

  const pkg = readJson<InstallPackageMetadata>(
    path.join(args.cwd, "package.json"),
  );

  // Validate metadata ABOVE pack so the user sees errors immediately.
  const validation = installPackageMetadataSchema.safeParse(pkg);
  if (!validation.success) {
    console.error("❌ package.json failed validation:");
    for (const issue of validation.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    return 1;
  }

  if (args.validateOnly) {
    console.log("✅ Metadata valid.");
    return 0;
  }

  // Pre-pack hooks
  if (!args.bundle) {
    runScriptIfPresent({ cwd: args.cwd, script: "typecheck" });
    runScriptIfPresent({ cwd: args.cwd, script: "lint" });
  }

  fs.mkdirSync(args.outDir, { recursive: true });

  if (args.bundle) {
    const bundleNames = pkg.checkstack.bundle ?? [];
    if (bundleNames.length === 0) {
      console.error(
        "❌ --bundle requires `checkstack.bundle` to be set in package.json.",
      );
      return 1;
    }

    const workspaceMap = buildWorkspaceMap(args.cwd);

    const primaryTarball = await packPackage({
      pkgDir: args.cwd,
      outDir: args.outDir,
      workspaceMap,
    });

    const siblings: { name: string; version: string; tarball: string }[] = [
      {
        name: pkg.name,
        version: pkg.version,
        tarball: `packages/${path.basename(primaryTarball)}`,
      },
    ];

    for (const sibName of bundleNames) {
      if (sibName === pkg.name) continue;
      const sibDir = workspaceMap.get(sibName);
      if (!sibDir) {
        console.error(
          `❌ Bundle sibling '${sibName}' not found in workspace. ` +
            `Make sure it's a peer of the primary package.`,
        );
        return 1;
      }
      const sibTarball = await packPackage({
        pkgDir: sibDir,
        outDir: args.outDir,
        workspaceMap,
      });
      const sibPkg = readJson<InstallPackageMetadata>(
        path.join(sibDir, "package.json"),
      );
      siblings.push({
        name: sibPkg.name,
        version: sibPkg.version,
        tarball: `packages/${path.basename(sibTarball)}`,
      });
    }

    const manifest: PluginBundleManifest = pluginBundleManifestSchema.parse({
      bundleVersion: 1,
      primary: pkg.name,
      packages: siblings,
    });

    const outerTarball = path.join(
      args.outDir,
      `${safeFileName(pkg.name)}-${pkg.version}-bundle.tgz`,
    );

    // Lay out files in a tmpdir then `tar.create`.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "checkstack-bundle-"));
    try {
      fs.mkdirSync(path.join(stage, "packages"), { recursive: true });
      for (const sib of siblings) {
        fs.copyFileSync(
          path.join(args.outDir, path.basename(sib.tarball)),
          path.join(stage, sib.tarball),
        );
      }
      fs.writeFileSync(
        path.join(stage, "bundle.json"),
        JSON.stringify(manifest, undefined, 2),
      );
      await tarCreate(
        {
          gzip: true,
          file: outerTarball,
          cwd: stage,
        },
        ["bundle.json", "packages"],
      );
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }

    console.log(`✅ Bundle tarball: ${outerTarball}`);
    return 0;
  }

  // Default mode — single per-package tarball
  const workspaceMap = buildWorkspaceMap(args.cwd);
  const tarball = await packPackage({
    pkgDir: args.cwd,
    outDir: args.outDir,
    workspaceMap,
  });
  console.log(`✅ Tarball: ${tarball}`);
  return 0;
}

function parseArgs(raw: string[]): Args {
  const args: Args = {
    bundle: false,
    outDir: path.resolve("dist"),
    cwd: process.cwd(),
    validateOnly: false,
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    switch (a) {
    case "--bundle": {
    args.bundle = true;
    break;
    }
    case "--validate-only": {
    args.validateOnly = true;
    break;
    }
    case "--out-dir": {
    args.outDir = path.resolve(raw[++i]);
    break;
    }
    case "--cwd": {
    args.cwd = path.resolve(raw[++i]);
    break;
    }
    case "--help": 
    case "-h": {
      printHelp();
      process.exit(0);
    
    break;
    }
    // No default
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: checkstack-scripts plugin-pack [options]

Packs a Checkstack plugin into a .tgz, validating package.json metadata
along the way. Run from the directory containing the plugin's package.json.

Options:
  --bundle           Pack the primary plus every sibling declared in
                     package.json#checkstack.bundle into a single outer
                     tarball with a bundle.json manifest.
  --out-dir <dir>    Output directory (default: ./dist)
  --validate-only    Only validate metadata; do not pack.
  --cwd <dir>        Run as if invoked from <dir> (default: process.cwd())
  --help, -h         Show this message.
`);
}

function runScriptIfPresent({
  cwd,
  script,
}: {
  cwd: string;
  script: string;
}): void {
  const pkg = readJson<{ scripts?: Record<string, string> }>(
    path.join(cwd, "package.json"),
  );
  if (!pkg.scripts?.[script]) return;
  console.log(`▶ bun run ${script}`);
  const r = spawnSync("bun", ["run", script], { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`bun run ${script} exited with status ${r.status}`);
  }
}

/**
 * Walk up from `cwd` to find the workspace root (`package.json` with a
 * `workspaces` field), then scan every workspace package and build a
 * `name -> dir` map. Returns an empty map when no workspace ancestor
 * exists (standalone plugin repo).
 */
function buildWorkspaceMap(cwd: string): Map<string, string> {
  const result = new Map<string, string>();
  const root = findWorkspaceRoot(cwd);
  if (!root) return result;

  const rootPkg = readJson<{ workspaces?: string[] | { packages?: string[] } }>(
    path.join(root, "package.json"),
  );
  const patterns = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : (rootPkg.workspaces?.packages ?? []);

  for (const pattern of patterns) {
    // Bun/npm globs are typically `core/*` or `plugins/*`. We resolve the
    // direct child layer; deeper nesting is uncommon and not supported here.
    const baseDir = pattern.replace(/\/\*$/, "");
    const absBase = path.join(root, baseDir);
    if (!fs.existsSync(absBase)) continue;
    for (const entry of fs.readdirSync(absBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(absBase, entry.name);
      const pkgJsonPath = path.join(dir, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;
      const pkg = readJson<{ name?: string }>(pkgJsonPath);
      if (pkg.name) result.set(pkg.name, dir);
    }
  }

  return result;
}

function findWorkspaceRoot(start: string): string | undefined {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = readJson<{ workspaces?: unknown }>(pkgJsonPath);
      if (pkg.workspaces) return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Pack a single package into a tarball under `outDir`.
 *
 * Steps:
 *   1. Read package.json
 *   2. Replace `workspace:*` deps with concrete versions from `workspaceMap`
 *   3. Run `bun pm pack` (which produces a tarball using the rewritten
 *      package.json)
 *   4. Restore the original package.json on disk so the developer's source
 *      tree is unchanged
 */
async function packPackage({
  pkgDir,
  outDir,
  workspaceMap,
}: {
  pkgDir: string;
  outDir: string;
  workspaceMap: Map<string, string>;
}): Promise<string> {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const original = fs.readFileSync(pkgJsonPath, "utf8");
  const pkg = JSON.parse(original) as InstallPackageMetadata & {
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  let rewritten = false;
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ] as const) {
    const block = pkg[section];
    if (!block) continue;
    for (const [name, range] of Object.entries(block)) {
      if (range.startsWith("workspace:")) {
        const targetDir = workspaceMap.get(name);
        if (!targetDir) {
          throw new Error(
            `Cannot resolve workspace dep '${name}' (declared in '${pkg.name}'). ` +
              `Either move the package into the workspace or replace the workspace range with a concrete version.`,
          );
        }
        const targetPkg = readJson<{ version: string }>(
          path.join(targetDir, "package.json"),
        );
        block[name] = `^${targetPkg.version}`;
        rewritten = true;
      }
    }
  }

  try {
    if (rewritten) {
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, undefined, 2));
    }
    const r = spawnSync(
      "bun",
      ["pm", "pack", "--destination", outDir],
      { cwd: pkgDir, stdio: "inherit" },
    );
    if (r.status !== 0) {
      throw new Error(`bun pm pack exited with status ${r.status}`);
    }
  } finally {
    if (rewritten) fs.writeFileSync(pkgJsonPath, original);
  }

  // `bun pm pack` writes `<scope>-<name>-<version>.tgz` (scope-prefix collapsed).
  const expectedName = `${safeFileName(pkg.name)}-${pkg.version}.tgz`;
  const expected = path.join(outDir, expectedName);
  if (!fs.existsSync(expected)) {
    // Fall back: pick the most recently modified tgz in outDir.
    const all = fs
      .readdirSync(outDir)
      .filter((f) => f.endsWith(".tgz"))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(outDir, f)).mtime.getTime(),
      }))
      .toSorted((a, b) => b.mtime - a.mtime);
    if (all.length === 0) {
      throw new Error(`bun pm pack produced no tarball in ${outDir}`);
    }
    return path.join(outDir, all[0].name);
  }
  return expected;
}

function safeFileName(name: string): string {
  return name.replace(/^@/, "").replaceAll('/', "-");
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

if (import.meta.main) {
  const code = await runPluginPack(process.argv.slice(2));
  process.exit(code);
}
