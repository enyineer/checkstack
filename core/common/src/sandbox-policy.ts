import { z } from "zod";

/**
 * Canonical, transport-safe sandbox policy schema (the single source of truth
 * for the policy SHAPE).
 *
 * This lives in `@checkstack/common` - the neutral base every tier already
 * depends on - NOT in `@checkstack/backend-api` and NOT in a plugin's
 * `*-common` package, so it can be imported by:
 *
 *  - the script-packages RPC contract (`@checkstack/script-packages-common`),
 *    which exposes the admin read / write endpoints for the global policy;
 *  - the satellite WS protocol (`@checkstack/satellite-common`), which relays
 *    the resolved global policy to satellites on connect and on change;
 *  - `@checkstack/backend-api`, whose `script-sandbox/policy.ts` re-exports this
 *    schema and layers the runtime-only helpers (the shipped default profile,
 *    the env-seeded UID/GID resolution, and `mergeSandboxPolicy`) on top.
 *
 * Common packages cannot depend on `backend-api`, and putting the pure schema
 * in a single plugin's `*-common` forced backward dependencies from
 * `backend-api` and `satellite-common` onto that plugin. Hosting it in the
 * neutral base keeps it shareable across the contract + protocol + platform
 * without an inverted dependency or a duplicated definition (which would risk
 * drift).
 *
 * Phase 1 implemented: resource caps (rlimits + output truncation), privilege
 * dropping (uid/gid), and the env-key denylist. Filesystem and network
 * isolation are enforced in later phases; the schema scaffolds every layer.
 */

/** What to do when a requested layer cannot be enforced on this host. */
export const onUnavailableSchema = z
  .enum(["degrade", "fail"])
  .describe(
    "degrade = drop this layer to the portable subset and surface a downgrade; " +
      "fail = refuse to run when the layer can't be enforced.",
  );

export type OnUnavailable = z.infer<typeof onUnavailableSchema>;

/** Per-run resource caps. All optional; unset = not capped by this layer. */
export const resourceLimitsSchema = z
  .object({
    cpuSeconds: z
      .number()
      .int()
      .positive()
      .max(3600)
      .optional()
      .describe(
        "Max CPU time (RLIMIT_CPU). Distinct from the wall-clock timeout.",
      ),
    memoryBytes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Max address space (RLIMIT_AS). On the ESM runner also derives " +
          "--smol / --max-old-space-size as the portable fallback.",
      ),
    maxOpenFiles: z
      .number()
      .int()
      .positive()
      .max(1_048_576)
      .optional()
      .describe("Max open file descriptors (RLIMIT_NOFILE)."),
    maxProcesses: z
      .number()
      .int()
      .positive()
      .max(65_536)
      .optional()
      .describe(
        "Max processes/threads for the run's UID (RLIMIT_NPROC). Fork-bomb guard.",
      ),
    maxOutputBytes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Hard cap on captured stdout+stderr; the runner truncates and flags overflow.",
      ),
    maxFileSizeBytes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Max single-file write size (RLIMIT_FSIZE). Disk-filler guard.",
      ),
  })
  .strict();

export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;

export const filesystemPolicySchema = z
  .object({
    mode: z
      .enum(["off", "scratch-only", "scratch-plus-ro"])
      .default("off")
      .describe(
        "off = current behavior (full host FS). " +
          "scratch-only = child sees only its per-run scratch dir (writable) + a minimal /usr,/bin,/lib read-only. " +
          "scratch-plus-ro = scratch-only PLUS a read-only bind of resolutionRoot/node_modules for managed packages.",
      ),
    scratchBytes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Optional tmpfs size cap for the scratch dir when the mechanism supports it.",
      ),
  })
  .strict();

export type FilesystemPolicy = z.infer<typeof filesystemPolicySchema>;

export const networkPolicySchema = z
  .object({
    mode: z
      .enum(["unrestricted", "deny", "allowlist"])
      .default("unrestricted")
      .describe(
        "unrestricted = current behavior. " +
          "deny = no egress (loopback only). " +
          "allowlist = only the listed destinations are reachable.",
      ),
    /** v1: IP / CIDR only. Domains are a v2 extension. */
    allow: z
      .array(z.string())
      .default([])
      .describe(
        "IPv4/IPv6 addresses or CIDR blocks reachable when mode=allowlist.",
      ),
    denyLinkLocalAndMetadata: z
      .boolean()
      .default(true)
      .describe(
        "Always block 169.254.0.0/16, fc00::/7 link-local, and cloud metadata IPs, even under unrestricted, when a network layer is active.",
      ),
  })
  .strict();

export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

export const privilegePolicySchema = z
  .object({
    mode: z
      .enum(["inherit", "drop-to-uid"])
      .default("inherit")
      .describe(
        "inherit = run as the host process UID (current). drop-to-uid = run as the configured low-priv UID/GID.",
      ),
    uid: z.number().int().nonnegative().optional(),
    gid: z.number().int().nonnegative().optional(),
  })
  .strict();

export type PrivilegePolicy = z.infer<typeof privilegePolicySchema>;

export const sandboxPolicySchema = z
  .object({
    /**
     * Master switch. Schema default is TRUE (on-by-default with opt-out).
     * Set `enabled: false` to restore the pre-hardening behavior (the
     * documented opt-out). The GLOBAL default policy that the runner actually
     * parses against is the permissive DEFAULT PROFILE, not the bare per-field
     * zod defaults below - the field defaults stay conservative so an explicit
     * partial override (e.g. just `{ network: { mode: "deny" } }`) doesn't
     * accidentally widen the other layers.
     */
    enabled: z.boolean().default(true),
    onUnavailable: onUnavailableSchema.default("degrade"),
    // `.prefault({})` runs the empty default THROUGH the nested schema so each
    // layer's own field defaults (e.g. `filesystem.mode = "off"`) are applied.
    // Plain `.default({})` would store a literal `{}` and skip nested defaults.
    resources: resourceLimitsSchema.prefault({}),
    filesystem: filesystemPolicySchema.prefault({}),
    network: networkPolicySchema.prefault({}),
    privilege: privilegePolicySchema.prefault({}),
  })
  .strict();

export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type SandboxPolicyInput = z.input<typeof sandboxPolicySchema>;
