import type {
  ScriptContextKind,
  ShellEnvVar,
} from "@checkstack/ai-common";

/**
 * Pure extraction of per-context SDK symbols from the generated editor bundle
 * (§3.1). The single source of truth for script SDK symbols is the GENERATED
 * `SDK_EDITOR_BUNDLE_DTS` string (`@checkstack/sdk/editor-bundle`) - the SAME
 * text Monaco mounts. This module pulls the `declare module "<name>" { ... }`
 * block for a context out of that string by region extraction (no TypeScript
 * compiler dependency), so it cannot drift from the editor (both derive from
 * the one generated bundle).
 *
 * For shell contexts there is no SDK module: the "symbols" are the reserved
 * `CHECKSTACK_*` env vars the runner injects, shipped here as a static
 * descriptor table guarded by a drift test (§3.1 / OQ-2).
 */

/** Per-context static descriptor that drives extraction + tool output. */
export interface ScriptContextDescriptor {
  context: ScriptContextKind;
  language: "typescript" | "shell";
  /** SDK module the script imports from (TS contexts only). */
  sdkModule?: string;
  /** The define-helper name (TS contexts only). */
  helper?: string;
  /** Whether managed npm packages are importable. */
  allowsManagedPackages: boolean;
}

export const SCRIPT_CONTEXT_DESCRIPTORS: Readonly<
  Record<ScriptContextKind, ScriptContextDescriptor>
> = {
  "healthcheck-script": {
    context: "healthcheck-script",
    language: "typescript",
    sdkModule: "@checkstack/sdk/healthcheck",
    helper: "defineHealthCheck",
    allowsManagedPackages: true,
  },
  "automation-action-script": {
    context: "automation-action-script",
    language: "typescript",
    sdkModule: "@checkstack/sdk/integration",
    helper: "defineIntegration",
    allowsManagedPackages: true,
  },
  "healthcheck-shell": {
    context: "healthcheck-shell",
    language: "shell",
    allowsManagedPackages: false,
  },
  "automation-action-shell": {
    context: "automation-action-shell",
    language: "shell",
    allowsManagedPackages: false,
  },
};

/**
 * Reserved `CHECKSTACK_*` env vars the shell health-check collector exposes.
 * Hand-maintained here (cross-plugin import is deliberately avoided by the
 * codebase) and guarded by `shell-env-table.test.ts`, which asserts these match
 * `buildShellRunContextEnv`'s output for a representative sample (OQ-2).
 */
export const HEALTHCHECK_SHELL_ENV: readonly ShellEnvVar[] = [
  {
    name: "CHECKSTACK_CHECK_ID",
    description: "The health check configuration id.",
  },
  {
    name: "CHECKSTACK_CHECK_NAME",
    description: "The health check's display name (falls back to the id).",
  },
  {
    name: "CHECKSTACK_CHECK_INTERVAL_SECONDS",
    description: "The configured run interval, in seconds.",
  },
  { name: "CHECKSTACK_SYSTEM_ID", description: "The system id." },
  {
    name: "CHECKSTACK_SYSTEM_NAME",
    description: "The system's display name (falls back to the id).",
  },
  { name: "CHECKSTACK_ENV_ID", description: "The resolved environment id." },
  {
    name: "CHECKSTACK_ENV_NAME",
    description: "The resolved environment's display name.",
  },
  {
    name: "CHECKSTACK_ENV_<FIELD>",
    description:
      "One var per environment custom-field: the field key uppercased with non-alphanumeric runs collapsed to '_' (e.g. region -> CHECKSTACK_ENV_REGION).",
  },
];

/**
 * Reserved `CHECKSTACK_*` env vars a `run_shell` automation action exposes.
 * The runner flattens the trigger event + scope into `CHECKSTACK_*` vars.
 */
export const AUTOMATION_SHELL_ENV: readonly ShellEnvVar[] = [
  {
    name: "CHECKSTACK_EVENT_ID",
    description: 'Fully-qualified event id, e.g. "incident.created".',
  },
  {
    name: "CHECKSTACK_EVENT_PAYLOAD",
    description: "The triggering event payload as a JSON string.",
  },
  {
    name: "CHECKSTACK_TRIGGER_EVENT",
    description: "The event id that triggered this run.",
  },
];

const SHELL_ENV_BY_CONTEXT: Partial<
  Record<ScriptContextKind, readonly ShellEnvVar[]>
> = {
  "healthcheck-shell": HEALTHCHECK_SHELL_ENV,
  "automation-action-shell": AUTOMATION_SHELL_ENV,
};

/** Thrown for an unknown context or a missing `declare module` block. */
export class ScriptContextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptContextExtractionError";
  }
}

/**
 * Extract the `declare module "<moduleName>" { ... }` block from the bundle
 * text by brace matching. Pure: no compiler, no I/O. Returns the full block
 * (including the `declare module` header and the matching closing brace).
 */
export function extractDeclareModuleBlock({
  bundle,
  moduleName,
}: {
  bundle: string;
  moduleName: string;
}): string {
  const header = `declare module "${moduleName}"`;
  const headerIndex = bundle.indexOf(header);
  if (headerIndex === -1) {
    throw new ScriptContextExtractionError(
      String.raw`SDK editor bundle has no "declare module \"${moduleName}\"" block.`,
    );
  }
  const openBrace = bundle.indexOf("{", headerIndex);
  if (openBrace === -1) {
    throw new ScriptContextExtractionError(
      String.raw`Malformed "declare module \"${moduleName}\"" block: no opening brace.`,
    );
  }
  let depth = 0;
  for (let i = openBrace; i < bundle.length; i++) {
    const ch = bundle[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return bundle.slice(headerIndex, i + 1);
      }
    }
  }
  throw new ScriptContextExtractionError(
    String.raw`Malformed "declare module \"${moduleName}\"" block: unbalanced braces.`,
  );
}

/** Render the shell env table into a readable declarations string. */
export function renderShellEnvDeclarations(
  envVars: readonly ShellEnvVar[],
): string {
  return envVars
    .map((v) => `# ${v.name}\n#   ${v.description}`)
    .join("\n");
}

/** A minimal runnable starter the model can adapt, per context. */
export function buildStarterExample(context: ScriptContextKind): string {
  switch (context) {
    case "healthcheck-script": {
      return [
        'import { defineHealthCheck } from "@checkstack/sdk/healthcheck";',
        "",
        "export default defineHealthCheck(async (ctx) => {",
        "  const res = await fetch(String(ctx.config.url));",
        "  return { success: res.ok, message: `HTTP ${res.status}` };",
        "});",
      ].join("\n");
    }
    case "automation-action-script": {
      return [
        'import { defineIntegration } from "@checkstack/sdk/integration";',
        "",
        "export default defineIntegration(async (ctx) => {",
        "  console.log(`event ${ctx.event.eventId}`);",
        "  return { id: ctx.event.deliveryId };",
        "});",
      ].join("\n");
    }
    case "healthcheck-shell": {
      return [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'echo "checking system $CHECKSTACK_SYSTEM_NAME"',
        "curl -fsS https://example.com/health",
      ].join("\n");
    }
    case "automation-action-shell": {
      return [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'echo "handling event $CHECKSTACK_EVENT_ID"',
      ].join("\n");
    }
  }
}

/** Result of resolving a context's SDK symbols / declarations. */
export interface ResolvedScriptContext {
  context: ScriptContextKind;
  language: "typescript" | "shell";
  sdkModule?: string;
  helper?: string;
  declarations: string;
  shellEnv?: readonly ShellEnvVar[];
  starterExample: string;
  allowsManagedPackages: boolean;
}

/**
 * Resolve the SDK symbols / imports / type signatures for a script context by
 * PURE extraction from the generated SDK editor bundle. For TS contexts the
 * `declarations` is the matching `declare module` block; for shell contexts it
 * is the rendered `CHECKSTACK_*` env table.
 */
export function resolveScriptContext({
  context,
  bundle,
}: {
  context: ScriptContextKind;
  bundle: string;
}): ResolvedScriptContext {
  const descriptor = SCRIPT_CONTEXT_DESCRIPTORS[context];
  if (!descriptor) {
    throw new ScriptContextExtractionError(`Unknown script context: ${context}`);
  }

  if (descriptor.language === "shell") {
    const shellEnv = SHELL_ENV_BY_CONTEXT[context] ?? [];
    return {
      context,
      language: "shell",
      declarations: renderShellEnvDeclarations(shellEnv),
      shellEnv,
      starterExample: buildStarterExample(context),
      allowsManagedPackages: descriptor.allowsManagedPackages,
    };
  }

  // TS context: pull the matching declare-module block from the generated bundle.
  if (!descriptor.sdkModule) {
    throw new ScriptContextExtractionError(
      `Context ${context} is TypeScript but has no SDK module configured.`,
    );
  }
  const declarations = extractDeclareModuleBlock({
    bundle,
    moduleName: descriptor.sdkModule,
  });
  return {
    context,
    language: "typescript",
    sdkModule: descriptor.sdkModule,
    helper: descriptor.helper,
    declarations,
    starterExample: buildStarterExample(context),
    allowsManagedPackages: descriptor.allowsManagedPackages,
  };
}
