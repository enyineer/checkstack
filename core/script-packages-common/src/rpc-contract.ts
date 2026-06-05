import { z } from "zod";
import {
  createClientDefinition,
  proc,
  sandboxPolicySchema,
} from "@checkstack/common";
import { scriptPackagesAccess, scriptSandboxAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  AuditReportSchema,
  AuditRunSummarySchema,
  BlobGcStateSchema,
  BlobGcSummarySchema,
  GetPackageVersionsInputSchema,
  GetPackageVersionsOutputSchema,
  InstallStateSchema,
  ManifestEntrySchema,
  PackageNameSchema,
  PackageSpecSchema,
  PackageVersionSchema,
  RegistryConfigSchema,
  SatelliteSyncStateSchema,
  SearchPackagesInputSchema,
  SearchPackagesOutputSchema,
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
 * `downloadBlob`) are gated by `script-packages.read` so editors and
 * reconcilers can use them.
 *
 * NOTE: package-type IntelliSense is NOT an RPC procedure. It is served as
 * a raw, HTTP-cacheable route (`GET /api/script-packages/types/:hash/:spec`)
 * so the browser can cache each closure per-install via `Cache-Control`;
 * see `createTypeClosureHttpHandler` in `script-packages-backend`.
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

  // ─── Registry autocomplete (manage) ────────────────────────────────────

  /**
   * Live package-name search against the configured registry, backend-proxied
   * (the registry may be private with a server-side-only token, and browsers
   * can't reach arbitrary registries due to CORS). Gated by `manage` like the
   * other registry endpoints.
   */
  searchPackages: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(SearchPackagesInputSchema)
    .output(SearchPackagesOutputSchema),

  /**
   * Fetch published versions (newest-first) + dist-tags for a package from
   * the configured registry. Backend-proxied for the same reasons as
   * `searchPackages`. The version list feeds the version field's suggestions.
   */
  getPackageVersions: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  })
    .input(GetPackageVersionsInputSchema)
    .output(GetPackageVersionsOutputSchema),

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

  /** Registered blob-store backend ids available as migration targets. */
  listStorageBackends: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(z.object({ backends: z.array(z.string()) })),

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

  // ─── Garbage collection (manage) ───────────────────────────────────────

  /**
   * Admin-triggered blob GC: prune content-addressed blobs no longer
   * referenced by any RETAINED lockfile manifest (current + the previous N),
   * older than the grace window. Refuses while an install or storage
   * migration is in flight (takes the installer-election advisory lock).
   * Returns a summary (candidates, deleted, bytes reclaimed).
   */
  gcBlobs: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(BlobGcSummarySchema),

  /** Last blob-GC run state (for the settings UI). */
  getBlobGcState: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(BlobGcStateSchema),

  // ─── Vulnerability audit (manage) ──────────────────────────────────────

  /**
   * Current audit findings (all severities) plus the last-run summary, for
   * the settings UI. Reads from the plugin's own Postgres tables, so every
   * pod returns the same advisories regardless of which pod ran the audit.
   */
  getAuditState: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(AuditReportSchema),

  /**
   * Run a vulnerability audit on demand: `bun audit --json` against the
   * current resolved tree, persist the advisories, and notify
   * `script-packages.manage` holders about newly-appeared / escalated
   * advisories at or above the notify threshold. Elected via the installer
   * advisory lock (refuses while an install / migration / GC holds it), so
   * `ran: false` with a `reason` means "retry later".
   */
  auditNow: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptPackagesAccess.manage],
  }).output(AuditRunSummarySchema),

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

  // ─── Global sandbox policy (admin-only, dedicated permission) ───────────

  /**
   * Read the resolved, durable GLOBAL script-sandbox policy. This is the
   * SINGLE cluster-wide source of truth that every script runner (core +
   * satellite) enforces. Admin-only (`script-sandbox.manage`): the policy
   * reveals the cluster's exact egress / filesystem / privilege posture.
   *
   * Also called server-to-server by the script plugins' policy provider (so
   * every runner resolves the identical row) and by satellite-backend to relay
   * the policy to connected satellites - both authenticate as services with
   * the necessary access.
   */
  getSandboxPolicy: proc({
    operationType: "query",
    userType: "authenticated",
    access: [scriptSandboxAccess.manage],
  }).output(sandboxPolicySchema),

  /**
   * Persist the GLOBAL script-sandbox policy. The input is treated as a PARTIAL
   * override merged over the shipped safe default, so loosening a single layer
   * does not silently reset the others. Returns the fully-resolved policy that
   * was stored. Admin-only (`script-sandbox.manage`). On success the backend
   * broadcasts the new policy to all connected satellites.
   */
  setSandboxPolicy: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [scriptSandboxAccess.manage],
  })
    .input(sandboxPolicySchema)
    .output(sandboxPolicySchema),

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
};

export type ScriptPackagesContract = typeof scriptPackagesContract;

export const ScriptPackagesApi = createClientDefinition(
  scriptPackagesContract,
  pluginMetadata,
);
