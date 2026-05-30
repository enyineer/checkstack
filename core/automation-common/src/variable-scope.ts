/**
 * Variable-scope resolver.
 *
 * Given an automation definition + the registry info for its triggers and
 * actions + the path to a specific leaf action inside the definition, returns
 * the set of template variables that are in scope at that point.
 *
 * The scope rules — kept deliberately conservative so the editor never
 * over-promises:
 *
 *   1. `trigger.event` (string-literal union of subscribed trigger ids).
 *   2. `trigger.payload.*` — union of every field across the subscribed
 *      triggers' payload JSON Schemas, with each leaf annotated by the
 *      set of triggers that contribute it. The `generateTypeDeclarations`
 *      utility consumes this to emit a discriminated union typed by
 *      `trigger.event`, so Monaco narrows correctly inside a branch that
 *      gates on a specific event id. The picker shows everything;
 *      conditional fields surface a `Only when …` hint.
 *   3. `var.<name>` — accumulated from `variables:` actions that linearly
 *      precede the target action _in the same sequence slot_. We do NOT
 *      bubble variables out of a `choose` / `parallel` / `repeat` branch
 *      into the parent sequence, even though the runtime would keep them
 *      live, because the editor can't statically prove which branch ran.
 *   4. `artifact.<actionId>.<localArtifactName>` — accumulated from
 *      provider actions with a declared `produces` (and an `id`) in the
 *      same sequence slot, with the same branch-isolation rule as
 *      variables. The runtime exposes the data at
 *      `artifacts.<actionId>.<localArtifactName>.<field>`.
 *   5. `repeat.index` and (when the parent is `for_each`) `repeat.item` —
 *      whenever the path descends through a `repeat` container.
 *
 * The resolver is pure — no I/O, no side effects. Used by both the editor
 * (for IntelliSense and the variable picker) and the validator (to flag
 * references to undeclared variables).
 */
import type { Expr } from "@checkstack/template-engine";
import { parseCondition } from "@checkstack/template-engine";
import type {
  ActionInfo,
  ActionInput,
  ArtifactTypeInfo,
  AutomationDefinition,
  ChooseInput,
  ConditionInput,
  ParallelInput,
  ProviderAction,
  RepeatInput,
  SequenceInput,
  Trigger,
  TriggerInfo,
  VariablesInput,
} from "./schemas";

/**
 * Hierarchical entry in the resolved scope. Used by the variable picker
 * for the tree view; the flat `path` is what gets inserted as `{{path}}`.
 */
export interface VariableEntry {
  /** Dot-separated path used at the template site, e.g. `trigger.payload.systemId`. */
  path: string;
  /**
   * Runtime-parseable `{{ }}` insertion form for this entry. Differs from
   * `path` in two ways: the top-level namespace is the plural runtime
   * context key (`var` → `variables`, `artifact` → `artifacts`; `trigger`,
   * `repeat`, `now` already match the runtime context and stay as-is), and
   * any segment that is not a valid template identifier (artifact ids with
   * dots/hyphens, oddly-named variables, hyphenated payload keys) is
   * emitted in bracket notation (`artifacts["integration-jira.issue"]`) so
   * the template engine's tokenizer can read it. Consumers that need the
   * text to actually insert into `{{ }}` should prefer this field and fall
   * back to `path` only when it is absent.
   */
  templateRef?: string;
  /** Human-readable type label. */
  type: string;
  description?: string;
  /**
   * Underlying JSON Schema fragment for this node, when known. The type
   * declaration generator consumes this to emit a strongly-typed
   * `declare const context` block for Monaco.
   */
  jsonSchema?: Record<string, unknown>;
  /** Nested entries for object types — populated for the picker's tree. */
  children?: VariableEntry[];
  /**
   * Emit as an insertable field even when it has children — used for
   * arrays, where both the whole array (`{{ ...tags }}`) and its elements
   * (`{{ ...tags[0] }}`) are referenceable. Leaf entries (no children) are
   * always insertable regardless of this flag.
   */
  referenceable?: boolean;
  /**
   * When set, the entry only exists when `trigger.event` is one of these
   * qualified ids. Populated on `trigger.payload.*` entries that come from
   * a subset of the automation's subscribed triggers, so the picker can
   * render an "Only when …" hint and the type generator can emit a
   * discriminated-union shape.
   */
  conditionalOnTriggers?: string[];
}

export interface VariableScope {
  /** Tree of in-scope entries, grouped under top-level namespaces. */
  entries: VariableEntry[];
}

// ─── Template-ref helpers ────────────────────────────────────────────────────

/**
 * Whether `segment` is a bare identifier the template engine can read in dot
 * notation. MIRRORS the template-engine tokenizer's identifier rule: a start
 * character in `[A-Za-z_$]` followed by zero or more `[A-Za-z0-9_$]`. Anything
 * else (dots, hyphens, leading digits, empty) must be bracketed instead.
 */
export function isTemplateIdentifier(segment: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment);
}

/**
 * Append `segment` to `base`, producing a runtime-parseable `{{ }}` member
 * access. Identifier segments use dot notation (`base.segment`); everything
 * else uses bracket notation with a JSON-quoted string literal
 * (`base["seg-ment"]`). `JSON.stringify` yields a valid double-quoted string
 * literal — which the engine tokenizer supports — and safely escapes any
 * dots, hyphens, or quotes inside the segment.
 */
export function appendTemplateSegment({
  base,
  segment,
}: {
  base: string;
  segment: string;
}): string {
  return isTemplateIdentifier(segment)
    ? `${base}.${segment}`
    : `${base}[${JSON.stringify(segment)}]`;
}

/**
 * Append a numeric array-element index to `base`, producing a
 * runtime-parseable `{{ }}` index access (`base[0]`). The index is a bare
 * number with NO quotes — the template engine's tokenizer reads a NUMBER
 * inside the brackets and the renderer resolves it as an array index. This
 * MUST match the tokenizer's bracket-number reconstruction byte-for-byte.
 */
export function appendArrayIndex({
  base,
  index,
}: {
  base: string;
  index: number;
}): string {
  return `${base}[${index}]`;
}

/**
 * One segment of a navigation path from the root of `definition.actions` to
 * a particular leaf action.
 *
 * - `slot: "root"` is reserved for the first segment of the path; `index`
 *   is the index into `definition.actions`.
 * - All other slots correspond to a child list inside a composite action.
 * - When `slot === "choose-when"`, `whenIndex` identifies the when-branch.
 */
export interface ActionPathStep {
  slot:
    | "root"
    | "choose-when"
    | "choose-else"
    | "parallel"
    | "repeat"
    | "sequence";
  /** When `slot === "choose-when"`, which when-branch (index into `choose:`). */
  whenIndex?: number;
  /** Index of the step within the slot's child list. */
  index: number;
}

export type ActionPath = ActionPathStep[];

export interface ResolveVariableScopeInput {
  definition: AutomationDefinition;
  triggers: TriggerInfo[];
  actions: ActionInfo[];
  artifactTypes: ArtifactTypeInfo[];
  /** Position of the target action inside `definition.actions`. */
  path: ActionPath;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getChildList(
  action: ActionInput,
  slot: ActionPathStep["slot"],
  whenIndex: number | undefined,
): ActionInput[] {
  if (slot === "root") return [];
  if (slot === "choose-when") {
    const choose = action as ChooseInput;
    if (whenIndex === undefined) return [];
    return choose.choose[whenIndex]?.sequence ?? [];
  }
  if (slot === "choose-else") {
    const choose = action as ChooseInput;
    return choose.else ?? [];
  }
  if (slot === "parallel") {
    return (action as ParallelInput).parallel;
  }
  if (slot === "repeat") {
    return (action as RepeatInput).repeat.sequence;
  }
  // sequence
  return (action as SequenceInput).sequence;
}

function isProviderAction(a: ActionInput): a is ProviderAction {
  return typeof a === "object" && a !== null && "action" in a;
}

function isVariablesAction(a: ActionInput): a is VariablesInput {
  return typeof a === "object" && a !== null && "variables" in a;
}

function isRepeatAction(a: ActionInput): a is RepeatInput {
  return typeof a === "object" && a !== null && "repeat" in a;
}

function repeatMode(action: RepeatInput): "count" | "for_each" | "while" | "until" {
  const r = action.repeat as Record<string, unknown>;
  if ("for_each" in r) return "for_each";
  if ("while" in r) return "while";
  if ("until" in r) return "until";
  return "count";
}

// ─── Condition-aware trigger narrowing ─────────────────────────────────────

/**
 * When the path descends through a `choose-when`, the branch's `when:`
 * condition may statically pin `trigger.event` to a specific id (or a
 * specific subset). We use that to narrow `trigger.payload` from the
 * full discriminated union down to the variants the operator is
 * actually inside — so `{{ trigger.payload.title }}` works without the
 * "Only when …" hint when the branch already gates on
 * `trigger.event == "incident.created"`.
 *
 * Returns `undefined` when the condition doesn't tell us anything about
 * `trigger.event` — in that case we keep all subscribed triggers in scope.
 * Returns a `Set<string>` of event ids the condition allows otherwise.
 *
 * Pattern coverage (conservative — anything outside this list falls back
 * to "no narrowing"):
 *
 *   - `trigger.event == "X"` (either operand order) → {X}
 *   - `trigger.event != "X"` → all-minus-{X}, but only when we know the
 *     full universe (the caller passes `allTriggers`). When the universe
 *     is unknown we bail.
 *   - `A || B`, `A && B` where A and B are themselves narrowable.
 *
 * Complex predicates (`not`, function calls, references to other fields,
 * dynamic comparisons) deliberately bail to `undefined`. We'd rather
 * leave the picker showing every field than guess wrong.
 */
function narrowTriggersFromCondition(
  condition: ConditionInput,
  universe: string[],
): Set<string> | undefined {
  if (typeof condition === "string") {
    let parsed;
    try {
      parsed = parseCondition(condition);
    } catch {
      return undefined;
    }
    return narrowFromExpr(parsed.root, universe);
  }
  if ("and" in condition) {
    let result: Set<string> | undefined;
    for (const child of condition.and) {
      const childNarrow = narrowTriggersFromCondition(child, universe);
      if (childNarrow === undefined) continue;
      result =
        result === undefined
          ? new Set(childNarrow)
          : new Set([...result].filter((id) => childNarrow.has(id)));
    }
    return result;
  }
  if ("or" in condition) {
    let result: Set<string> | undefined;
    for (const child of condition.or) {
      const childNarrow = narrowTriggersFromCondition(child, universe);
      if (childNarrow === undefined) return undefined;
      result =
        result === undefined
          ? new Set(childNarrow)
          : new Set([...result, ...childNarrow]);
    }
    return result;
  }
  // `not` — could in principle return all-minus-{X} but combining with
  // outer AND/OR gets surprising fast. Bail.
  return undefined;
}

function narrowFromExpr(expr: Expr, universe: string[]): Set<string> | undefined {
  if (expr.kind !== "binary") return undefined;
  if (expr.op === "==") {
    const event = extractTriggerEventLiteral(expr.left, expr.right);
    return event === undefined ? undefined : new Set([event]);
  }
  if (expr.op === "!=") {
    const event = extractTriggerEventLiteral(expr.left, expr.right);
    if (event === undefined || universe.length === 0) return undefined;
    return new Set(universe.filter((id) => id !== event));
  }
  if (expr.op === "||") {
    const left = narrowFromExpr(expr.left, universe);
    const right = narrowFromExpr(expr.right, universe);
    if (left === undefined || right === undefined) return undefined;
    return new Set([...left, ...right]);
  }
  if (expr.op === "&&") {
    const left = narrowFromExpr(expr.left, universe);
    const right = narrowFromExpr(expr.right, universe);
    if (left === undefined && right === undefined) return undefined;
    if (left === undefined) return right;
    if (right === undefined) return left;
    return new Set([...left].filter((id) => right.has(id)));
  }
  return undefined;
}

function extractTriggerEventLiteral(
  a: Expr,
  b: Expr,
): string | undefined {
  const direction = (member: Expr, literal: Expr): string | undefined => {
    if (member.kind !== "member" || member.property !== "event") return undefined;
    if (member.object.kind !== "identifier" || member.object.name !== "trigger") {
      return undefined;
    }
    if (literal.kind !== "literal" || typeof literal.value !== "string") {
      return undefined;
    }
    return literal.value;
  };
  return direction(a, b) ?? direction(b, a);
}

// ─── JSON Schema → VariableEntry tree ──────────────────────────────────────

interface JsonSchemaLike {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchemaLike;
}

function schemaTypeLabel(schema: JsonSchemaLike | undefined): string {
  if (!schema) return "unknown";
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type.join(" | ");
  }
  if (schema.type === "array" && schema.items) {
    return `${schemaTypeLabel(schema.items)}[]`;
  }
  if (schema.type === "object") return "object";
  if (typeof schema.type === "string") return schema.type;
  return "unknown";
}

/**
 * Build a tree of `VariableEntry` nodes from a JSON Schema, rooted at
 * `parentPath`. Each entry's `path` is the dot-joined navigation key the
 * user would type after the picker inserts it.
 */
function entriesFromSchema(
  schema: JsonSchemaLike | undefined,
  parentPath: string,
  parentTemplateRef: string,
): VariableEntry[] {
  if (!schema || schema.type !== "object" || !schema.properties) return [];
  return Object.entries(schema.properties).map(([key, child]) => {
    const childPath = `${parentPath}.${key}`;
    const childTemplateRef = appendTemplateSegment({
      base: parentTemplateRef,
      segment: key,
    });
    return entryFromSchemaNode(child, childPath, childTemplateRef);
  });
}

/**
 * Build a single `VariableEntry` for a property's schema, recursing into
 * objects and arrays.
 *
 * - `object` with `properties` → container node with `children`.
 * - `array` with `items` → a referenceable whole-array node carrying a
 *   single representative-element child at index `0`. The element child
 *   recurses for nested objects (`tags[0].field`) / arrays (`matrix[0][0]`)
 *   or is a leaf for scalar items (`tags[0]`).
 * - anything else → leaf.
 */
function entryFromSchemaNode(
  schema: JsonSchemaLike,
  path: string,
  templateRef: string,
): VariableEntry {
  if (schema.type === "array" && schema.items) {
    const elemPath = `${path}[0]`;
    const elemTemplateRef = appendArrayIndex({ base: templateRef, index: 0 });
    const elementEntry = entryFromSchemaNode(
      schema.items,
      elemPath,
      elemTemplateRef,
    );
    return {
      path,
      templateRef,
      type: schemaTypeLabel(schema),
      description: schema.description,
      jsonSchema: schema as unknown as Record<string, unknown>,
      // Both the whole array and its elements are referenceable.
      referenceable: true,
      children: [elementEntry],
    } satisfies VariableEntry;
  }

  const subEntries =
    schema.type === "object" && schema.properties
      ? entriesFromSchema(schema, path, templateRef)
      : undefined;
  return {
    path,
    templateRef,
    type: schemaTypeLabel(schema),
    description: schema.description,
    jsonSchema: schema as unknown as Record<string, unknown>,
    children: subEntries,
  } satisfies VariableEntry;
}

// ─── Trigger scope ─────────────────────────────────────────────────────────

/**
 * Build the `trigger.*` namespace as a **discriminated union over
 * `trigger.event`**.
 *
 * Every payload field from every subscribed trigger is offered, and each
 * leaf entry is annotated with the trigger ids that contribute it. Fields
 * shared by all subscribed triggers carry no `conditionalOnTriggers` flag.
 * The TS-declaration generator turns this into a real
 * `trigger: { event: "A"; payload: PA } | { event: "B"; payload: PB }`
 * shape so Monaco narrows correctly inside `{{#if trigger.event === "A"}}`
 * branches.
 */
/**
 * Static `trigger.actor` subtree. Every trigger carries an actor (who/what
 * caused the event), injected by the platform as event metadata, so this is
 * offered unconditionally on every automation - independent of which triggers
 * are subscribed - to drive filters like
 * `{{ trigger.actor.type == "system" }}`.
 */
function buildActorEntry(): VariableEntry {
  return {
    path: "trigger.actor",
    templateRef: "trigger.actor",
    type: "object",
    description:
      "Who or what caused the event (system, user, application, or service).",
    jsonSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["system", "user", "application", "service"],
        },
        id: { type: "string" },
        name: { type: "string" },
      },
      required: ["type", "id"],
    },
    children: [
      {
        path: "trigger.actor.type",
        templateRef: "trigger.actor.type",
        type: '"system" | "user" | "application" | "service"',
        description:
          "Actor kind. Filter e.g. system-created vs user-created events.",
        jsonSchema: {
          type: "string",
          enum: ["system", "user", "application", "service"],
        },
      },
      {
        path: "trigger.actor.id",
        templateRef: "trigger.actor.id",
        type: "string",
        description:
          'Stable id: user id, application id, plugin id (service), or "system".',
        jsonSchema: { type: "string" },
      },
      {
        path: "trigger.actor.name",
        templateRef: "trigger.actor.name",
        type: "string",
        description: "Human-readable actor name when known.",
        jsonSchema: { type: "string" },
      },
    ],
  };
}

/**
 * Static `health.*` namespace (sensing layer). The dispatch engine
 * pre-resolves live health state into scope before evaluating any
 * condition/template, so `health.system` (the trigger's context system)
 * and `health.systems[<id>]` (any `uses_state` ids) are always readable
 * as plain data. Offered unconditionally - the engine always folds the
 * namespace in (empty when nothing resolves), so referencing it never
 * throws.
 */
const HEALTH_STATE_PROPERTIES: Record<string, Record<string, unknown>> = {
  status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
  in_status_since: { type: ["string", "null"] },
  in_status_for_ms: { type: "number" },
  latency_ms: { type: "number" },
  avg_latency_ms: { type: "number" },
  p95_latency_ms: { type: "number" },
  success_rate: { type: "number" },
  last_run_at: { type: "string" },
  in_maintenance: { type: "boolean" },
  transitions_in_window: { type: "number" },
  transition_window_minutes: { type: "number" },
  evaluated_at: { type: "string" },
};

const HEALTH_STATE_DESCRIPTIONS: Record<string, string> = {
  status: "Aggregate health status of the system.",
  in_status_since: "ISO timestamp the system entered its current status (null if unknown).",
  in_status_for_ms: "Milliseconds the system has held its current status.",
  latency_ms: "Latency of the newest run.",
  avg_latency_ms: "Windowed average latency.",
  p95_latency_ms: "Windowed p95 latency.",
  success_rate: "Windowed success rate in [0, 1].",
  last_run_at: "ISO timestamp of the newest run.",
  in_maintenance: "Whether the system is in an active maintenance window.",
  transitions_in_window:
    "Status changes in the trailing window (generalized flapping count).",
  transition_window_minutes:
    "The window (minutes) transitions_in_window was counted over.",
  evaluated_at: "ISO timestamp this snapshot was computed.",
};

function buildHealthStateChildren(prefix: string): VariableEntry[] {
  return Object.entries(HEALTH_STATE_PROPERTIES).map(([key, jsonSchema]) => ({
    path: `${prefix}.${key}`,
    templateRef: `${prefix}.${key}`,
    type:
      key === "status"
        ? '"healthy" | "degraded" | "unhealthy"'
        : key === "in_maintenance"
          ? "boolean"
          : jsonSchema.type === "number"
            ? "number"
            : "string",
    description: HEALTH_STATE_DESCRIPTIONS[key],
    jsonSchema,
  }));
}

function buildHealthEntry(): VariableEntry {
  const stateSchema = {
    type: "object",
    properties: HEALTH_STATE_PROPERTIES,
  };
  return {
    path: "health",
    templateRef: "health",
    type: "object",
    description:
      "Live health state, pre-resolved before evaluation. Use with duration filters, e.g. {{ health.system.in_status_since | older_than(30 | minutes) }}.",
    jsonSchema: {
      type: "object",
      properties: {
        system: stateSchema,
        systems: { type: "object", additionalProperties: stateSchema },
      },
    },
    children: [
      {
        path: "health.system",
        templateRef: "health.system",
        type: "object",
        description:
          "Live state of the system named by the trigger's context key.",
        jsonSchema: stateSchema,
        children: buildHealthStateChildren("health.system"),
      },
      {
        path: "health.systems",
        templateRef: "health.systems",
        type: "Record<string, HealthState>",
        description:
          "Live state of every resolved system keyed by id (context system + uses_state).",
        jsonSchema: {
          type: "object",
          additionalProperties: stateSchema,
        },
      },
    ],
  };
}

/**
 * Derive a stable, identifier-safe id for a trigger from its event id, used
 * when the operator hasn't assigned an explicit `id`. Mirrors the backend
 * dispatcher's derivation so editor autocomplete, the generated script types,
 * and the runtime `trigger.id` all agree.
 */
export function deriveTriggerId(event: string): string {
  return event.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase();
}

/**
 * Build the `trigger.id` entry — the id of the specific trigger declaration
 * that fired. Typed as the literal union of the automation's trigger ids
 * (explicit `id` or derived from the event), so it discriminates triggers
 * even when two subscribe to the same `event`.
 */
function buildTriggerIdEntry(triggers: Trigger[]): VariableEntry {
  const effectiveIds = [
    ...new Set(triggers.map((t) => t.id ?? deriveTriggerId(t.event))),
  ];
  const idType =
    effectiveIds.length > 0
      ? effectiveIds.map((id) => JSON.stringify(id)).join(" | ")
      : "string";
  return {
    path: "trigger.id",
    templateRef: "trigger.id",
    type: idType,
    description:
      effectiveIds.length <= 1
        ? "Id of the trigger declaration that fired."
        : "Id of the trigger that fired — distinguishes triggers, including two on the same event.",
    jsonSchema:
      effectiveIds.length > 0
        ? { type: "string", enum: effectiveIds }
        : { type: "string" },
  };
}

function buildTriggerEntries(args: {
  triggers: Trigger[];
  registeredTriggers: TriggerInfo[];
}): VariableEntry[] {
  const { triggers, registeredTriggers } = args;
  const matched = triggers
    .map((t) => registeredTriggers.find((r) => r.qualifiedId === t.event))
    .filter((r): r is TriggerInfo => r !== undefined);

  const allEventIds = matched.map((m) => m.qualifiedId);
  const eventType =
    allEventIds.length > 0
      ? allEventIds.map((id) => JSON.stringify(id)).join(" | ")
      : "string";

  const idEntry = buildTriggerIdEntry(triggers);
  const eventEntry: VariableEntry = {
    path: "trigger.event",
    templateRef: "trigger.event",
    type: eventType,
    description:
      allEventIds.length <= 1
        ? "Fully-qualified event id of the trigger that fired."
        : "Discriminator — narrows trigger.payload to the matching variant.",
    jsonSchema:
      allEventIds.length > 0
        ? { type: "string", enum: allEventIds }
        : { type: "string" },
  };

  if (matched.length === 0) {
    return [
      {
        path: "trigger",
        templateRef: "trigger",
        type: "object",
        description: "Trigger that fired this run.",
        children: [
          idEntry,
          eventEntry,
          buildActorEntry(),
          {
            path: "trigger.payload",
            templateRef: "trigger.payload",
            type: "unknown",
            description: "Trigger payload (no registered schema).",
            jsonSchema: {},
          },
        ],
      },
    ];
  }

  const payloadEntry = buildPayloadUnion(matched);

  return [
    {
      path: "trigger",
      templateRef: "trigger",
      type: "object",
      description: "Trigger that fired this run.",
      children: [idEntry, eventEntry, buildActorEntry(), payloadEntry],
    },
  ];
}

/**
 * Merge several triggers' payload schemas into a single
 * `trigger.payload` entry. Strategy:
 *
 *   - Walk every property of every payload.
 *   - For each property name, collect the set of triggers that include it.
 *   - When every trigger includes it with the same JSON shape, emit a
 *     plain entry.
 *   - Otherwise emit it with `conditionalOnTriggers` listing the contributors
 *     — the picker shows it (with a hint), the type generator funnels it
 *     into the right discriminated-union variant.
 */
function buildPayloadUnion(triggers: TriggerInfo[]): VariableEntry {
  if (triggers.length === 1) {
    const only = triggers[0]!;
    return {
      path: "trigger.payload",
      templateRef: "trigger.payload",
      type: schemaTypeLabel(only.payloadSchema as JsonSchemaLike),
      description: "Trigger payload.",
      jsonSchema: only.payloadSchema,
      children: entriesFromSchema(
        only.payloadSchema as JsonSchemaLike,
        "trigger.payload",
        "trigger.payload",
      ),
    };
  }

  const allEventIds = triggers.map((t) => t.qualifiedId);
  const propertyContributors = new Map<
    string,
    Array<{ triggerId: string; schema: JsonSchemaLike }>
  >();

  for (const trig of triggers) {
    const schema = trig.payloadSchema as JsonSchemaLike;
    if (schema.type !== "object" || !schema.properties) continue;
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const list = propertyContributors.get(key) ?? [];
      list.push({ triggerId: trig.qualifiedId, schema: propSchema });
      propertyContributors.set(key, list);
    }
  }

  const children: VariableEntry[] = [];
  for (const [key, contributors] of propertyContributors) {
    const contributorIds = contributors.map((c) => c.triggerId);
    const universal = contributorIds.length === allEventIds.length;
    const sameShape = contributors.every(
      (c) => schemaTypeLabel(c.schema) === schemaTypeLabel(contributors[0]!.schema),
    );

    const childPath = `trigger.payload.${key}`;
    const childTemplateRef = appendTemplateSegment({
      base: "trigger.payload",
      segment: key,
    });
    const baseSchema = contributors[0]!.schema;

    // When all contributors agree on the shape, descend into objects/arrays
    // via the shared builder so payload arrays expose element children too.
    // Otherwise emit a flat union entry with no children (we can't pick one
    // canonical shape to recurse into).
    const node: VariableEntry = sameShape
      ? entryFromSchemaNode(baseSchema, childPath, childTemplateRef)
      : {
          path: childPath,
          templateRef: childTemplateRef,
          type: contributors
            .map((c) => schemaTypeLabel(c.schema))
            .filter((t, i, arr) => arr.indexOf(t) === i)
            .join(" | "),
          description: baseSchema.description,
          jsonSchema: undefined,
        };

    children.push({
      ...node,
      conditionalOnTriggers: universal ? undefined : contributorIds,
    });
  }

  return {
    path: "trigger.payload",
    templateRef: "trigger.payload",
    type: "object",
    description:
      "Trigger payload — discriminated union over trigger.event. Fields contributed by only some triggers carry an `Only when …` hint.",
    jsonSchema: undefined,
    children,
  };
}

// ─── Walk & accumulate ─────────────────────────────────────────────────────

interface AccumulatedScope {
  vars: VariableEntry[];
  artifacts: VariableEntry[];
  repeats: VariableEntry[];
  /**
   * When defined, the trigger universe is narrowed to this set — populated
   * by walking `choose-when` branches whose `when:` condition statically
   * pins `trigger.event` (see `narrowTriggersFromCondition`). When
   * `undefined`, no condition along the path narrowed anything and all
   * subscribed triggers remain in scope.
   */
  narrowedTriggers: Set<string> | undefined;
}

/**
 * Walk the path step by step, descending into the action tree and
 * accumulating in-scope vars / artifacts / repeat contexts.
 *
 * At each step we consume only the actions _before_ the target index in
 * the current slot's child list — that's the linear upstream.
 */
function accumulateAlongPath(args: {
  definition: AutomationDefinition;
  actions: ActionInfo[];
  artifactTypes: ArtifactTypeInfo[];
  path: ActionPath;
  subscribedTriggerIds: string[];
}): AccumulatedScope {
  const { definition, actions, artifactTypes, path, subscribedTriggerIds } = args;

  const scope: AccumulatedScope = {
    vars: [],
    artifacts: [],
    repeats: [],
    narrowedTriggers: undefined,
  };
  let currentList: ActionInput[] = definition.actions;
  let parentAction: ActionInput | null = null;

  for (let segment = 0; segment < path.length; segment++) {
    const step = path[segment]!;

    // Accumulate everything in `currentList` up to (but not including) the
    // target index.
    accumulatePrefix({
      slice: currentList.slice(0, step.index),
      actions,
      artifactTypes,
      scope,
    });

    // Last step — we don't descend further.
    if (segment === path.length - 1) break;

    // Descend: target action of this step becomes parent of next step.
    parentAction = currentList[step.index] ?? null;
    if (!parentAction) break;

    const nextStep = path[segment + 1]!;

    // Narrow triggers when stepping into a `choose-when`: read the parent
    // Choose's matching when-branch and intersect its narrowing with what
    // we already had.
    if (
      nextStep.slot === "choose-when" &&
      nextStep.whenIndex !== undefined &&
      typeof parentAction === "object" &&
      parentAction !== null &&
      "choose" in parentAction
    ) {
      const choose = parentAction as ChooseInput;
      const branch = choose.choose[nextStep.whenIndex];
      if (branch !== undefined) {
        const universe = scope.narrowedTriggers
          ? [...scope.narrowedTriggers]
          : subscribedTriggerIds;
        const branchNarrow = narrowTriggersFromCondition(
          branch.when,
          universe,
        );
        if (branchNarrow !== undefined) {
          scope.narrowedTriggers =
            scope.narrowedTriggers === undefined
              ? branchNarrow
              : new Set(
                  [...scope.narrowedTriggers].filter((id) =>
                    branchNarrow.has(id),
                  ),
                );
        }
      }
    }

    if (nextStep.slot === "repeat" && isRepeatAction(parentAction)) {
      scope.repeats.push(
        ...buildRepeatEntries({ action: parentAction, depth: scope.repeats.length / 2 }),
      );
    }

    currentList = getChildList(parentAction, nextStep.slot, nextStep.whenIndex);
  }

  return scope;
}

function buildRepeatEntries(args: {
  action: RepeatInput;
  depth: number;
}): VariableEntry[] {
  const { action } = args;
  const mode = repeatMode(action);
  const out: VariableEntry[] = [
    {
      path: "repeat.index",
      templateRef: "repeat.index",
      type: "number",
      description: "Current iteration index (zero-based).",
      jsonSchema: { type: "integer" },
    },
  ];
  if (mode === "for_each") {
    out.push({
      path: "repeat.item",
      templateRef: "repeat.item",
      type: "unknown",
      description: "Current item in the iterated collection.",
      jsonSchema: {},
    });
  }
  return out;
}

function accumulatePrefix(args: {
  slice: ActionInput[];
  actions: ActionInfo[];
  artifactTypes: ArtifactTypeInfo[];
  scope: AccumulatedScope;
}): void {
  const { slice, actions, artifactTypes, scope } = args;

  for (const action of slice) {
    if (isVariablesAction(action)) {
      for (const [name, value] of Object.entries(action.variables)) {
        if (scope.vars.some((v) => v.path === `var.${name}`)) continue;
        scope.vars.push({
          path: `var.${name}`,
          templateRef: appendTemplateSegment({
            base: "variables",
            segment: name,
          }),
          type: typeof value === "string" ? "string | template" : typeof value,
          description: "Operator-defined variable.",
        });
      }
    }
    if (isProviderAction(action)) {
      const registered = actions.find((a) => a.qualifiedId === action.action);
      const produces = registered?.produces;
      // The runtime exposes a produced artifact as
      // `artifacts.<actionId>.<localName>.<field>`. Only producing actions
      // that carry an `id` are referenceable, so skip the rest.
      if (produces && action.id) {
        const artifactInfo = artifactTypes.find(
          (t) => t.qualifiedId === produces,
        );
        // localName = produces with the owning plugin prefix stripped
        // (e.g. `integration-jira.issue` → `issue`).
        const prefix = registered?.ownerPluginId
          ? `${registered.ownerPluginId}.`
          : "";
        const localName =
          prefix && produces.startsWith(prefix)
            ? produces.slice(prefix.length)
            : produces;

        // Top-level node: `artifact.<id>` → templateRef `artifacts.<id>`.
        const path = `artifact.${action.id}`;
        if (scope.artifacts.some((a) => a.path === path)) continue;
        const templateRef = appendTemplateSegment({
          base: "artifacts",
          segment: action.id,
        });

        // Intermediate localName node: `artifact.<id>.<localName>` →
        // templateRef `artifacts.<id>.<localName>`, whose children are the
        // artifact schema fields.
        const localPath = `${path}.${localName}`;
        const localTemplateRef = appendTemplateSegment({
          base: templateRef,
          segment: localName,
        });
        const fieldEntries = entriesFromSchema(
          artifactInfo?.schema as JsonSchemaLike | undefined,
          localPath,
          localTemplateRef,
        );
        const localNode: VariableEntry = {
          path: localPath,
          templateRef: localTemplateRef,
          type: artifactInfo?.displayName ?? produces,
          description: artifactInfo?.description,
          jsonSchema: artifactInfo?.schema,
          children: fieldEntries.length > 0 ? fieldEntries : undefined,
        };

        scope.artifacts.push({
          path,
          templateRef,
          type: artifactInfo?.displayName ?? produces,
          description: artifactInfo?.description,
          jsonSchema: artifactInfo?.schema,
          children: [localNode],
        });
      }
    }
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export function resolveVariableScope(
  input: ResolveVariableScopeInput,
): VariableScope {
  const { definition, triggers, actions, artifactTypes, path } = input;

  if (path.length === 0 || path[0]!.slot !== "root") {
    return { entries: [] };
  }

  const subscribedTriggerIds = definition.triggers
    .map((t) => t.event)
    .filter((id) => triggers.some((r) => r.qualifiedId === id));

  const accumulated = accumulateAlongPath({
    definition,
    actions,
    artifactTypes,
    path,
    subscribedTriggerIds,
  });

  // When the path's `choose-when` conditions narrowed `trigger.event` to a
  // specific subset, hand the narrowed Trigger list to buildTriggerEntries
  // so the resulting union has only those variants. Picker rows that were
  // previously conditionalOnTriggers become unconditional inside the branch.
  const effectiveTriggers = accumulated.narrowedTriggers
    ? definition.triggers.filter((t) =>
        accumulated.narrowedTriggers!.has(t.event),
      )
    : definition.triggers;

  const triggerEntries = buildTriggerEntries({
    triggers: effectiveTriggers,
    registeredTriggers: triggers,
  });

  const entries: VariableEntry[] = [...triggerEntries, buildHealthEntry()];

  if (accumulated.vars.length > 0) {
    entries.push({
      path: "var",
      templateRef: "variables",
      type: "object",
      description: "Variables declared upstream in this run.",
      children: accumulated.vars,
    });
  }

  if (accumulated.artifacts.length > 0) {
    entries.push({
      path: "artifact",
      templateRef: "artifacts",
      type: "object",
      description: "Artifacts produced by upstream actions in this run.",
      children: accumulated.artifacts,
    });
  }

  if (accumulated.repeats.length > 0) {
    entries.push({
      path: "repeat",
      templateRef: "repeat",
      type: "object",
      description: "Current repeat-iteration context.",
      children: accumulated.repeats,
    });
  }

  return { entries };
}

/**
 * Flatten a `VariableScope` tree to the leaf paths, in the order the
 * picker should display them. Object-typed parents are kept _before_ their
 * children so the picker can render headers.
 */
export function flattenScope(scope: VariableScope): VariableEntry[] {
  const out: VariableEntry[] = [];
  const visit = (entries: VariableEntry[]): void => {
    for (const e of entries) {
      out.push(e);
      if (e.children) visit(e.children);
    }
  };
  visit(scope.entries);
  return out;
}
