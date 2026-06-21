import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  coreServices,
  type SafeDatabase,
  type PluginSource,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import {
  installPreviewSchema,
  uninstallPreviewSchema,
  type InstallPreview,
  type UninstallPreview,
} from "@checkstack/pluginmanager-common";
import type { PluginManager } from "../plugin-manager";
import type { ServiceRegistry } from "./service-registry";
import { plugins, pluginConfigs } from "../schema";
import { resolveBundle } from "./plugin-bundle-resolver";
import {
  loadCheckstackPackageVersions,
  checkCompatibility,
} from "./compatibility-checker";
import type { PluginEventRecorder } from "./plugin-event-recorder";
import { PluginInstallError } from "./plugin-installers/plugin-install-error";

/**
 * Originator-side install/uninstall orchestration.
 *
 * Lives next to the router because both flows are tightly coupled to the
 * `pluginManager` instance, the artifact store, and `db`. The router is a
 * thin oRPC wrapper over these functions.
 */

export async function previewInstallOriginator({
  source,
  registry,
  workspaceRoot,
  runtimeDir,
}: {
  source: PluginSource;
  registry: ServiceRegistry;
  workspaceRoot: string;
  runtimeDir: string;
}): Promise<InstallPreview> {
  const installerRegistry = await registry.get(
    coreServices.pluginInstallerRegistry,
    { pluginId: "core" },
  );

  const { primary, packages } = await resolveBundle({
    source,
    installerRegistry,
  });

  const loadedVersions = loadCheckstackPackageVersions({
    workspaceRoot,
    runtimeDir,
  });

  const compatibilityIssues = checkCompatibility({
    packages: packages.map((p) => p.packageJson),
    loadedVersions,
  });

  const totalSizeBytes = packages.reduce(
    (sum, p) => sum + p.tarball.byteLength,
    0,
  );
  const hasInstallScripts = packages.some(
    (p) => p.packageJson.checkstack.allowInstallScripts === true,
  );

  return installPreviewSchema.parse({
    primary: primary.packageJson,
    packages: packages.map((p) => p.packageJson),
    compatibilityIssues,
    totalSizeBytes,
    hasInstallScripts,
  } satisfies InstallPreview);
}

export async function installOriginator({
  source,
  pluginManager,
  db,
  registry,
  workspaceRoot,
  runtimeDir,
  eventRecorder,
  userId,
}: {
  source: PluginSource;
  pluginManager: PluginManager;
  db: SafeDatabase<Record<string, unknown>>;
  registry: ServiceRegistry;
  workspaceRoot: string;
  runtimeDir: string;
  eventRecorder: PluginEventRecorder;
  userId?: string;
}): Promise<{
  bundleId: string | null;
  installedPackages: string[];
}> {
  const installerRegistry = await registry.get(
    coreServices.pluginInstallerRegistry,
    { pluginId: "core" },
  );
  const artifactStore = await registry.get(coreServices.pluginArtifactStore, {
    pluginId: "core",
  });

  // 1. Validate (re-fetch + recheck — preview is non-binding)
  await eventRecorder.record({
    action: "install",
    phase: "validate",
    status: "started",
    source,
    userId,
  });
  const { primary, packages } = await resolveBundle({
    source,
    installerRegistry,
  });
  const loadedVersions = loadCheckstackPackageVersions({
    workspaceRoot,
    runtimeDir,
  });
  const issues = checkCompatibility({
    packages: packages.map((p) => p.packageJson),
    loadedVersions,
  });
  if (issues.length > 0) {
    const message = issues.map((i) => i.message).join("\n");
    await eventRecorder.record({
      pluginName: primary.packageJson.name,
      action: "install",
      phase: "validate",
      status: "failed",
      source,
      error: message,
      userId,
    });
    throw new PluginInstallError(
      "COMPATIBILITY_FAILED",
      `This plugin isn't compatible with the platform:\n${message}`,
      { issues },
    );
  }
  await eventRecorder.record({
    pluginName: primary.packageJson.name,
    action: "install",
    phase: "validate",
    status: "succeeded",
    source,
    userId,
  });

  // 2. Persist artifacts + plugins rows. One bundle = one bundleId.
  // Single-package installs use `null` (drizzle writes a real NULL column),
  // not `undefined` (which would skip the column on insert).
  const bundleId: string | null =
    packages.length > 1 ? randomUUID() : null;
  await eventRecorder.record({
    pluginName: primary.packageJson.name,
    bundleId,
    action: "install",
    phase: "persist",
    status: "started",
    source,
    userId,
  });

  try {
    for (const pkg of packages) {
      // `store()` computes and returns the canonical SHA-256 of the tarball
      // bytes. We pin that digest on the `plugins` row so a later reload can
      // re-verify the artifact has not been tampered with (fail-closed).
      const { contentHash: installedDigest } = await artifactStore.store({
        pluginName: pkg.packageJson.name,
        version: pkg.packageJson.version,
        bundleId,
        tarball: pkg.tarball,
      });

      // Insert / update plugins row. We do NOT install into node_modules
      // here on the originator — that happens uniformly on every instance
      // (originator included) when the install broadcast is handled.
      const isPrimary = pkg.packageJson.name === primary.packageJson.name;
      const expectedPath = path.join(
        runtimeDir,
        "node_modules",
        pkg.packageJson.name,
      );
      await db
        .insert(plugins)
        .values({
          name: pkg.packageJson.name,
          path: expectedPath,
          enabled: true,
          isUninstallable: true,
          type: pkg.packageJson.checkstack.type,
          version: pkg.packageJson.version,
          metadata: pkg.packageJson,
          source,
          bundleId,
          isPrimary,
          installedDigest,
        })
        .onConflictDoUpdate({
          target: [plugins.name],
          set: {
            path: expectedPath,
            enabled: true,
            isUninstallable: true,
            type: pkg.packageJson.checkstack.type,
            version: pkg.packageJson.version,
            metadata: pkg.packageJson,
            source,
            bundleId,
            isPrimary,
            installedDigest,
          },
        });
    }
    await eventRecorder.record({
      pluginName: primary.packageJson.name,
      bundleId,
      action: "install",
      phase: "persist",
      status: "succeeded",
      source,
      userId,
    });
  } catch (error) {
    await eventRecorder.record({
      pluginName: primary.packageJson.name,
      bundleId,
      action: "install",
      phase: "persist",
      status: "failed",
      source,
      error: extractErrorMessage(error),
      userId,
    });
    throw error;
  }

  // 3. Broadcast — every instance (incl. originator) hydrates from
  //    plugin_artifacts and loads the module. Backend packages first so
  //    frontend siblings have access to backend services on init.
  const sortedPackageNames = packages
    .toSorted(
      (a, b) =>
        orderForType(a.packageJson.checkstack.type) -
        orderForType(b.packageJson.checkstack.type),
    )
    .map((p) => p.packageJson.name);

  await eventRecorder.record({
    pluginName: primary.packageJson.name,
    bundleId,
    action: "install",
    phase: "broadcast",
    status: "started",
    source,
    userId,
  });
  try {
    await pluginManager.broadcastInstallation(sortedPackageNames);
    await eventRecorder.record({
      pluginName: primary.packageJson.name,
      bundleId,
      action: "install",
      phase: "broadcast",
      status: "succeeded",
      source,
      userId,
    });
  } catch (error) {
    await eventRecorder.record({
      pluginName: primary.packageJson.name,
      bundleId,
      action: "install",
      phase: "broadcast",
      status: "failed",
      source,
      error: extractErrorMessage(error),
      userId,
    });
    throw error;
  }

  return {
    bundleId,
    installedPackages: sortedPackageNames,
  };
}

export async function previewUninstallOriginator({
  pluginName,
  db,
}: {
  pluginName: string;
  db: SafeDatabase<Record<string, unknown>>;
}): Promise<UninstallPreview> {
  const rows = await db
    .select()
    .from(plugins)
    .where(eq(plugins.name, pluginName))
    .limit(1);
  if (rows.length === 0) {
    throw new PluginInstallError(
      "NOT_FOUND",
      `Plugin '${pluginName}' is not installed.`,
    );
  }
  const target = rows[0];
  if (!target.isUninstallable) {
    throw new PluginInstallError(
      "FORBIDDEN",
      `Plugin '${pluginName}' is part of the platform core and cannot be uninstalled.`,
    );
  }

  const siblings: string[] = [];
  if (target.bundleId) {
    const sibRows = await db
      .select({ name: plugins.name })
      .from(plugins)
      .where(eq(plugins.bundleId, target.bundleId));
    for (const r of sibRows) siblings.push(r.name);
  } else {
    siblings.push(target.name);
  }

  // Collect the set of plugin ids whose schemas would drop.
  const schemasToDrop = siblings.map((s) => `plugin_${s}`);

  // Plugin configs row count for siblings.
  const allConfigsRows = await db
    .select({ count: sql<string>`count(*)` })
    .from(pluginConfigs)
    .where(inArray(pluginConfigs.pluginId, siblings));
  const pluginConfigCount = Number(allConfigsRows[0]?.count ?? 0);

  // Dependents — other (loaded) runtime plugins whose @checkstack/* deps
  // include any of the siblings.
  const dependents: string[] = [];
  const otherRows = await db
    .select()
    .from(plugins)
    .where(and(eq(plugins.isUninstallable, true)));
  for (const row of otherRows) {
    if (siblings.includes(row.name)) continue;
    const deps =
      (row.metadata as { dependencies?: Record<string, string> })?.dependencies ??
      {};
    if (Object.keys(deps).some((d) => siblings.includes(d))) {
      dependents.push(row.name);
    }
  }

  return uninstallPreviewSchema.parse({
    pluginName: target.name,
    siblings,
    dependents,
    schemasToDrop,
    pluginConfigCount,
  } satisfies UninstallPreview);
}

export async function uninstallOriginator({
  pluginName,
  deleteSchema,
  deleteConfigs,
  cascade,
  pluginManager,
  db,
  eventRecorder,
  userId,
}: {
  pluginName: string;
  deleteSchema: boolean;
  deleteConfigs: boolean;
  cascade: boolean;
  pluginManager: PluginManager;
  db: SafeDatabase<Record<string, unknown>>;
  eventRecorder: PluginEventRecorder;
  userId?: string;
}): Promise<{ uninstalledPackages: string[] }> {
  const target = await db
    .select()
    .from(plugins)
    .where(eq(plugins.name, pluginName))
    .limit(1)
    .then((rows) => rows[0]);
  if (!target) {
    throw new PluginInstallError(
      "NOT_FOUND",
      `Plugin '${pluginName}' is not installed.`,
    );
  }
  if (!target.isUninstallable) {
    throw new PluginInstallError(
      "FORBIDDEN",
      `Plugin '${pluginName}' is part of the platform core and cannot be uninstalled.`,
    );
  }

  const ids: string[] = [];
  if (target.bundleId) {
    const sibRows = await db
      .select({ name: plugins.name })
      .from(plugins)
      .where(eq(plugins.bundleId, target.bundleId));
    for (const r of sibRows) ids.push(r.name);
  } else {
    ids.push(target.name);
  }

  if (cascade) {
    // Find all dependents recursively via metadata.dependencies.
    const queue = [...ids];
    const seen = new Set(ids);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const candidates = await db
        .select()
        .from(plugins)
        .where(and(eq(plugins.isUninstallable, true)));
      for (const row of candidates) {
        if (seen.has(row.name)) continue;
        const deps =
          (row.metadata as { dependencies?: Record<string, string> })
            ?.dependencies ?? {};
        if (Object.keys(deps).includes(current)) {
          ids.push(row.name);
          seen.add(row.name);
          queue.push(row.name);
        }
      }
    }
  }

  // 1. Broadcast in-process unload to all instances (incl. originator).
  await eventRecorder.record({
    pluginName,
    bundleId: target.bundleId ?? undefined,
    action: "uninstall",
    phase: "broadcast",
    status: "started",
    userId,
  });
  try {
    await pluginManager.broadcastDeregistration(ids);
    await eventRecorder.record({
      pluginName,
      bundleId: target.bundleId ?? undefined,
      action: "uninstall",
      phase: "broadcast",
      status: "succeeded",
      userId,
    });
  } catch (error) {
    await eventRecorder.record({
      pluginName,
      bundleId: target.bundleId ?? undefined,
      action: "uninstall",
      phase: "broadcast",
      status: "failed",
      error: extractErrorMessage(error),
      userId,
    });
    throw error;
  }

  // 2. Originator-only destructive cleanup.
  await eventRecorder.record({
    pluginName,
    bundleId: target.bundleId ?? undefined,
    action: "uninstall",
    phase: "destructive-cleanup",
    status: "started",
    userId,
  });
  try {
    await pluginManager.deletePluginData({
      pluginIds: ids,
      bundleId: target.bundleId ?? undefined,
      deleteSchema,
      deleteConfigs,
    });
    await eventRecorder.record({
      pluginName,
      bundleId: target.bundleId ?? undefined,
      action: "uninstall",
      phase: "destructive-cleanup",
      status: "succeeded",
      userId,
    });
  } catch (error) {
    await eventRecorder.record({
      pluginName,
      bundleId: target.bundleId ?? undefined,
      action: "uninstall",
      phase: "destructive-cleanup",
      status: "failed",
      error: extractErrorMessage(error),
      userId,
    });
    throw error;
  }

  return { uninstalledPackages: ids };
}

function orderForType(t: "backend" | "frontend" | "common"): number {
  switch (t) {
    case "common": { return 0;
    }
    case "backend": { return 1;
    }
    case "frontend": { return 2;
    }
  }
}
