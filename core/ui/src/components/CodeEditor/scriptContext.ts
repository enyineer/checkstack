import type { JsonSchemaProperty } from "../DynamicForm/types";
import type { EditorStarterTemplates, ShellEnvVar } from "../DynamicForm/types";
import { jsonSchemaToTypeScript } from "./generateTypeDefinitions";

/**
 * Build a complete IntelliSense + starter-template + shell-env-var bundle
 * for the script editor surfaces in checkstack. There are four:
 *
 *  - `healthcheckInlineContext` — inline TS/JS health checks.
 *    `context.config` is typed from the collector's own config schema.
 *    The `@checkstack/sdk/healthcheck` module (resolved from the injected
 *    @checkstack/sdk editor bundle) exposes the required return shape so
 *    users get a type _error_ when the shape is wrong.
 *
 *  - `healthcheckShellContext` — shell health checks. The satellite injects
 *    run-context vars (`CHECKSTACK_CHECK_*`, `CHECKSTACK_SYSTEM_*`) and, when
 *    the run resolved an environment, `CHECKSTACK_ENV_ID` / `CHECKSTACK_ENV_NAME`
 *    plus one `CHECKSTACK_ENV_<FIELD>` per custom field. We surface those, the
 *    safe-vars whitelist (`PATH`, `HOME`, ...) and any user-defined `env` vars
 *    passed in the call. The per-field `CHECKSTACK_ENV_<FIELD>` names are NOT
 *    enumerated here: a check is authored independently of the 0..n systems it
 *    targets, so the concrete environments (and their field keys) aren't known
 *    at edit time.
 *
 *  - `integrationInlineContext` — TS/JS integration scripts.
 *    `context.event.payload` is typed from the event's payload schema.
 *    The `@checkstack/sdk/integration` module (resolved from the injected
 *    @checkstack/sdk editor bundle) exposes the result shape.
 *
 *  - `integrationShellContext` — shell integration scripts. The platform
 *    injects `EVENT_ID`, `DELIVERY_ID`, `SUBSCRIPTION_ID`,
 *    `SUBSCRIPTION_NAME` plus `PAYLOAD_*` flattened from the payload.
 *
 * The shape that comes back is what `DynamicForm`/`MultiTypeEditorField`/
 * `CodeEditor` consume directly:
 *
 *  ```ts
 *  const ctx = healthcheckInlineContext({ collectorConfigSchema });
 *  <DynamicForm
 *    schema={collector.configSchema}
 *    typeDefinitions={ctx.typeDefinitions}
 *    starterTemplates={ctx.starterTemplates}
 *    shellEnvVars={ctx.shellEnvVars}
 *  />
 *  ```
 *
 * Splitting it into four exported builders (rather than one mega-function)
 * keeps the call sites readable: each builder takes only the schemas the
 * editor will actually use.
 */

export interface ScriptEditorContext {
  /** TypeScript declarations injected into Monaco for ts/js editors. */
  typeDefinitions: string;
  /** Starter templates per editor language. */
  starterTemplates: EditorStarterTemplates;
  /** Shell env vars surfaced via Monaco's `$` completion provider. */
  shellEnvVars: ShellEnvVar[];
}

// ─────────────────────────────────────────────────────────────────────────
// Virtual ambient modules — these make `import type { ... } from "..."`
// resolve in the editor and let us declare a typed return contract for
// inline scripts. They're _virtual_ in the sense that the runtime doesn't
// ship them (the result type is enforced at the data-coercion layer), but
// for the user's IDE experience they behave like a real package.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the healthcheck virtual-module declarations including a
 * properly-typed `HealthCheckScriptContext` whose `config` matches the
 * caller's collector schema (or `Record<string, unknown>` as a generic
 * fallback when no schema is supplied).
 *
 * Both the `defineHealthCheck(ctx => ...)` function-argument and the
 * ambient `declare const context` reference the same generated type so
 * users get accurate autocomplete from either entry point.
 */
function buildHealthCheckTypes(configType: string): string {
  return `
/** Result emitted by an inline health-check script. */
interface HealthCheckScriptResult {
  /** Whether the health check passed. */
  success: boolean;
  /** Optional status message — surfaces in the run detail. */
  message?: string;
  /** Optional numeric value — feeds the value chart + anomaly detection. */
  value?: number;
}

/**
 * Runtime context exposed to inline health-check scripts. \`config\` is
 * typed from the collector's own JSON Schema, so the fields you've
 * declared on the configuration are autocompletable inside the script.
 */
interface HealthCheckScriptContext {
  /** Strongly-typed collector configuration. */
  readonly config: ${configType};
  /** Metadata about the health check this run is for. */
  readonly check: {
    /** The health check configuration id. */
    readonly id: string;
    /** The health check's display name (falls back to the id). */
    readonly name: string;
    /** The configured run interval, in seconds. */
    readonly intervalSeconds: number;
  };
  /** Metadata about the system this check runs for. */
  readonly system: {
    /** The system id. */
    readonly id: string;
    /** The system's display name (falls back to the id). */
    readonly name: string;
  };
  /**
   * The environment this run resolved to, when the check fanned out into
   * one. \`undefined\` when the assignment opts out or the system has no
   * environments — always guard with \`context.environment?.…\`.
   */
  readonly environment?: {
    /** The environment id. */
    readonly id: string;
    /** The environment's display name (falls back to the id). */
    readonly name: string;
    /**
     * The environment's free-form custom metadata, with the original
     * (non-normalized) keys — so you read \`fields.baseUrl\` directly.
     * Values are arbitrary JSON (metadata only, never secrets); narrow
     * each before use, e.g. \`typeof fields.baseUrl === "string"\`.
     */
    readonly fields: Record<string, unknown>;
  };
}

/**
 * Helper that asserts the return shape of a health-check script at the
 * type level. Use either form:
 *
 *   export default defineHealthCheck({ success: true, value: 42 });
 *   export default defineHealthCheck(async (ctx) => ({ success: true }));
 *
 * The result is returned unchanged at runtime — the function only exists
 * for the editor's benefit, narrowing what \`export default\` is allowed
 * to be so mistakes are caught before the script ever runs.
 *
 * Available both as a global (this declaration) and as a named export
 * from \`@checkstack/sdk/healthcheck\`. The global form means the editor
 * can autocomplete it without the user typing the import first; the
 * named-export form (resolved from the injected @checkstack/sdk editor
 * bundle, not declared here) is for explicit, IDE-style imports.
 */
declare function defineHealthCheck<
  T extends
    | HealthCheckScriptResult
    | ((ctx: HealthCheckScriptContext) =>
        | HealthCheckScriptResult
        | Promise<HealthCheckScriptResult>),
>(value: T): T;

declare const context: HealthCheckScriptContext;
`;
}

/**
 * Build the integration virtual-module declarations with a typed
 * `IntegrationScriptContext.event.payload` (from the supplied event
 * schema, or `Record<string, unknown>` when none is given).
 *
 * Same dual-export pattern as healthcheck — global helpers + named
 * module exports — and the same shared context type powering both
 * `defineIntegration(ctx => ...)` and the ambient `declare const context`.
 */
function buildIntegrationTypes(payloadType: string): string {
  return `
/** Result emitted by an inline integration script. */
interface IntegrationScriptResult {
  /** External ID for tracking (e.g. ticket number, message ID). */
  id?: string;
  /** Same as \`id\` — accepted for backwards compatibility. */
  externalId?: string;
}

/**
 * Runtime context exposed to inline integration scripts. \`event.payload\`
 * is typed from the event's payload schema so the fields it advertises
 * are autocompletable inside the script.
 */
interface IntegrationScriptContext {
  /** The event being delivered. */
  readonly event: {
    /** Fully-qualified event ID, e.g. "incident.created". */
    readonly eventId: string;
    /** Strongly-typed event payload. */
    readonly payload: ${payloadType};
    /** ISO-8601 timestamp of when the event was emitted. */
    readonly timestamp: string;
    /** Unique ID for this delivery attempt. */
    readonly deliveryId: string;
  };
  /** Subscription that triggered this delivery. */
  readonly subscription: {
    readonly id: string;
    readonly name: string;
  };
}

/**
 * Helper that asserts the return shape of an integration script at the
 * type level. See \`defineHealthCheck\` for the analogous health-check
 * helper. Available both as a global and as a named export from
 * \`@checkstack/sdk/integration\` (resolved from the injected
 * @checkstack/sdk editor bundle, not declared here).
 */
declare function defineIntegration<
  T extends
    | IntegrationScriptResult
    | void
    | ((ctx: IntegrationScriptContext) =>
        | IntegrationScriptResult
        | void
        | Promise<IntegrationScriptResult | void>),
>(value: T): T;

declare const context: IntegrationScriptContext;
`;
}

// ─────────────────────────────────────────────────────────────────────────
// Starter templates
// ─────────────────────────────────────────────────────────────────────────

/**
 * Default inline TypeScript template — uses `defineHealthCheck` (a runtime
 * global) so the editor type-checks the return shape against
 * `HealthCheckScriptResult`. Includes a `node:os` import to demonstrate
 * that the Node stdlib is available and IntelliSensed.
 *
 * `defineHealthCheck` is available without an import (declared as an
 * ambient global in the editor's type defs and injected onto
 * `globalThis` by the runner). The named-import form
 * `import { defineHealthCheck } from "@checkstack/sdk/healthcheck"` also
 * works if users prefer it.
 */
const HEALTHCHECK_INLINE_TS_STARTER = `import { loadavg } from "node:os";

// Inline health checks run in a fresh Bun subprocess and have the full
// Node/Bun standard library available. \`context.config\` is typed from
// this collector's configuration schema — try autocompleting it below.

export default defineHealthCheck(() => {
  const load = loadavg()[0];
  return {
    success: load < 0.6,
    message: \`1m load average is \${load.toFixed(2)}\`,
    value: load,
  };
});
`;

/**
 * Default shell template for health checks. Uses `awk` + `if` to fail
 * when the 1-minute load average exceeds 0.60 — the exact pattern the
 * user originally tried but couldn't get working before the rewrite.
 *
 * Reads the load average via `uptime` rather than `/proc/loadavg` so the
 * starter runs out-of-the-box on macOS satellites too. The two `uptime`
 * formats differ:
 *
 *   Linux : `… load average: 0.00, 0.01, 0.05`
 *   macOS : `… load averages: 0.45 0.55 0.65`   (plural, no commas)
 *
 * `sed 's/.*load average[s]*: //'` strips the prefix on both;
 * `awk '{print $1}'` grabs the 1-minute value;
 * `tr -d ','` removes the trailing comma on Linux.
 */
const HEALTHCHECK_SHELL_STARTER = `#!/bin/sh
# Shell health checks run through \`sh -c\`, so pipes, redirects,
# command substitution, conditionals, etc. all work. Exit 0 = healthy,
# anything else = unhealthy. stdout/stderr are captured and shown on
# the run.

# 1-minute load average, portable across Linux + macOS.
load=$(uptime | sed 's/.*load average[s]*: //' | awk '{ print $1 }' | tr -d ',')

if awk -v l="$load" -v t=0.60 'BEGIN { exit (l+0 > t) ? 0 : 1 }'; then
  echo "Load too high: $load"
  exit 1
fi
echo "Load OK: $load"
`;

/**
 * Default inline TS template for integration scripts. Uses
 * `defineIntegration` (a runtime global) for the typed return contract
 * and demonstrates the `context.event` shape so the user sees what's
 * available.
 */
const INTEGRATION_INLINE_TS_STARTER = `// Integration scripts run when an event fires. \`context.event.payload\`
// is typed from this event's payload schema — try autocompleting it.
// \`defineIntegration\` is available as a global (no import needed).

export default defineIntegration(async (context) => {
  console.log("Received event:", context.event.eventId);

  // Example: POST the payload to a webhook.
  // const res = await fetch("https://example.com/webhook", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(context.event.payload),
  // });

  return { id: context.event.deliveryId };
});
`;

/**
 * Default shell template for integration scripts. Shows the available
 * env vars so users have a concrete example to copy from.
 */
const INTEGRATION_SHELL_STARTER = `#!/bin/sh
# Integration shell scripts run when an event fires. The platform
# injects event context as environment variables:
#
#   $EVENT_ID            e.g. "incident.created"
#   $EVENT_TIMESTAMP     ISO-8601 timestamp
#   $DELIVERY_ID         unique per delivery
#   $SUBSCRIPTION_ID
#   $SUBSCRIPTION_NAME
#   $PAYLOAD_*           flattened payload fields (PAYLOAD_TITLE, ...)
#
# Type \`$\` to see the full list. Exit 0 = delivered, anything else
# triggers a retry per the subscription's retry policy.

echo "Got event $EVENT_ID at $EVENT_TIMESTAMP"
echo "Payload title: $PAYLOAD_TITLE"

# curl -fsS -X POST "https://example.com/webhook" \\
#   -H "Content-Type: application/json" \\
#   -d "{\\"event\\": \\"$EVENT_ID\\", \\"title\\": \\"$PAYLOAD_TITLE\\"}"
`;

// ─────────────────────────────────────────────────────────────────────────
// Shell env vars
// ─────────────────────────────────────────────────────────────────────────

/**
 * Vars always forwarded to user shell scripts on every flavour (health
 * check + integration). The whitelist is enforced server-side; we list
 * them here so they autocomplete in the editor.
 */
const SAFE_SHELL_VARS: ShellEnvVar[] = [
  { name: "PATH", description: "Executable lookup path.", example: "/usr/local/bin:/usr/bin:/bin" },
  { name: "HOME", description: "Current user's home directory." },
  { name: "USER", description: "Current user name." },
  { name: "LANG", description: "Default locale." },
  { name: "LC_ALL", description: "Locale override for all categories." },
  { name: "LC_CTYPE", description: "Locale override for character classification." },
  { name: "TZ", description: "Time-zone (e.g. \"Europe/Berlin\")." },
  { name: "TMPDIR", description: "Writable temp directory." },
  { name: "HOSTNAME", description: "Host name of the satellite." },
  { name: "SHELL", description: "User's login shell." },
];

/**
 * Run-context vars the satellite injects into every shell health-check
 * run, describing the check + system it's for. Mirrors the reserved
 * `CHECKSTACK_*` keys set by `healthcheck-script-backend`'s shell
 * collector. User-supplied `env` values override these.
 *
 * The `CHECKSTACK_ENV_*` vars are present only when the run resolved an
 * environment (the assignment opts in and the system has at least one). The
 * per-field `CHECKSTACK_ENV_<FIELD>` vars (one per custom field, e.g.
 * `CHECKSTACK_ENV_BASE_URL`) are NOT listed here because the concrete
 * environments aren't known when authoring a check; see the file header.
 */
const HEALTHCHECK_RUN_CONTEXT_VARS: ShellEnvVar[] = [
  { name: "CHECKSTACK_CHECK_ID", description: "This health check's configuration id." },
  {
    name: "CHECKSTACK_CHECK_NAME",
    description: "This health check's display name (falls back to the id).",
  },
  {
    name: "CHECKSTACK_CHECK_INTERVAL_SECONDS",
    description: "The configured run interval, in seconds.",
  },
  { name: "CHECKSTACK_SYSTEM_ID", description: "The id of the system being checked." },
  {
    name: "CHECKSTACK_SYSTEM_NAME",
    description: "The system's display name (falls back to the id).",
  },
  {
    name: "CHECKSTACK_ENV_ID",
    description:
      "The resolved environment's id. Set only when the run resolved an environment.",
  },
  {
    name: "CHECKSTACK_ENV_NAME",
    description:
      "The resolved environment's display name. Set only when the run resolved an environment. Each custom field is also exposed as CHECKSTACK_ENV_<FIELD> (e.g. CHECKSTACK_ENV_BASE_URL).",
  },
];

/** A valid POSIX shell identifier — only these can be referenced as `$NAME`. */
const SHELL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Turn a user's custom `env` object (e.g. a script action's or health
 * check's "Env (JSON)" field) into `$`-completion hints. Defensive about
 * the loosely-typed form value: non-objects yield nothing, and only keys
 * that are valid shell identifiers are surfaced (a `$my-var` completion
 * wouldn't be usable). Exported so editors that build their shell env
 * suggestions outside the `*ScriptContext` helpers (e.g. the automation
 * action editor) can merge custom env keys the same way.
 */
export function customShellEnvVars(env: unknown): ShellEnvVar[] {
  if (typeof env !== "object" || env === null || Array.isArray(env)) return [];
  return Object.keys(env)
    .filter((name) => SHELL_IDENTIFIER.test(name))
    .map((name) => ({
      name,
      description: "Custom variable from this check's Env (JSON) field.",
    }));
}

/**
 * Vars injected by the integration platform on every delivery. Per-
 * payload-field `PAYLOAD_*` vars are appended at call time based on the
 * concrete event schema.
 */
const INTEGRATION_CORE_VARS: ShellEnvVar[] = [
  {
    name: "EVENT_ID",
    description: "Fully-qualified event type, e.g. \"incident.created\".",
    example: "incident.created",
  },
  {
    name: "EVENT_TIMESTAMP",
    description: "ISO-8601 timestamp of when the event was emitted.",
    example: "2026-05-26T08:30:00.000Z",
  },
  { name: "DELIVERY_ID", description: "Unique ID for this delivery attempt." },
  { name: "SUBSCRIPTION_ID", description: "ID of the subscription that fired." },
  { name: "SUBSCRIPTION_NAME", description: "Human-readable subscription name." },
];

/**
 * Flatten a JSON-Schema payload into `PAYLOAD_*` env-var hints. Mirrors
 * the runtime flattening done by the integration shell provider:
 * uppercase + dots/dashes → underscores. Nested objects are flattened
 * recursively; arrays become a single `PAYLOAD_FOO` (JSON-encoded).
 */
function flattenSchemaToEnvVars(
  schema: JsonSchemaProperty,
  prefix = "PAYLOAD",
): ShellEnvVar[] {
  const out: ShellEnvVar[] = [];

  if (schema.type !== "object" || !schema.properties) {
    return [];
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const envKey = `${prefix}_${key
      .toUpperCase()
      .replaceAll(/[.-]/g, "_")
      .replaceAll(/[^A-Z0-9_]/g, "")}`;

    if (propSchema.type === "object" && propSchema.properties) {
      out.push(...flattenSchemaToEnvVars(propSchema, envKey));
    } else {
      out.push({
        name: envKey,
        description: propSchema.description,
        example:
          propSchema.type === "string"
            ? "<string>"
            : propSchema.type === "number" || propSchema.type === "integer"
              ? "<number>"
              : propSchema.type === "boolean"
                ? "<true|false>"
                : undefined,
      });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────

/**
 * Editor context for inline + shell health-check editors.
 *
 * Pass the collector's `configSchema` so `context.config` is typed —
 * both as the ambient global and as the parameter type of
 * `defineHealthCheck(ctx => ...)`. Without a schema, both default to
 * `Record<string, unknown>`.
 */
export function healthcheckScriptContext(input: {
  collectorConfigSchema?: JsonSchemaProperty;
  /**
   * The collector's current `env` value (the "Env (JSON)" field). Its
   * keys are surfaced as `$`-completions so a user's own declared vars
   * autocomplete alongside the whitelist + reserved run-context vars.
   * Typed `unknown` because it comes from the loosely-typed form value.
   */
  customEnv?: unknown;
}): ScriptEditorContext {
  const configType = input.collectorConfigSchema
    ? jsonSchemaToTypeScript(input.collectorConfigSchema)
    : "Record<string, unknown>";

  return {
    typeDefinitions: buildHealthCheckTypes(configType),
    starterTemplates: {
      typescript: HEALTHCHECK_INLINE_TS_STARTER,
      javascript: HEALTHCHECK_INLINE_TS_STARTER,
      shell: HEALTHCHECK_SHELL_STARTER,
    },
    // Most-relevant-first: the user's own declared env, then this check's
    // run-context metadata, then the generic OS whitelist (the suggest list
    // is ordered by insertion index, so order here is what the user sees).
    shellEnvVars: [
      ...customShellEnvVars(input.customEnv),
      ...HEALTHCHECK_RUN_CONTEXT_VARS,
      ...SAFE_SHELL_VARS,
    ],
  };
}

/**
 * Editor context for inline + shell integration script editors.
 *
 * Pass the event's payload schema so `context.event.payload` is typed
 * — both as the ambient global and as the parameter type of
 * `defineIntegration(ctx => ...)`. Without a schema, both default to
 * `Record<string, unknown>`. The schema also drives the `PAYLOAD_*`
 * env-var hints in the shell editor.
 */
export function integrationScriptContext(input: {
  eventPayloadSchema?: JsonSchemaProperty;
}): ScriptEditorContext {
  const payloadType = input.eventPayloadSchema
    ? jsonSchemaToTypeScript(input.eventPayloadSchema)
    : "Record<string, unknown>";

  const payloadVars = input.eventPayloadSchema
    ? flattenSchemaToEnvVars(input.eventPayloadSchema)
    : [];

  return {
    typeDefinitions: buildIntegrationTypes(payloadType),
    starterTemplates: {
      typescript: INTEGRATION_INLINE_TS_STARTER,
      javascript: INTEGRATION_INLINE_TS_STARTER,
      shell: INTEGRATION_SHELL_STARTER,
    },
    shellEnvVars: [...SAFE_SHELL_VARS, ...INTEGRATION_CORE_VARS, ...payloadVars],
  };
}

// Exported for unit tests — not part of the public API.
export const _internals = {
  flattenSchemaToEnvVars,
  SAFE_SHELL_VARS,
  INTEGRATION_CORE_VARS,
  HEALTHCHECK_INLINE_TS_STARTER,
  HEALTHCHECK_SHELL_STARTER,
  INTEGRATION_INLINE_TS_STARTER,
  INTEGRATION_SHELL_STARTER,
  buildHealthCheckTypes,
  buildIntegrationTypes,
};
