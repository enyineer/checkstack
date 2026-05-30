import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { scriptPackagesAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  InstallStateSchema,
  ManifestEntrySchema,
  PackageNameSchema,
  PackageSpecSchema,
  PackageTypesSchema,
  PackageVersionSchema,
  RegistryConfigSchema,
  SatelliteSyncStateSchema,
  SetRegistryConfigInputSchema,
  SizeCapConfigSchema,
  StorageConfigSchema,
} from "./schemas";

/**
 * Script-packages RPC contract.
 *
 * Management endpoints are gated by the dedicated `script-packages.manage`
 * permission (install-time RCE / supply-chain vector). The read-only
 * editor / runtime endpoints (`getInstallState`, `getManifest`,
 * `downloadBlob`, `listPackageTypes`) are gated by `script-packages.read`
 * so editors and reconcilers can use them.
 */
export const scriptPackagesContract = {
  // ─── Allowlist (manage) ────────────────────────────────────────────────

  listPackages: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(z.object({ items: z.array(PackageSpecSchema) })),

  addPackage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(
      z.object({ name: PackageNameSchema, version: PackageVersionSchema }),
    )
    .output(PackageSpecSchema),

  removePackage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .route({ method: "DELETE" })
    .input(z.object({ name: PackageNameSchema }))
    .output(z.object({ success: z.boolean() })),

  setPackageEnabled: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(z.object({ name: PackageNameSchema, enabled: z.boolean() }))
    .output(PackageSpecSchema),

  // ─── Registry config (manage) ──────────────────────────────────────────

  getRegistryConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(RegistryConfigSchema),

  setRegistryConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(SetRegistryConfigInputSchema)
    .output(RegistryConfigSchema),

  // ─── Install (manage) ──────────────────────────────────────────────────

  /**
   * Elect the installer (advisory lock), resolve the pinned allowlist,
   * publish new blobs, record the manifest, emit `script-packages.changed`.
   * Blocked while a storage migration is in flight.
   */
  installNow: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(
    z.object({
      started: z.boolean(),
      /** Populated when the install was refused (e.g. migration in flight). */
      reason: z.string().optional(),
    }),
  ),

  getSizeCapConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(SizeCapConfigSchema),

  setSizeCapConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(SizeCapConfigSchema)
    .output(SizeCapConfigSchema),

  // ─── Storage (manage) ──────────────────────────────────────────────────

  getStorageConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(StorageConfigSchema),

  setStorageBackend: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(z.object({ backend: z.string().min(1) }))
    .output(StorageConfigSchema),

  migrateStorage: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(z.object({ target: z.string().min(1) }))
    .output(z.object({ started: z.boolean(), reason: z.string().optional() })),

  getStorageMigrationState: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(StorageConfigSchema),

  // ─── Per-host status (manage) ──────────────────────────────────────────

  listSatelliteSyncState: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(z.object({ items: z.array(SatelliteSyncStateSchema) })),

  /**
   * Persist a satellite's reconcile state. Called by satellite-backend
   * (server-side, on a `script_package_sync_state` WS report) so the admin
   * UI can show per-satellite sync status. Read-gated because it's an
   * internal server-to-server call, not a user mutation of managed config.
   */
  reportSatelliteSyncState: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.read],
  })
    .input(
      z.object({
        satelliteId: z.string(),
        lockfileHash: z.string().nullable(),
        status: z.enum(["pending", "syncing", "ready", "error"]),
        errorMessage: z.string().optional(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  // ─── Authoring / runtime (read) ────────────────────────────────────────

  getInstallState: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.read],
  }).output(InstallStateSchema),

  /** Manifest for a given lockfile hash - used by reconcilers for delta diffing. */
  getManifest: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.read],
  })
    .input(z.object({ lockfileHash: z.string() }))
    .output(z.object({ entries: z.array(ManifestEntrySchema) })),

  /**
   * Download one content-addressed blob (zstd-compressed) by integrity hash.
   * The payload is base64 so it survives the JSON transport; satellites and
   * cold core pods pull missing blobs this way.
   */
  downloadBlob: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.read],
  })
    .input(z.object({ integrity: z.string() }))
    .output(
      z.object({
        integrity: z.string(),
        /** base64-encoded compressed blob bytes. */
        data: z.string(),
        sizeBytes: z.number().int().nonnegative(),
      }),
    ),

  listPackageTypes: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.read],
  }).output(z.object({ items: z.array(PackageTypesSchema) })),
};

export type ScriptPackagesContract = typeof scriptPackagesContract;

export const ScriptPackagesApi = createClientDefinition(
  scriptPackagesContract,
  pluginMetadata,
);
