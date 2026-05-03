import path from "node:path";
import fs from "node:fs";
import { eq, and, notInArray } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import { plugins } from "../schema";
import { rootLogger } from "../logger";

export interface PluginMetadata {
  packageName: string; // From package.json "name"
  pluginPath: string; // Absolute path to plugin directory
  type: "backend" | "frontend" | "common";
  enabled: boolean;
  version: string; // From package.json "version"
}

/**
 * Extracts plugin metadata from a plugin directory by reading package.json
 * @param pluginDir - Absolute path to plugin directory
 * @returns PluginMetadata if valid, undefined if invalid/malformed
 */
export function extractPluginMetadata({
  pluginDir,
}: {
  pluginDir: string;
}): PluginMetadata | undefined {
  const pkgJsonPath = path.join(pluginDir, "package.json");

  if (!fs.existsSync(pkgJsonPath)) {
    return undefined;
  }

  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));

    if (!pkgJson.name || typeof pkgJson.name !== "string") {
      return undefined;
    }

    // Transition: Strictly require checkstack metadata block
    if (!pkgJson.checkstack || typeof pkgJson.checkstack !== "object") {
      if (pkgJson.name.endsWith("-backend") || pkgJson.name.endsWith("-frontend") || pkgJson.name.endsWith("-common")) {
        rootLogger.debug(`⏭️  Skipping package '${pkgJson.name}': Missing 'checkstack' metadata block in package.json`);
      }
      return undefined;
    }

    // Exclusion: Never discover the host platform itself as a plugin
    if (pkgJson.name === "@checkstack/backend") {
      return undefined;
    }

    const type = pkgJson.checkstack.type;
    if (type === "tooling") {
      rootLogger.debug(`⏭️  Skipping package '${pkgJson.name}': Identified as 'tooling'`);
      return undefined;
    }

    if (type !== "backend" && type !== "frontend" && type !== "common") {
      rootLogger.debug(`⏭️  Skipping package '${pkgJson.name}': Invalid checkstack type '${type}'`);
      return undefined;
    }

    return {
      packageName: pkgJson.name,
      pluginPath: pluginDir,
      type,
      enabled: true, // Local plugins are always enabled
      version: typeof pkgJson.version === "string" ? pkgJson.version : "",
    };
  } catch (error) {
    rootLogger.debug(`⚠️  Failed to read package.json for ${pluginDir}:`, error);
    return undefined;
  }
}

/**
 * Discovers all local plugins in the monorepo workspace
 * Scans both packages/ (core components) and plugins/ (replaceable providers)
 * @param workspaceRoot - Absolute path to workspace root
 * @param type - Optional filter for plugin type (backend, frontend, or common)
 * @returns Array of PluginMetadata for all valid plugins
 */
export function discoverLocalPlugins({
  workspaceRoot,
  type,
}: {
  workspaceRoot: string;
  type?: "backend" | "frontend" | "common";
}): PluginMetadata[] {
  const discovered: PluginMetadata[] = [];

  // Scan both packages/ (core) and plugins/ (providers)
  const dirsToScan = [
    path.join(workspaceRoot, "core"),
    path.join(workspaceRoot, "plugins"),
  ];

  for (const scanDir of dirsToScan) {
    if (!fs.existsSync(scanDir)) {
      continue;
    }

    const entries = fs.readdirSync(scanDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginDir = path.join(scanDir, entry.name);
      const metadata = extractPluginMetadata({ pluginDir });

      if (metadata && (!type || metadata.type === type)) {
        discovered.push(metadata);
      }
    }
  }

  return discovered;
}

/**
 * Syncs local plugins to the database
 * - Inserts new plugins
 * - Updates paths for existing plugins (handles renames)
 * - Does not modify remotely installed plugins (isUninstallable=true)
 * @param localPlugins - Array of local plugin metadata
 * @param db - Database connection
 */
export async function syncPluginsToDatabase({
  localPlugins,
  db,
}: {
  localPlugins: PluginMetadata[];
  db: SafeDatabase<Record<string, unknown>>;
}): Promise<void> {
  for (const plugin of localPlugins) {
    // Check if plugin already exists
    const existing = await db
      .select()
      .from(plugins)
      .where(eq(plugins.name, plugin.packageName))
      .limit(1);

    if (existing.length === 0) {
      // Insert new plugin
      await db.insert(plugins).values({
        name: plugin.packageName,
        path: plugin.pluginPath,
        type: plugin.type,
        enabled: plugin.enabled,
        isUninstallable: false, // Local plugins are part of monorepo
        version: plugin.version,
      });
    } else {
      // Update existing plugin ONLY if it's a local plugin (not remotely installed)
      // This handles the case where a plugin directory was renamed AND keeps
      // `version` in lockstep with each release.
      if (!existing[0].isUninstallable) {
        await db
          .update(plugins)
          .set({
            path: plugin.pluginPath,
            type: plugin.type,
            version: plugin.version,
          })
          .where(
            and(
              eq(plugins.name, plugin.packageName),
              eq(plugins.isUninstallable, false)
            )
          );
      }
    }
  }

  // 3. Prune local plugins from DB that are no longer present on disk
  // This is critical for Docker production builds where folders are pruned
  const localPackageNames = localPlugins.map((p) => p.packageName);
  
  try {
    const whereCondition = and(
      eq(plugins.isUninstallable, false),
      localPackageNames.length > 0
        ? notInArray(plugins.name, localPackageNames)
        : undefined,
    );

    // satisfy unicorn/prefer-ternary
    await (localPackageNames.length > 0
      ? db.delete(plugins).where(whereCondition)
      : db.delete(plugins).where(eq(plugins.isUninstallable, false)));

    rootLogger.debug("   -> Local plugin synchronization complete");
  } catch (error) {
    rootLogger.error("❌ Failed to prune stale plugins from database:", error);
  }
}
