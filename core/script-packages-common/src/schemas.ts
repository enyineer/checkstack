import { z } from "zod";

/**
 * Schemas for the script-packages platform.
 *
 * The admin curates a global allowlist of pinned npm packages
 * (`name@exact-version`). The central backend resolves + bundles the
 * package tree, publishes per-package content-addressed blobs to a
 * pluggable blob store, and records a lockfile manifest. Every host that
 * runs a user script (N core instances + each satellite) reconciles to
 * the desired `lockfileHash` by delta-syncing only the blobs it lacks.
 *
 * See the feature plan for the full distribution model.
 */

// ─── Package allowlist ───────────────────────────────────────────────────

/** A package name must be a valid (optionally scoped) npm package name. */
export const PackageNameSchema = z
  .string()
  .min(1)
  .max(214)
  .regex(
    /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
    "Invalid npm package name",
  );

/**
 * An exact semver version. Pinned (no ranges) so installs are
 * deterministic and the resulting tree is reproducible across hosts.
 */
export const PackageVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/,
    "Version must be exact (e.g. 4.17.21), not a range",
  );

/** One allowlist entry: a pinned package and whether it's currently enabled. */
export const PackageSpecSchema = z.object({
  name: PackageNameSchema,
  version: PackageVersionSchema,
  enabled: z.boolean().default(true),
  addedBy: z.string().nullable().optional(),
  addedAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type PackageSpec = z.infer<typeof PackageSpecSchema>;

// ─── Registry autocomplete (live search / version lookup) ─────────────────

/** Input for `searchPackages`: a partial package-name query. */
export const SearchPackagesInputSchema = z.object({
  text: z.string().min(1).max(214),
});
export type SearchPackagesInput = z.infer<typeof SearchPackagesInputSchema>;

/**
 * One live search hit. `version` is relaxed to a plain string in the OUTPUT
 * so a valid-but-unusual registry version is surfaced as a suggestion rather
 * than dropped - strict `PackageVersionSchema` validation still applies on
 * `addPackage`.
 */
export const PackageSearchHitSchema = z.object({
  name: PackageNameSchema,
  version: z.string().optional(),
  description: z.string().optional(),
});
export type PackageSearchHit = z.infer<typeof PackageSearchHitSchema>;

export const SearchPackagesOutputSchema = z.object({
  items: z.array(PackageSearchHitSchema),
});
export type SearchPackagesOutput = z.infer<typeof SearchPackagesOutputSchema>;

/** Input for `getPackageVersions`: an exact (optionally scoped) package name. */
export const GetPackageVersionsInputSchema = z.object({
  name: PackageNameSchema,
});
export type GetPackageVersionsInput = z.infer<
  typeof GetPackageVersionsInputSchema
>;

/** Versions newest-first plus dist-tags (e.g. `latest`). Versions relaxed. */
export const GetPackageVersionsOutputSchema = z.object({
  versions: z.array(z.string()),
  distTags: z.record(z.string(), z.string()).optional(),
});
export type GetPackageVersionsOutput = z.infer<
  typeof GetPackageVersionsOutputSchema
>;

// ─── Registry config ─────────────────────────────────────────────────────

/** A scoped-registry override: `@scope` → registry URL. */
export const ScopedRegistrySchema = z.object({
  scope: z
    .string()
    .regex(/^@[a-z0-9-~][a-z0-9-._~]*$/, "Scope must look like @acme"),
  registryUrl: z.string().url(),
});
export type ScopedRegistry = z.infer<typeof ScopedRegistrySchema>;

/**
 * Registry configuration rendered to `.npmrc` at install time. The auth
 * token is stored as a connection-store secret and NEVER returned to the
 * client in plaintext - the DTO carries only a boolean `hasAuthToken`.
 */
export const RegistryConfigSchema = z.object({
  registryUrl: z.string().url().default("https://registry.npmjs.org/"),
  scopedRegistries: z.array(ScopedRegistrySchema).default([]),
  /** True when an auth token secret is configured (never the value). */
  hasAuthToken: z.boolean().default(false),
  /**
   * `--ignore-scripts` toggle. Default ON: postinstall is the RCE vector
   * and the size guardrail (native builds / binary downloads won't run).
   */
  ignoreScripts: z.boolean().default(true),
  updatedAt: z.coerce.date().optional(),
});
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;

/** Input for `setRegistryConfig`. The token is write-only. */
export const SetRegistryConfigInputSchema = z.object({
  registryUrl: z.string().url(),
  scopedRegistries: z.array(ScopedRegistrySchema).default([]),
  ignoreScripts: z.boolean().default(true),
  /**
   * New auth token. Omit to leave the existing secret untouched; pass an
   * empty string to clear it. Never echoed back.
   */
  authToken: z.string().optional(),
});
export type SetRegistryConfigInput = z.infer<
  typeof SetRegistryConfigInputSchema
>;

// ─── Lockfile manifest ─────────────────────────────────────────────────────

/** One resolved package in the lockfile manifest. */
export const ManifestEntrySchema = z.object({
  name: PackageNameSchema,
  version: PackageVersionSchema,
  /** Integrity hash (sri, e.g. `sha512-...`) - the content-addressed key. */
  integrity: z.string().min(1),
  /**
   * SHA-256 (hex) of the DISTRIBUTED blob (our gzip-tar of the Bun cache
   * entry), computed at publish time. Unlike `integrity` (which hashes the
   * upstream npm tarball, not our archive), this lets a host verify the
   * transported bytes before extraction. Optional for backward
   * compatibility: entries published before this field skip verification
   * until the manifest is regenerated by a re-install.
   */
  blobSha256: z.string().length(64).optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const InstallStatusSchema = z.enum([
  "idle",
  "installing",
  "ready",
  "error",
]);
export type InstallStatus = z.infer<typeof InstallStatusSchema>;

/**
 * Desired install state: the `lockfileHash` every host reconciles to,
 * its manifest, and resolved total size. Surfaced to editors (for the
 * "packages ready" gate) and reconcilers (for delta diffing).
 */
export const InstallStateSchema = z.object({
  status: InstallStatusSchema,
  lockfileHash: z.string().nullable(),
  manifest: z.array(ManifestEntrySchema),
  totalSizeBytes: z.number().int().nonnegative(),
  lastInstalledAt: z.coerce.date().nullable(),
  errorMessage: z.string().nullable(),
});
export type InstallState = z.infer<typeof InstallStateSchema>;

// ─── Storage config / migration ────────────────────────────────────────────

/** Backend identifier for the active blob store. Open-ended (plugins). */
export const StorageBackendIdSchema = z.string().min(1);

export const MigrationStatusSchema = z.enum([
  "idle",
  "migrating",
  "completed",
  "error",
]);
export type MigrationStatus = z.infer<typeof MigrationStatusSchema>;

export const StorageConfigSchema = z.object({
  activeBackend: StorageBackendIdSchema,
  migrationStatus: MigrationStatusSchema,
  migrationTarget: z.string().nullable(),
  migratedCount: z.number().int().nonnegative(),
  migrationError: z.string().nullable(),
  updatedAt: z.coerce.date().optional(),
});
export type StorageConfig = z.infer<typeof StorageConfigSchema>;

// ─── Per-host reconcile state ───────────────────────────────────────────────

export const HostSyncStatusSchema = z.enum([
  "pending",
  "syncing",
  "ready",
  "error",
]);
export type HostSyncStatus = z.infer<typeof HostSyncStatusSchema>;

export const SatelliteSyncStateSchema = z.object({
  satelliteId: z.string(),
  lockfileHash: z.string().nullable(),
  status: HostSyncStatusSchema,
  errorMessage: z.string().nullable(),
  syncedAt: z.coerce.date().nullable(),
});
export type SatelliteSyncState = z.infer<typeof SatelliteSyncStateSchema>;

// ─── Editor IntelliSense (lazy ATA) ──────────────────────────────────────────

/**
 * One declaration file in a package's type closure. The `path` is a real
 * `node_modules/...`-relative path (e.g. `node_modules/@types/lodash/index.d.ts`
 * or `node_modules/zod/index.d.ts`); the frontend registers it at
 * `file:///<path>` so TypeScript's NodeJs + `@types` resolution finds it.
 * Files are UNWRAPPED (no `declare module` envelope).
 */
export const PackageTypeFileSchema = z.object({
  /** `node_modules/...`-relative virtual path. */
  path: z.string(),
  /** Verbatim file content. */
  content: z.string(),
});
export type PackageTypeFile = z.infer<typeof PackageTypeFileSchema>;

/**
 * The declaration-file closure for ONE requested specifier, resolved against
 * the materialized package tree. Returned by the lazy ATA route.
 */
export const PackageTypeClosureSchema = z.object({
  /** The requested bare specifier (e.g. `lodash`, `@babel/core`). */
  specifier: z.string(),
  /** Declaration files (own types and/or `@types` companion), unwrapped. */
  files: z.array(PackageTypeFileSchema),
  /** The package ships its own declarations. */
  hasOwnTypes: z.boolean(),
  /** A DefinitelyTyped `@types/...` companion exists in the tree. */
  hasAtTypes: z.boolean(),
  /** Neither own types nor an `@types` companion were found (graceful). */
  notFound: z.boolean(),
  /** The closure hit the size ceiling and dropped files (NOT silent). */
  truncated: z.boolean(),
});
export type PackageTypeClosure = z.infer<typeof PackageTypeClosureSchema>;

// ─── Size guardrail ─────────────────────────────────────────────────────────

/**
 * Total-size cap. The admin UI warns above `warnBytes` and blocks installs
 * above `blockBytes`. Defaults: warn 150 MB, block 300 MB (admin-configurable).
 */
export const SizeCapConfigSchema = z.object({
  warnBytes: z
    .number()
    .int()
    .positive()
    .default(150 * 1024 * 1024),
  blockBytes: z
    .number()
    .int()
    .positive()
    .default(300 * 1024 * 1024),
});
export type SizeCapConfig = z.infer<typeof SizeCapConfigSchema>;

export const DEFAULT_WARN_BYTES = 150 * 1024 * 1024;
export const DEFAULT_BLOCK_BYTES = 300 * 1024 * 1024;

// ─── Garbage collection ──────────────────────────────────────────────────────

/**
 * How many *previous* lockfile hashes (beyond the current desired one) the
 * blob GC keeps blobs for. Small by design: enough for rollback / an
 * in-flight reconcile toward a just-superseded hash, not an archive. The
 * current hash is ALWAYS retained on top of this.
 */
export const DEFAULT_BLOB_GC_RETAIN_PREVIOUS = 1;

/**
 * Grace window (ms) below which an unreferenced blob is kept even though no
 * retained manifest references it. Protects a core pod / satellite that is
 * mid-reconcile toward a just-superseded hash: it may still pull a blob that
 * was just dropped from the retained set. Keyed on `script_package_blob`
 * `created_at`. Default: 24h.
 */
export const DEFAULT_BLOB_GC_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Grace window (ms) below which a non-current tree dir is kept even though
 * `current` no longer points at it. Keyed on the tree dir's mtime and chosen
 * to comfortably exceed the longest possible script-run timeout so a live run
 * pinned to that tree (via its `resolutionRoot`) can never have its
 * node_modules deleted out from under it. Default: 1h.
 */
export const DEFAULT_TREE_GC_GRACE_MS = 60 * 60 * 1000;

/**
 * Result summary of a blob-GC pass, returned by `gcBlobs` and surfaced in the
 * Script Packages settings UI.
 */
export const BlobGcSummarySchema = z.object({
  /** True when the pass actually ran (false when refused, e.g. lock held). */
  ran: z.boolean(),
  /** Populated when the pass was refused or aborted. */
  reason: z.string().optional(),
  /** Candidate blobs unreferenced by any retained manifest. */
  candidates: z.number().int().nonnegative(),
  /** Blobs actually deleted (past-grace candidates). */
  deleted: z.number().int().nonnegative(),
  /** Candidates kept because they are still within the grace window. */
  keptWithinGrace: z.number().int().nonnegative(),
  /** Bytes reclaimed by the deletions. */
  bytesReclaimed: z.number().int().nonnegative(),
});
export type BlobGcSummary = z.infer<typeof BlobGcSummarySchema>;

/**
 * Persisted last-run state for the blob GC, so the admin UI can show "last
 * reclaimed N bytes at T" without re-running the (destructive) pass.
 */
export const BlobGcStateSchema = z.object({
  lastRunAt: z.coerce.date().nullable(),
  lastDeleted: z.number().int().nonnegative(),
  lastBytesReclaimed: z.number().int().nonnegative(),
  /** Cumulative bytes reclaimed across every run. */
  totalBytesReclaimed: z.number().int().nonnegative(),
});
export type BlobGcState = z.infer<typeof BlobGcStateSchema>;

// ─── Vulnerability audit ──────────────────────────────────────────────────

/**
 * Normalised advisory severity. `bun audit` reports npm's scale
 * (`low` | `moderate` | `high` | `critical`); we keep those verbatim so the
 * UI and the notify-threshold logic share one vocabulary. (`moderate` is
 * npm's "medium".)
 */
export const AuditSeveritySchema = z.enum([
  "low",
  "moderate",
  "high",
  "critical",
]);
export type AuditSeverity = z.infer<typeof AuditSeveritySchema>;

/**
 * Ordinal rank for a severity, so callers can compare "at or above a
 * threshold" without re-encoding the order. Higher = more severe.
 */
export const AUDIT_SEVERITY_RANK: Record<AuditSeverity, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

/**
 * Severities that trigger a notification to `script-packages.manage`
 * holders. ALL severities are RECORDED regardless; this gate is only for
 * the (potentially noisy) notification path. Locked product decision:
 * notify on medium (moderate) + high + critical.
 */
export const AUDIT_NOTIFY_THRESHOLD: AuditSeverity = "moderate";

/**
 * One advisory affecting one package in the installed script-packages tree,
 * as parsed from `bun audit --json` and persisted per `lockfileHash`.
 */
export const AuditAdvisorySchema = z.object({
  /** The vulnerable package (the direct or transitive dep name). */
  packageName: z.string().min(1),
  /** Advisory id from the registry advisory DB (e.g. GHSA numeric id). */
  advisoryId: z.string().min(1),
  /** Human-readable advisory title. */
  title: z.string(),
  severity: AuditSeveritySchema,
  /** Affected version range (e.g. `<4.17.21`). */
  vulnerableVersions: z.string(),
  /** Advisory URL (e.g. the GitHub advisory page). */
  url: z.string().nullable(),
  /** CVSS base score when the registry provides one. */
  cvssScore: z.number().nullable(),
});
export type AuditAdvisory = z.infer<typeof AuditAdvisorySchema>;

/**
 * Last-run summary for the audit, surfaced in the settings UI so a manager
 * can see when it last ran and the headline counts without re-listing every
 * advisory.
 */
export const AuditStateSchema = z.object({
  lastRunAt: z.coerce.date().nullable(),
  /** The `lockfileHash` the last successful run audited. */
  lockfileHash: z.string().nullable(),
  /** Total advisories found in the last successful run (all severities). */
  total: z.number().int().nonnegative(),
  /** Counts by severity from the last successful run. */
  counts: z.object({
    low: z.number().int().nonnegative(),
    moderate: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }),
  /** Error message when the last run failed (null on success). */
  errorMessage: z.string().nullable(),
});
export type AuditState = z.infer<typeof AuditStateSchema>;

/** Current advisories + last-run summary, returned by `getAuditState`. */
export const AuditReportSchema = z.object({
  state: AuditStateSchema,
  advisories: z.array(AuditAdvisorySchema),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

/**
 * Result of triggering an on-demand audit. `ran: false` with a `reason`
 * means the pass was refused (e.g. the installer lock was held by an
 * install / migration / GC) and the caller should retry later.
 */
export const AuditRunSummarySchema = z.object({
  ran: z.boolean(),
  reason: z.string().optional(),
  /** The `lockfileHash` audited (null when nothing is installed). */
  lockfileHash: z.string().nullable(),
  /** Advisories found in this pass (all severities). */
  total: z.number().int().nonnegative(),
  /** Newly-appeared / escalated advisories at or above the notify threshold. */
  notified: z.number().int().nonnegative(),
});
export type AuditRunSummary = z.infer<typeof AuditRunSummarySchema>;
