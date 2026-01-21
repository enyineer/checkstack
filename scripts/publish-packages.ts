/**
 * Custom publish script for Changesets + Bun
 *
 * This script replaces `changeset publish` to use `bun publish` instead of `npm publish`.
 * `bun publish` properly resolves `workspace:*` protocol references to actual version numbers,
 * which `npm publish` does not understand.
 *
 * Usage:
 *   bun run scripts/publish-packages.ts           # Publish packages
 *   bun run scripts/publish-packages.ts --dry-run # Show what would be published without publishing
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";
import semver from "semver";

export interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
}

export interface PublishResult {
  name: string;
  version: string;
  success: boolean;
  error?: string;
}

export interface PackageInfo {
  dir: string;
  pkg: PackageJson;
  npmVersion: string | undefined;
  status: "new" | "update" | "up-to-date" | "private" | "ahead-of-local";
}

export async function getPackageDirectories({
  rootDir,
}: {
  rootDir: string;
}): Promise<string[]> {
  const workspaceDirs = ["core", "plugins"];
  const packageDirs: string[] = [];

  for (const wsDir of workspaceDirs) {
    const wsPath = path.join(rootDir, wsDir);
    const entries = await readdir(wsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("_")) {
        packageDirs.push(path.join(wsPath, entry.name));
      }
    }
  }

  return packageDirs;
}

export async function getPackageJson({
  dir,
}: {
  dir: string;
}): Promise<PackageJson | undefined> {
  const pkgPath = path.join(dir, "package.json");
  const file = Bun.file(pkgPath);

  if (!(await file.exists())) {
    return undefined;
  }

  return file.json();
}

export async function getNpmVersion({
  packageName,
}: {
  packageName: string;
}): Promise<string | undefined> {
  try {
    const result = await $`npm view ${packageName} version`.quiet();
    return result.text().trim();
  } catch {
    // Package doesn't exist on npm yet
    return undefined;
  }
}

export function determinePackageStatus({
  pkg,
  npmVersion,
}: {
  pkg: PackageJson;
  npmVersion: string | undefined;
}): PackageInfo["status"] {
  if (pkg.private) {
    return "private";
  }
  if (npmVersion === undefined) {
    return "new";
  }
  if (npmVersion === pkg.version) {
    return "up-to-date";
  }
  // Use semver to properly compare versions
  if (semver.gt(pkg.version, npmVersion)) {
    return "update";
  }
  // npm has a newer version than local - don't publish
  return "ahead-of-local";
}

export async function publishPackage({
  dir,
  dryRun,
}: {
  dir: string;
  dryRun: boolean;
}): Promise<PublishResult> {
  const pkg = await getPackageJson({ dir });

  if (!pkg) {
    return {
      name: "unknown",
      version: "unknown",
      success: false,
      error: "No package.json found",
    };
  }

  if (dryRun) {
    return { name: pkg.name, version: pkg.version, success: true };
  }

  try {
    // Use bun publish which resolves workspace:* to actual versions
    await $`bun publish --access public`.cwd(dir);
    return { name: pkg.name, version: pkg.version, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: pkg.name,
      version: pkg.version,
      success: false,
      error: message,
    };
  }
}

export async function discoverPackages({
  rootDir,
}: {
  rootDir: string;
}): Promise<PackageInfo[]> {
  const packageDirs = await getPackageDirectories({ rootDir });
  const packages: PackageInfo[] = [];

  for (const dir of packageDirs) {
    const pkg = await getPackageJson({ dir });
    if (!pkg) continue;

    const npmVersion = pkg.private
      ? undefined
      : await getNpmVersion({ packageName: pkg.name });
    const status = determinePackageStatus({ pkg, npmVersion });

    packages.push({ dir, pkg, npmVersion, status });
  }

  return packages;
}

export async function runPublish({
  rootDir,
  dryRun,
}: {
  rootDir: string;
  dryRun: boolean;
}): Promise<{ successful: PublishResult[]; failed: PublishResult[] }> {
  if (dryRun) {
    console.log("🧪 DRY RUN MODE - No packages will be published\n");
  }

  console.log("🔍 Finding packages to publish...\n");

  const packages = await discoverPackages({ rootDir });
  const packagesToPublish: PackageInfo[] = [];

  for (const pkgInfo of packages) {
    switch (pkgInfo.status) {
      case "private": {
        console.log(`⏭️  Skipping private package: ${pkgInfo.pkg.name}`);
        break;
      }
      case "up-to-date": {
        console.log(
          `✅ Already published: ${pkgInfo.pkg.name}@${pkgInfo.pkg.version}`,
        );
        break;
      }
      case "update": {
        console.log(
          `📦 Needs update: ${pkgInfo.pkg.name} (npm: ${pkgInfo.npmVersion} → local: ${pkgInfo.pkg.version})`,
        );
        packagesToPublish.push(pkgInfo);
        break;
      }
      case "new": {
        console.log(
          `🆕 New package: ${pkgInfo.pkg.name}@${pkgInfo.pkg.version}`,
        );
        packagesToPublish.push(pkgInfo);
        break;
      }
      case "ahead-of-local": {
        console.log(
          `⚠️  npm is ahead: ${pkgInfo.pkg.name} (npm: ${pkgInfo.npmVersion} > local: ${pkgInfo.pkg.version})`,
        );
        break;
      }
    }
  }

  if (packagesToPublish.length === 0) {
    console.log("\n✨ All packages are up to date!");
    return { successful: [], failed: [] };
  }

  const action = dryRun ? "Would publish" : "Publishing";
  console.log(`\n📤 ${action} ${packagesToPublish.length} package(s)...\n`);

  const results: PublishResult[] = [];

  for (const { dir, pkg } of packagesToPublish) {
    const verb = dryRun ? "Would publish" : "Publishing";
    console.log(`${verb} ${pkg.name}@${pkg.version}...`);
    const result = await publishPackage({ dir, dryRun });
    results.push(result);

    if (result.success) {
      const msg = dryRun ? "Would be published" : "Published successfully";
      console.log(`  ✅ ${msg}\n`);
    } else {
      console.log(`  ❌ Failed: ${result.error}\n`);
    }
  }

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return { successful, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const rootDir = path.join(import.meta.dirname, "..");

  const { successful, failed } = await runPublish({ rootDir, dryRun });

  // Summary
  console.log("\n📊 Summary:");
  console.log(
    `  ✅ ${dryRun ? "Would publish" : "Published"}: ${successful.length}`,
  );
  console.log(`  ❌ Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed packages:");
    for (const f of failed) {
      console.log(`  - ${f.name}@${f.version}: ${f.error}`);
    }
    throw new Error(`Failed to publish ${failed.length} package(s)`);
  }

  // Output in changesets format for GitHub Action compatibility
  if (successful.length > 0 && !dryRun) {
    const publishedPackages = successful.map((p) => ({
      name: p.name,
      version: p.version,
    }));
    console.log("\n::set-output name=published::true");
    console.log(
      `::set-output name=publishedPackages::${JSON.stringify(publishedPackages)}`,
    );
  }
}

// Only run main if this is the entry point
if (import.meta.main) {
  await main();
}
