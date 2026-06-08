import { z } from "zod";

/**
 * Context taxonomy + wire schemas for the AI assistant's context tools (the
 * script context tools, §2.1-§2.3, and the capability catalog, §2.4, of the
 * AI-assistant context-tools plan). These are transport-facing zod schemas
 * only; the builders + handlers live in `@checkstack/ai-backend`.
 */

/**
 * WHERE a script lives. The available SDK symbols + the test runner differ per
 * value, so the model must name the context before it asks for symbols or runs
 * a draft. The enum carries all four contexts from day one so the wire contract
 * never has to widen (OQ-1).
 */
export const ScriptContextKindSchema = z.enum([
  "healthcheck-script", // inline TS health-check collector
  "healthcheck-shell", // shell health-check collector
  "automation-action-script", // run_script automation action (TS)
  "automation-action-shell", // run_shell automation action
]);
export type ScriptContextKind = z.infer<typeof ScriptContextKindSchema>;

/**
 * WHICH capability catalog the model wants from `ai.listCapabilities` (Phase 3).
 * Distinguishes the two registry substrates the editors read from: health-check
 * strategies/collectors and automation triggers/actions/artifact-types. GitOps
 * kinds are intentionally out of v1 scope (OQ-5). Defined here alongside the
 * script taxonomy per §2.1 so the whole context vocabulary lives in one module.
 */
export const CapabilityContextKindSchema = z.enum([
  "healthcheck", // strategies + collectors
  "automation", // triggers + actions + artifact types
]);
export type CapabilityContextKind = z.infer<typeof CapabilityContextKindSchema>;

// ───────────────────────── ai.getScriptContext (§2.2) ─────────────────────

export const GetScriptContextInputSchema = z.object({
  context: ScriptContextKindSchema,
});
export type GetScriptContextInput = z.infer<typeof GetScriptContextInputSchema>;

/** A single injected `CHECKSTACK_*` env var the shell runner exposes. */
export const ShellEnvVarSchema = z.object({
  name: z.string(),
  description: z.string(),
});
export type ShellEnvVar = z.infer<typeof ShellEnvVarSchema>;

export const GetScriptContextOutputSchema = z.object({
  context: ScriptContextKindSchema,
  /** Editor language for this context. */
  language: z.enum(["typescript", "shell"]),
  /** The SDK module the script imports from (TS contexts only). */
  sdkModule: z.string().optional(),
  /** The define-helper name (TS contexts only). */
  helper: z.string().optional(),
  /**
   * The relevant `.d.ts` declarations for THIS context, extracted from the
   * generated SDK editor bundle (the SAME types Monaco mounts). For a TS
   * context this is the context's `declare module` block; for a shell context
   * it is a human-readable list of the injected `CHECKSTACK_*` env vars.
   */
  declarations: z.string(),
  /** Injected shell env vars (shell contexts only). */
  shellEnv: z.array(ShellEnvVarSchema).optional(),
  /** A minimal runnable starter the model can adapt. */
  starterExample: z.string(),
  /** Whether managed npm packages are importable in this context. */
  allowsManagedPackages: z.boolean(),
});
export type GetScriptContextOutput = z.infer<
  typeof GetScriptContextOutputSchema
>;

// ───────────────────────── ai.testScript (§2.3) ───────────────────────────

export const TestScriptInputSchema = z.object({
  context: ScriptContextKindSchema,
  source: z.string().min(1).max(100_000),
  /** Collector/action config the script reads via context.config / fields. */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Sample runtime context (check/system/environment, or event/subscription). */
  sampleContext: z.record(z.string(), z.unknown()).optional(),
  /** Shell-only: extra env. Never carries real secrets (placeholders only). */
  env: z.record(z.string(), z.string()).optional(),
  /** Bounded; defaults to a short ceiling well under the runner's max. */
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
});
export type TestScriptInput = z.infer<typeof TestScriptInputSchema>;

export const TestScriptOutputSchema = z.object({
  /** The default-export / return value the script produced (masked). */
  result: z.unknown().optional(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  error: z.string().optional(),
  /** What the sandbox actually enforced/degraded (surfaced, never silent). */
  sandboxDowngraded: z.boolean(),
});
export type TestScriptOutput = z.infer<typeof TestScriptOutputSchema>;

// ───────────────────────── ai.listCapabilities (§2.4) ──────────────────────

/** The normalized role of a single catalog entry across both registries. */
export const CapabilityRoleSchema = z.enum([
  "strategy",
  "collector",
  "trigger",
  "action",
  "artifact-type",
]);
export type CapabilityRole = z.infer<typeof CapabilityRoleSchema>;

/**
 * A COMPACT description of one config field, derived from the entry's full
 * JSON Schema. This is what `listCapabilities` returns per entry so the broad
 * catalog stays small; the model pulls the FULL schema for a single kind via
 * `getCapabilitySchema` only when it is actually configuring that kind.
 */
export const CapabilityFieldSummarySchema = z.object({
  name: z.string(),
  /** A short type label derived from the JSON Schema (e.g. "string", "enum"). */
  type: z.string(),
  required: z.boolean(),
});
export type CapabilityFieldSummary = z.infer<
  typeof CapabilityFieldSummarySchema
>;

/** A catalog entry, normalized across both registries. */
export const CapabilityEntrySchema = z.object({
  /** Fully-qualified id (e.g. "healthcheck-http.http", "incident.created"). */
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  role: CapabilityRoleSchema,
  category: z.string().optional(),
  /**
   * A compact, size-gated summary of the config fields (names + types +
   * required). Omitted when the entry's schema has no derivable object fields.
   */
  configSummary: z.array(CapabilityFieldSummarySchema).optional(),
});
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

export const ListCapabilitiesInputSchema = z.object({
  context: CapabilityContextKindSchema,
});
export type ListCapabilitiesInput = z.infer<typeof ListCapabilitiesInputSchema>;

export const ListCapabilitiesOutputSchema = z.object({
  context: CapabilityContextKindSchema,
  entries: z.array(CapabilityEntrySchema),
  /**
   * True when per-entry `configSummary` was dropped to fit the context budget
   * (the catalog had more than the entry cap). Identity/role data is always
   * returned; the model then pulls a single kind's full schema on demand.
   */
  truncated: z.boolean(),
});
export type ListCapabilitiesOutput = z.infer<
  typeof ListCapabilitiesOutputSchema
>;

export const GetCapabilitySchemaInputSchema = z.object({
  context: CapabilityContextKindSchema,
  /** The fully-qualified kind id from a `listCapabilities` entry. */
  kind: z.string().min(1),
});
export type GetCapabilitySchemaInput = z.infer<
  typeof GetCapabilitySchemaInputSchema
>;

export const GetCapabilitySchemaOutputSchema = z.object({
  context: CapabilityContextKindSchema,
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  role: CapabilityRoleSchema,
  /**
   * The FULL config JSON Schema for this one kind - the same schema that powers
   * the UI config form, returned intact (field shapes, types, required, enums).
   */
  configSchema: z.record(z.string(), z.unknown()),
  /**
   * Health-check COLLECTORS only: the result JSON Schema whose top-level fields
   * are the ASSERTABLE fields. Author an assertion's `field` from these (e.g.
   * `statusCode`), not a guessed name. Omitted for non-collector kinds.
   */
  resultSchema: z.record(z.string(), z.unknown()).optional(),
  /**
   * Health-check COLLECTORS only: the valid assertion operators per JSON type
   * (and `jsonpath`). An assertion's `operator` MUST be one of these full words
   * (e.g. `equals`, `greaterThanOrEqual`), never an abbreviation like `eq`.
   */
  assertionOperators: z.record(z.string(), z.array(z.string())).optional(),
  /**
   * Automation ACTIONS only: the access rules the automation's `runAs` service
   * account must hold for this action to execute (e.g.
   * `integration-jira.create_issue.manage`). Match these against a service
   * account's `accessRules` (from `automation.listServiceAccounts`) to choose a
   * `runAs` that can actually run the automation. Omitted/empty when the action
   * needs no special grant.
   */
  requiredAccessRules: z.array(z.string()).optional(),
});
export type GetCapabilitySchemaOutput = z.infer<
  typeof GetCapabilitySchemaOutputSchema
>;
