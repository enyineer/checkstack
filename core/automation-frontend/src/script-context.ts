/**
 * Generate the `declare const context: …` TypeScript declaration that
 * Monaco's `addExtraLib` consumes to drive IntelliSense inside an
 * inline-script action editor.
 *
 * Built on top of `@checkstack/automation-common`'s `resolveVariableScope`:
 *
 *   1. Resolver returns `VariableEntry[]` rooted at `trigger`, `var`,
 *      `artifact`, `repeat`.
 *   2. This module walks those entries (plus the unfiltered registry
 *      info) and emits a TypeScript declaration whose top-level shape is
 *
 *        declare const context: {
 *          trigger:
 *            | { event: "incident.created"; payload: { incidentId: string; … } }
 *            | { event: "incident.resolved"; payload: { incidentId: string; … } };
 *          artifacts: { open_jira: { issue: { key: string; url?: string } }; … };
 *          var: { foo: string; count: number; … };
 *          repeat: { index: number; item?: unknown };
 *        };
 *
 *      so Monaco narrows `context.trigger.payload` to the right variant
 *      inside `if (context.trigger.event === "incident.created") { … }`.
 *
 * Reuses `jsonSchemaToTypeScript` from `@checkstack/ui` for the per-field
 * type conversion — no duplicated logic; we wrap it with the
 * trigger-union envelope.
 */
import type {
  ActionPath,
  ArtifactTypeInfo,
  AutomationDefinition,
  TriggerInfo,
  VariableScope,
} from "@checkstack/automation-common";
import { deriveTriggerId, resolveVariableScope } from "@checkstack/automation-common";
// Deep-import the standalone helper rather than going through the
// `@checkstack/ui` barrel — the barrel pulls in MonacoEditor which
// side-effect imports Vite-only `?worker` modules, which break bun's
// test runner. The helper itself has no DOM/Vite dependencies.
import { jsonSchemaToTypeScript } from "@checkstack/ui/src/components/CodeEditor/generateTypeDefinitions";

export interface GenerateAutomationContextTypesInput {
  /** The automation definition being edited. */
  definition: AutomationDefinition;
  /** All triggers registered across the platform (full registry list). */
  triggers: TriggerInfo[];
  /** Optional artifact-type registry — used to type `context.artifacts.*`. */
  artifactTypes?: ArtifactTypeInfo[];
  /**
   * Optional action registry — needed to expose `context.artifacts.*` typed
   * from each upstream action's `produces` field. When omitted, the
   * generator still emits `trigger.*` and `var.*` correctly but leaves
   * `artifacts` as `Record<string, unknown>`.
   */
  actions?: { qualifiedId: string; produces?: string }[];
  /** Path to the action being edited (drives the scope). */
  path: ActionPath;
}

export interface GenerateAutomationContextTypesResult {
  /** The TS declaration string ready to feed to Monaco's `addExtraLib`. */
  typeDefinitions: string;
  /** The resolved scope — handy for the editor to also drive the picker. */
  scope: VariableScope;
}

/**
 * Emit the TS declarations for an inline-script action editor.
 *
 * The output starts with the trigger discriminated union and ends with a
 * single `declare const context: { … }`. The shape matches what
 * `integration-script.run_script` (and any future inline-script action)
 * exposes on `globalThis.context` at runtime — so what the user
 * autocompletes is what they get.
 */
export function generateAutomationContextTypes(
  input: GenerateAutomationContextTypesInput,
): GenerateAutomationContextTypesResult {
  const { definition, triggers, artifactTypes, actions, path } = input;

  const scope = resolveVariableScope({
    definition,
    triggers,
    actions: actions?.map((a) => ({
      qualifiedId: a.qualifiedId,
      displayName: a.qualifiedId,
      category: "Uncategorized",
      // Derive the owning plugin id from the qualified action id (the part
      // before the first dot) so the resolver can strip it off `produces`
      // to recover the local artifact name (e.g. `integration-jira.issue`
      // -> `issue`). An unqualified id yields an empty owner, leaving the
      // produces id intact.
      ownerPluginId: a.qualifiedId.includes(".")
        ? a.qualifiedId.slice(0, a.qualifiedId.indexOf("."))
        : "",
      configSchema: {},
      produces: a.produces,
      consumes: [],
    })) ?? [],
    artifactTypes: artifactTypes ?? [],
    path,
  });

  // ─── Trigger union ─────────────────────────────────────────────────────
  // Each variant carries the trigger's `id` (explicit or derived) and `event`,
  // both literal types, so a script can discriminate on either - including two
  // triggers that share the same event but have distinct ids.
  const triggerUnion =
    definition.triggers.length === 0
      ? "{ readonly id: string; readonly event: string; readonly payload: Record<string, unknown> }"
      : definition.triggers
          .map((t) => {
            const info = triggers.find((r) => r.qualifiedId === t.event);
            const id = t.id ?? deriveTriggerId(t.event);
            const payloadType = info
              ? jsonSchemaToTypeScript(
                  info.payloadSchema as Parameters<
                    typeof jsonSchemaToTypeScript
                  >[0],
                )
              : "Record<string, unknown>";
            return `{ readonly id: ${JSON.stringify(id)}; readonly event: ${JSON.stringify(t.event)}; readonly payload: ${payloadType} }`;
          })
          .join("\n  | ");

  // ─── Artifacts map ─────────────────────────────────────────────────────
  // The resolver nests artifacts as `artifact.<actionId>.<localName>`, mirroring
  // the runtime `artifacts.<actionId>.<localName>.<field>` shape. Each top-level
  // child is an action-id node; its own children are the produced artifact(s)
  // keyed by local name, each carrying the artifact's JSON Schema.
  const artifactIdNodes = scope.entries.find((e) => e.path === "artifact")
    ?.children;
  const artifactsType =
    !artifactIdNodes || artifactIdNodes.length === 0
      ? "Record<string, unknown>"
      : `{\n${artifactIdNodes
          .map((idNode) => {
            const actionId = idNode.path.split(".").pop() ?? idNode.path;
            const localNodes = idNode.children ?? [];
            const inner =
              localNodes.length === 0
                ? "Record<string, unknown>"
                : `{\n${localNodes
                    .map((localNode) => {
                      const localName =
                        localNode.path.split(".").pop() ?? localNode.path;
                      const dataType = localNode.jsonSchema
                        ? jsonSchemaToTypeScript(
                            localNode.jsonSchema as Parameters<
                              typeof jsonSchemaToTypeScript
                            >[0],
                          )
                        : "unknown";
                      return `    readonly ${JSON.stringify(localName)}: ${dataType};`;
                    })
                    .join("\n")}\n  }`;
            return `  readonly ${JSON.stringify(actionId)}: ${inner};`;
          })
          .join("\n")}\n}`;

  // ─── var bag ──────────────────────────────────────────────────────────
  const varEntries =
    scope.entries.find((e) => e.path === "var")?.children ?? [];
  const varType =
    varEntries.length === 0
      ? "Record<string, unknown>"
      : `{\n${varEntries
          .map((entry) => {
            const name = entry.path.slice("var.".length);
            return `  readonly ${JSON.stringify(name)}?: ${entry.type === "string | template" ? "string" : entry.type === "number" ? "number" : entry.type === "boolean" ? "boolean" : "unknown"};`;
          })
          .join("\n")}\n}`;

  // ─── repeat scope ──────────────────────────────────────────────────────
  const repeatEntries =
    scope.entries.find((e) => e.path === "repeat")?.children ?? [];
  const hasRepeat = repeatEntries.length > 0;
  const hasForEach = repeatEntries.some((e) => e.path === "repeat.item");
  const repeatLine = hasRepeat
    ? `  readonly repeat: { readonly index: number;${hasForEach ? " readonly item: unknown;" : ""} };`
    : null;

  // ─── Compose ───────────────────────────────────────────────────────────
  const lines: Array<string | null> = [
    "/**",
    " * Auto-generated automation runtime context. Reflects the triggers",
    " * subscribed by this automation and the artifacts / variables in",
    " * scope at the action position being edited.",
    " */",
    "",
    "/** Who or what caused the event (present on every trigger). */",
    'type AutomationActor = { readonly type: "system" | "user" | "application" | "service"; readonly id: string; readonly name?: string };',
    "",
    "/** Trigger that fired this run. */",
    `type AutomationTrigger = (\n  | ${triggerUnion}\n) & { readonly actor: AutomationActor };`,
    "",
    "declare const context: {",
    "  readonly trigger: AutomationTrigger;",
    `  readonly artifacts: ${indent(artifactsType, "  ")};`,
    `  readonly var: ${indent(varType, "  ")};`,
    repeatLine,
    "  readonly automation: { readonly runId: string; readonly automationId: string; readonly contextKey: string | null };",
    "};",
  ];

  return {
    typeDefinitions: lines.filter((l): l is string => l !== null).join("\n"),
    scope,
  };
}

function indent(input: string, pad: string): string {
  return input
    .split("\n")
    .map((line, i) => (i === 0 ? line : `${pad}${line}`))
    .join("\n");
}

/** A TypeScript identifier safe to emit as an unquoted interface key. */
const TS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Emit an ambient `NodeJS.ProcessEnv` augmentation that types the declared
 * `secretEnv` environment-variable NAMES as `string`, so they autocomplete
 * under `process.env.` in the inline-script Monaco editor and are typed.
 *
 * This is a type AUGMENTATION, not a replacement: it adds the known keys as
 * non-optional `string` members and coexists with `@types/node`'s existing
 * `ProcessEnv` index signature (`[key: string]: string | undefined`), so
 * unknown keys still resolve to `string | undefined` while the declared ones
 * narrow to `string`.
 *
 * Only valid TS identifiers are emitted as ambient keys (an env var like
 * `MY-VAR` is not a legal `process.env.MY-VAR` member access, so it is
 * skipped — it remains reachable via the index signature as
 * `process.env["MY-VAR"]`). Empty / all-invalid input emits a harmless empty
 * module (`export {};`) so merging it is always safe.
 */
export function generateSecretEnvTypes({
  envNames,
}: {
  envNames: string[];
}): string {
  // De-dupe, keep only legal identifiers, preserve first-seen order.
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const name of envNames) {
    const trimmed = name.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (TS_IDENTIFIER_RE.test(trimmed)) valid.push(trimmed);
  }

  if (valid.length === 0) {
    // Nothing to declare — emit an empty module so a caller can always
    // concatenate the result without producing a syntax error.
    return "export {};";
  }

  const members = valid
    .map((name) => `      readonly ${name}: string;`)
    .join("\n");
  return [
    "/**",
    " * Auto-generated: the `secretEnv` mapping declared on this action injects",
    " * these names as `process.env.<NAME>` for the run. Typed `string` so they",
    " * autocomplete; unknown keys still resolve via @types/node's index signature.",
    " */",
    "declare global {",
    "  namespace NodeJS {",
    "    interface ProcessEnv {",
    members,
    "    }",
    "  }",
    "}",
    "",
    "export {};",
  ].join("\n");
}

/** Narrow an `unknown` to a plain (non-array) object record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Locate the action config's secret→env mapping by the `x-secret-env`
 * schema annotation (NOT a hard-coded field name) and return the declared
 * environment-variable NAMES (the mapping's keys). These feed
 * {@link generateSecretEnvTypes} so the script editor types `process.env.*`.
 *
 * Both inputs are loosely typed (`configSchema` is a JSON-schema record;
 * `config` is the action's live config object), so they're narrowed at
 * runtime via {@link asRecord}. The lone `as` casts the already-narrowed
 * record to its inferred shape — unavoidable because `asRecord` returns the
 * generic record. Returns `[]` when no `x-secret-env` field exists or its
 * mapping value isn't a record.
 */
export function secretEnvEnvNames({
  configSchema,
  config,
}: {
  configSchema: unknown;
  config: unknown;
}): string[] {
  const schemaRecord = asRecord(configSchema);
  const properties = asRecord(schemaRecord?.properties);
  if (!properties) return [];

  const fieldKey = Object.entries(properties).find(([, prop]) => {
    const propRecord = asRecord(prop);
    return propRecord?.["x-secret-env"] === true;
  })?.[0];
  if (!fieldKey) return [];

  const configRecord = asRecord(config);
  const mapping = asRecord(configRecord?.[fieldKey]);
  if (!mapping) return [];
  return Object.keys(mapping);
}
