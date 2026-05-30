/**
 * Script-plugin automation actions.
 *
 * Two distinct actions, intentionally kept apart because the editor,
 * runtime, security boundary, and result shape all differ:
 *
 *   - `run_shell` — bash via `defaultShellScriptRunner` (`sh -c`).
 *     Operator authors a shell script in the Monaco shell editor.
 *     Produces `shell.result` (`{ exitCode, stdout, stderr, ... }`).
 *
 *   - `run_script` — TypeScript/JavaScript via `defaultEsmScriptRunner`
 *     (a fresh Bun subprocess with a curated env). Operator authors an
 *     ES module in the Monaco TS editor; the default export receives a
 *     `context` with the trigger payload and returns `{ id }` (or
 *     anything JSON-serialisable). Produces `script.result`
 *     (`{ result, stdout, stderr, ... }`).
 *
 * Replaces the legacy `shellProvider.deliver` / `scriptProvider.deliver`.
 * Templates inside `config.script` are expanded by the dispatch engine
 * before `execute` runs.
 */
import { z } from "zod";
import {
  configNumber,
  configString,
  defaultEsmScriptRunner,
  defaultShellScriptRunner,
  requestTimeoutMs,
  Versioned,
  type EsmScriptRunner,
  type ShellScriptRunner,
} from "@checkstack/backend-api";
import type {
  ActionDefinition,
  ActionRunScope,
} from "@checkstack/automation-backend";
import type { ResolutionRootStatus } from "@checkstack/script-packages-backend";
import { extractErrorMessage, SYSTEM_ACTOR } from "@checkstack/common";
import { maskSecrets, maskSecretsDeep } from "@checkstack/secrets-common";
import { flattenScopeToShellEnv } from "./script-env";

/**
 * Run-scoped secret values to redact from a run's output (Jenkins-style
 * leak masking). Phase 1 supplies an empty set (no run-scoped secret
 * injection yet); Phase 2 wires the resolved per-run allowlist here. With
 * no values these helpers are no-ops, but the masking SEAM is in place at
 * every output boundary now.
 */
export interface ScriptMaskingDeps {
  /** Resolve the run-scoped secret values for masking this run's output. */
  getMaskValues?: () => Promise<Iterable<string>>;
}

function maskText(text: string, values: string[]): string {
  if (values.length === 0) return text;
  return maskSecrets({ text, values });
}

function maskUnknown(value: unknown, values: string[]): unknown {
  if (values.length === 0) return value;
  return maskSecretsDeep({ value, values });
}

/**
 * Fallback scope for the (test-only) case where `execute` is invoked
 * without one. At run time the dispatch engine always supplies a real
 * scope.
 */
const EMPTY_SCOPE: ActionRunScope = {
  trigger: { id: "", event: "", actor: SYSTEM_ACTOR, payload: {} },
  artifacts: {},
  vars: {},
};

// ─── Shell action ──────────────────────────────────────────────────────────

const shellRunConfigSchema = z.object({
  script: configString({
    "x-editor-types": ["shell"],
    "x-script-testable": true,
  }).describe("Bash script to execute"),
  env: z
    .record(z.string(), configString({}))
    .optional()
    .describe(
      "Extra environment variables — keys must be uppercase shell-safe identifiers.",
    ),
  workingDirectory: z
    .string()
    .optional()
    .describe("Working directory for script execution"),
  timeout: configNumber({})
    .min(1000)
    .max(300_000)
    .default(30_000)
    .describe("Maximum execution time in milliseconds"),
});

export type ShellRunConfig = z.infer<typeof shellRunConfigSchema>;

const shellResultDataSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
  timedOut: z.boolean(),
});

export type ShellResultArtifact = z.infer<typeof shellResultDataSchema>;

export const shellResultArtifactType = {
  id: "shell_result",
  displayName: "Shell Script Result",
  description: "Exit code + stdout + stderr from a `sh -c` run",
  schema: shellResultDataSchema,
} as const;

export interface ShellActionDeps extends ScriptMaskingDeps {
  /**
   * Shell runner. Defaults to `defaultShellScriptRunner`; tests inject
   * a mock so the action can be exercised without spawning a real `sh`
   * subprocess.
   */
  runner?: ShellScriptRunner;
}

export function createShellRunAction(
  deps: ShellActionDeps = {},
): ActionDefinition<ShellRunConfig, ShellResultArtifact> {
  const runner = deps.runner ?? defaultShellScriptRunner;
  return {
    id: "run_shell",
    displayName: "Run Shell Script",
    description: "Execute a bash script and capture its output",
    category: "Script",
    icon: "Terminal",
    config: new Versioned({
      version: 1,
      schema: shellRunConfigSchema,
    }),
    produces: "shell_result",
    execute: async ({ config, logger, scope = EMPTY_SCOPE }) => {
      const startedAt = Date.now();
      // Run-scoped masking values (empty in Phase 1).
      const maskValues = [...((await deps.getMaskValues?.()) ?? [])];
      try {
        const raw = await runner.run({
          script: config.script,
          // Run context is exposed as `$CHECKSTACK_*` env vars (not
          // `{{ }}` templates). The operator's own `config.env` wins on
          // any name collision.
          env: { ...flattenScopeToShellEnv(scope), ...config.env },
          cwd: config.workingDirectory,
          timeoutMs: config.timeout,
        });
        // Mask captured output at the boundary before logging / persisting.
        const result = {
          ...raw,
          stdout: maskText(raw.stdout, maskValues),
          stderr: maskText(raw.stderr, maskValues),
        };
        const durationMs = Date.now() - startedAt;

        if (result.timedOut) {
          logger.error("Shell script execution timed out");
          return {
            success: false,
            error: "Shell script execution timed out",
            artifact: {
              exitCode: -1,
              stdout: result.stdout,
              stderr: result.stderr,
              durationMs,
              timedOut: true,
            },
          };
        }

        if (result.exitCode !== 0) {
          const errSnippet = (result.stderr || result.stdout).slice(0, 500);
          logger.error(
            `Shell script exited with ${result.exitCode}: ${errSnippet}`,
          );
          return {
            success: false,
            error: `Shell script exited with code ${result.exitCode}: ${errSnippet}`,
            artifact: {
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              durationMs,
              timedOut: false,
            },
          };
        }

        const firstLine = result.stdout.split("\n")[0]?.slice(0, 100);
        logger.debug(
          `Shell script ran successfully (${durationMs}ms): ${firstLine ?? ""}`,
        );
        return {
          success: true,
          externalId: firstLine || undefined,
          artifact: {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs,
            timedOut: false,
          },
        };
      } catch (error) {
        const message = extractErrorMessage(error);
        logger.error(`Shell script execution failed: ${message}`);
        return {
          success: false,
          error: `Execution error: ${message}`,
        };
      }
    },
  };
}

export const shellRunAction = createShellRunAction();

// ─── ESM-script action ─────────────────────────────────────────────────────

const scriptRunConfigSchema = z.object({
  script: configString({
    "x-editor-types": ["typescript"],
    "x-script-testable": true,
  }).describe(
    "TypeScript/JavaScript module to execute. Default-export an async function that receives `context` and returns a JSON-serialisable value (e.g. `{ id }`). The Monaco editor for this field consumes `generateAutomationContextTypes` from `@checkstack/automation-frontend` so `context.trigger.payload` is typed as a discriminated union over the automation's subscribed triggers.",
  ),
  timeout: requestTimeoutMs().describe("Maximum execution time in milliseconds"),
});

export type ScriptRunConfig = z.infer<typeof scriptRunConfigSchema>;

const scriptResultDataSchema = z.object({
  result: z.unknown().optional(),
  externalId: z.string().optional(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
  timedOut: z.boolean(),
});

export type ScriptResultArtifact = z.infer<typeof scriptResultDataSchema>;

export const scriptResultArtifactType = {
  id: "script_result",
  displayName: "Script Result",
  description:
    "Return value + stdout + stderr from a Bun-subprocess ESM script run",
  schema: scriptResultDataSchema,
} as const;

/**
 * Context object exposed to user scripts as `globalThis.context`. Kept
 * small and stable — anything beyond `trigger` and `automation` should
 * be reached via `fetch` / standard library, not piped in here.
 *
 * At runtime `trigger.payload` is `Record<string, unknown>` because the
 * runner can't know ahead of time which trigger schema applies; the
 * **editor**, however, narrows it. The Monaco editor for the `script`
 * field calls `generateAutomationContextTypes` from
 * `@checkstack/automation-frontend`, which inspects the automation's
 * subscribed triggers and emits a discriminated-union declaration for
 * `context.trigger` — so the operator gets autocomplete for the right
 * payload shape inside the editor while the runtime stays schema-free.
 */
export interface ScriptContext {
  /** The trigger event that started this automation run. */
  trigger: {
    /** Fully qualified trigger event id (e.g. `incident.created`). */
    event: string;
    /**
     * Trigger payload — exactly as the trigger emitted it.
     *
     * Runtime type is `Record<string, unknown>`; the editor type is
     * generated per-automation from the subscribed triggers' payload
     * schemas.
     */
    payload: Record<string, unknown>;
  };
  /**
   * Artifacts produced by upstream actions in this run, keyed by artifact
   * type (`jira.issue`) and by producing-action id. Runtime type is
   * `Record<string, unknown>`; the editor narrows it from the upstream
   * actions' `produces`.
   */
  artifacts: Record<string, unknown>;
  /** Variables declared upstream via `variables` actions. */
  var: Record<string, unknown>;
  /**
   * Present only when this action runs inside a `repeat` block: the
   * current iteration index and (for `for_each`) the current item.
   */
  repeat?: { index: number; item?: unknown };
  /** Identity of the automation run, useful for log correlation. */
  automation: {
    runId: string;
    automationId: string;
    contextKey: string | null;
  };
}

function extractExternalId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const candidate = obj.id ?? obj.externalId;
  if (typeof candidate === "string") return candidate;
  if (typeof candidate === "number") return String(candidate);
  return;
}

export interface ScriptActionDeps extends ScriptMaskingDeps {
  /**
   * ESM script runner. Defaults to `defaultEsmScriptRunner`; tests
   * inject a mock so the action can be exercised without spawning a
   * real Bun subprocess.
   */
  runner?: EsmScriptRunner;
  /**
   * Resolves the managed npm-package resolution root for THIS run. Wired by
   * the plugin (which has DB access). When omitted, no package resolution
   * is attempted (today's behavior). `notReady` fails the run with a clear
   * error instead of running against a stale / empty tree.
   */
  getResolutionRoot?: () => Promise<ResolutionRootStatus>;
}

export function createScriptRunAction(
  deps: ScriptActionDeps = {},
): ActionDefinition<ScriptRunConfig, ScriptResultArtifact> {
  const runner = deps.runner ?? defaultEsmScriptRunner;
  return {
    id: "run_script",
    displayName: "Run Script (TypeScript)",
    description:
      "Execute a TypeScript/JavaScript module in a sandboxed Bun subprocess",
    category: "Script",
    icon: "Code",
    config: new Versioned({
      version: 1,
      schema: scriptRunConfigSchema,
    }),
    produces: "script_result",
    execute: async ({
      config,
      logger,
      runId,
      automationId,
      contextKey,
      scope = EMPTY_SCOPE,
    }) => {
      const startedAt = Date.now();
      const scriptContext: ScriptContext = {
        trigger: scope.trigger,
        artifacts: scope.artifacts,
        var: scope.vars,
        ...(scope.repeat ? { repeat: scope.repeat } : {}),
        automation: { runId, automationId, contextKey },
      };
      // Resolve the managed npm-package root for this run. `none` -> unset
      // (no packages configured); `notReady` -> fail clearly (syncing);
      // `ready` -> point the runner at the materialized tree.
      const rootStatus = await deps.getResolutionRoot?.();
      if (rootStatus?.mode === "notReady") {
        logger.error(rootStatus.reason);
        return { success: false, error: rootStatus.reason };
      }
      const resolutionRoot =
        rootStatus?.mode === "ready" ? rootStatus.root : undefined;
      // Run-scoped masking values (empty in Phase 1).
      const maskValues = [...((await deps.getMaskValues?.()) ?? [])];
      try {
        const raw = await runner.run({
          script: config.script,
          context: scriptContext,
          timeoutMs: config.timeout,
          helperModuleName: "@checkstack/integration",
          helperFunctionName: "defineIntegration",
          ...(resolutionRoot ? { resolutionRoot } : {}),
        });
        // Mask captured output at the boundary (stdout/stderr go to logs,
        // result + stdout/stderr to the persisted artifact). A script that
        // echoes a secret it was given is redacted here too.
        const execResult = {
          ...raw,
          stdout: maskText(raw.stdout, maskValues),
          stderr: maskText(raw.stderr, maskValues),
          ...(raw.error === undefined
            ? {}
            : { error: maskText(raw.error, maskValues) }),
          ...(raw.result === undefined
            ? {}
            : { result: maskUnknown(raw.result, maskValues) }),
        };
        const durationMs = Date.now() - startedAt;

        if (execResult.stdout.length > 0) {
          for (const line of execResult.stdout.split("\n")) {
            if (line.length > 0) logger.debug(`Script log: ${line}`);
          }
        }
        if (execResult.stderr.length > 0) {
          for (const line of execResult.stderr.split("\n")) {
            if (line.length > 0) logger.error(`Script stderr: ${line}`);
          }
        }

        if (execResult.timedOut) {
          logger.error("Script execution timed out");
          return {
            success: false,
            error: "Script execution timed out",
            artifact: {
              stdout: execResult.stdout,
              stderr: execResult.stderr,
              durationMs,
              timedOut: true,
            },
          };
        }

        if (execResult.error !== undefined) {
          logger.error(`Script execution failed: ${execResult.error}`);
          return {
            success: false,
            error: `Script error: ${execResult.error}`,
            artifact: {
              stdout: execResult.stdout,
              stderr: execResult.stderr,
              durationMs,
              timedOut: false,
            },
          };
        }

        const externalId = extractExternalId(execResult.result);
        logger.debug(
          `Script executed successfully (${durationMs}ms)${externalId ? `: id=${externalId}` : ""}`,
        );
        return {
          success: true,
          externalId,
          artifact: {
            result: execResult.result,
            externalId,
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            durationMs,
            timedOut: false,
          },
        };
      } catch (error) {
        const message = extractErrorMessage(error);
        logger.error(`Script execution failed: ${message}`);
        return {
          success: false,
          error: `Execution error: ${message}`,
        };
      }
    },
  };
}

export const scriptRunAction = createScriptRunAction();
