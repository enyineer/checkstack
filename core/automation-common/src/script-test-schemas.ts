import { z } from "zod";

/**
 * Wire schemas for the in-UI script test endpoint (`testScript`).
 *
 * The editable sample context mirrors what a `run_script` action sees as
 * `globalThis.context` and what `run_shell` flattens into `$CHECKSTACK_*`
 * env vars. Every field is optional so a partial sample still runs.
 */

export const ScriptTestKindSchema = z.enum(["typescript", "shell"]);
export type ScriptTestKind = z.infer<typeof ScriptTestKindSchema>;

export const ScriptTestContextSchema = z.object({
  trigger: z
    .object({
      event: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  artifacts: z.record(z.string(), z.unknown()).optional(),
  var: z.record(z.string(), z.unknown()).optional(),
  repeat: z
    .object({
      index: z.number().int(),
      item: z.unknown().optional(),
    })
    .optional(),
});
export type ScriptTestContext = z.infer<typeof ScriptTestContextSchema>;

export const ScriptTestInputSchema = z.object({
  kind: ScriptTestKindSchema,
  script: z.string(),
  context: ScriptTestContextSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  /**
   * The script's declared secret -> env mapping
   * (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The test panel NEVER resolves
   * real secret values: for each entry it injects a named placeholder
   * (`__SECRET_<NAME>__`) by default, or the user's override value (see
   * `secretOverrides`) for a realistic run. Real production values never
   * reach the test surface (decision 4).
   */
  secretEnv: z.record(z.string(), z.string()).optional(),
  /**
   * User-supplied per-secret-NAME override values for a realistic test
   * (keyed by the `${{ secrets.NAME }}` name, not the env var). These stay
   * client-side until sent here as an explicit test input, and are masked
   * out of the test result so even an override can't round-trip unmasked.
   */
  secretOverrides: z.record(z.string(), z.string()).optional(),
  workingDirectory: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
});
export type ScriptTestInputDto = z.infer<typeof ScriptTestInputSchema>;

export const ScriptTestResultSchema = z.object({
  result: z.unknown().optional(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  error: z.string().optional(),
});
export type ScriptTestResultDto = z.infer<typeof ScriptTestResultSchema>;

/**
 * Input for `getRunScopeForReplay`: reconstruct a test context from a real
 * automation run so an operator can debug an action against the data that
 * run saw. `actionPath` is accepted for forward-compatibility (scoping
 * artifacts to those available before that action); v1 returns the full
 * run scope.
 */
export const ReplayScopeInputSchema = z.object({
  runId: z.string(),
  // Owning automation id — used to authorize the read (parentScope) and to scope
  // the run fetch so a run id cannot be paired with a foreign automation.
  automationId: z.string(),
  actionPath: z.string().optional(),
});
export type ReplayScopeInputDto = z.infer<typeof ReplayScopeInputSchema>;

export const ReplayScopeResultSchema = z.object({
  context: ScriptTestContextSchema,
  /**
   * False when `var` / `repeat` could not be recovered because the run's
   * durable scope snapshot was already cleared (terminal status). The
   * trigger + artifacts are still reconstructed; the UI can note the gap.
   */
  scopeSnapshotAvailable: z.boolean(),
});
export type ReplayScopeResultDto = z.infer<typeof ReplayScopeResultSchema>;
