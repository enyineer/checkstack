/**
 * Deep validation of an automation definition.
 *
 * `AutomationDefinitionSchema` only validates the structural shape —
 * action `config` is typed as `z.record(z.unknown())`, so it never
 * checks a provider action's config against that action's own schema.
 * This walker fills the gap so the editor can surface *any* wrong
 * content, not just structural errors:
 *
 *   - unknown trigger `event` / action `action` ids,
 *   - per-trigger `config` that violates the trigger's versioned `config` schema,
 *   - per-action `config` that violates the action's config schema
 *     (wrong enum value, missing required field, wrong type, AND —
 *     because we validate in strict mode — unknown/typo'd keys).
 *
 * Returned issue `path`s are dot-joinable for display, e.g.
 * `actions.0.config.level` or `triggers.1.event`.
 */
import { z } from "zod";
import type { Versioned } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import {
  AutomationDefinitionSchema,
  type ActionInput,
  type AutomationDefinition,
} from "@checkstack/automation-common";
import type { ActionRegistry } from "./action-registry";
import type { TriggerRegistry } from "./trigger-registry";

export interface DefinitionIssue {
  path: Array<string | number>;
  message: string;
}

/**
 * Minimal connection lookup the connectionId check needs. The router wires
 * this to `IntegrationApi.listConnections` (per provider); tests inject a
 * fake. Returns the ids of every configured connection for a provider, or
 * `undefined` when the lookup itself failed (so we can degrade to a softer
 * "could not verify" message rather than a false "unknown connection").
 */
export interface IntegrationConnectionLookup {
  listConnectionIds(params: {
    providerId: string;
  }): Promise<string[] | undefined>;
}

export interface ValidateDefinitionDeps {
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
  /**
   * Optional integration-connection lookup. When present, every provider
   * action whose `config.connectionId` is a literal id is checked against the
   * real connections configured for that action's provider. When omitted (e.g.
   * the structural-only editor dry-run), the connectionId check is skipped.
   */
  connectionLookup?: IntegrationConnectionLookup;
}

/**
 * Validate a definition both structurally and semantically. Returns an
 * empty array when the definition is fully valid.
 *
 * Structural errors short-circuit the semantic pass: if the top-level
 * shape is wrong we can't reliably walk the action tree, so we return
 * the structural issues alone and let the operator fix those first.
 */
export async function collectDefinitionIssues(
  definition: unknown,
  deps: ValidateDefinitionDeps,
): Promise<DefinitionIssue[]> {
  const parsed = AutomationDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => toPathSegment(segment)),
      message: issue.message,
    }));
  }

  const issues: DefinitionIssue[] = [];
  await validateTriggers(parsed.data, deps, issues);
  await validateActionList(parsed.data.actions, ["actions"], deps, issues);
  validateActionIds(parsed.data.actions, ["actions"], deps, issues);
  validateArtifactWiring(parsed.data, deps, issues);
  if (deps.connectionLookup) {
    const connectionIssues = await collectConnectionIdIssues({
      actions: parsed.data.actions,
      resolveConnectionProviderId: (actionId) =>
        deps.actionRegistry.getAction(actionId)?.connectionProviderId,
      connectionLookup: deps.connectionLookup,
    });
    issues.push(...connectionIssues);
  }
  return issues;
}

// ─── Semantic action-id validation ──────────────────────────────────────

/**
 * Walk the entire action tree and enforce the two artifact-reference
 * invariants the structural zod pass can't:
 *
 *   1. Every action `id` is unique within the automation (so
 *      `artifacts.<id>.<name>` is unambiguous).
 *   2. Any provider action whose registered action declares a truthy
 *      `produces` MUST carry an `id` (so the produced artifact is
 *      referenceable).
 *
 * Identifier-format is already enforced by the zod schema in the
 * structural pass, so we don't re-check it here.
 */
function validateActionIds(
  actions: ActionInput[],
  basePath: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): void {
  const seen = new Set<string>();
  walkActionIds(actions, basePath, deps, seen, issues);
}

function walkActionIds(
  actions: ActionInput[],
  basePath: Array<string | number>,
  deps: ValidateDefinitionDeps,
  seen: Set<string>,
  issues: DefinitionIssue[],
): void {
  for (const [index, action] of actions.entries()) {
    walkActionId(action, [...basePath, index], deps, seen, issues);
  }
}

function walkActionId(
  action: ActionInput,
  path: Array<string | number>,
  deps: ValidateDefinitionDeps,
  seen: Set<string>,
  issues: DefinitionIssue[],
): void {
  if (typeof action.id === "string") {
    if (seen.has(action.id)) {
      issues.push({
        path: [...path, "id"],
        message: `Action id "${action.id}" must be unique within the automation`,
      });
    } else {
      seen.add(action.id);
    }
  }

  if ("action" in action) {
    const registered = deps.actionRegistry.getAction(action.action);
    if (registered?.produces && !action.id) {
      issues.push({
        path: [...path, "id"],
        message:
          "Actions that produce an artifact must have an id so the artifact can be referenced as artifacts.<id>.<name>",
      });
    }
    return;
  }

  if ("choose" in action) {
    for (const [branchIndex, branch] of action.choose.entries()) {
      walkActionIds(
        branch.sequence,
        [...path, "choose", branchIndex, "sequence"],
        deps,
        seen,
        issues,
      );
    }
    if (action.else) {
      walkActionIds(action.else, [...path, "else"], deps, seen, issues);
    }
    return;
  }

  if ("parallel" in action) {
    walkActionIds(action.parallel, [...path, "parallel"], deps, seen, issues);
    return;
  }

  if ("repeat" in action) {
    walkActionIds(
      action.repeat.sequence,
      [...path, "repeat", "sequence"],
      deps,
      seen,
      issues,
    );
    return;
  }

  if ("sequence" in action) {
    walkActionIds(action.sequence, [...path, "sequence"], deps, seen, issues);
    return;
  }

  // delay / variables / condition / stop / wait_for_trigger have no child
  // action lists and don't produce artifacts — nothing more to walk.
}

// ─── Artifact / template wiring validation ──────────────────────────────

/**
 * Match an `artifacts.<id>.<artifactType>` reference inside a `{{ ... }}`
 * template, capturing BOTH path segments. Each segment can be written in dot
 * form (`artifacts.foo.bar`) or the bracket form the editor emits for
 * non-identifier ids (`artifacts["foo"]["bar"]`); the two forms can be mixed.
 *
 *   match[1] / match[2] - the producing action id  (dot / bracket form)
 *   match[3] / match[4] - the artifact-type segment (dot / bracket form),
 *                         absent for a bare whole-object `artifacts.<id>` ref
 */
const ARTIFACT_REF_RE =
  /\bartifacts\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])(?:\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\]))?/g;

/**
 * Scan every action config + condition in the definition for
 * `{{ artifacts.<id>.<artifactType>... }}` references and flag two failure
 * modes:
 *
 *   1. The producer `<id>` does not exist (no action carries that id AND
 *      declares a `produces`) - a fabricated artifact id.
 *   2. The `<id>` exists but the `<artifactType>` segment is wrong - the model
 *      dropped or mistyped it (e.g. `artifacts.search.found` instead of
 *      `artifacts.search.issue_search.found`), which silently resolves to
 *      `undefined` at run time and makes any gate misfire.
 *
 * Conservative on purpose: artifacts are keyed in scope by the PRODUCING
 * action's `id` then its local artifact name (`artifacts.<actionId>.<localName>`),
 * so we collect producers across the WHOLE definition (not just lexically-earlier
 * ones) - legitimate cross-branch / reordered references never false-positive. A
 * bare `artifacts.<id>` (no second segment) is the whole-object ref and is left
 * alone.
 */
function validateArtifactWiring(
  definition: AutomationDefinition,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): void {
  const producers = collectProducers(definition.actions, deps);
  walkArtifactRefs(definition.actions, ["actions"], producers, issues);
}

/**
 * The artifact producers in the tree, mapping each producing action's `id` to
 * the LOCAL artifact name it exposes in scope (the registered `produces` with
 * the owning plugin prefix stripped, e.g. `integration-jira.issue_search` →
 * `issue_search`). This mirrors the dispatch engine's scope write exactly, so
 * the validator and the run-time scope key on the same name.
 */
function collectProducers(
  actions: ActionInput[],
  deps: ValidateDefinitionDeps,
): Map<string, string> {
  const producers = new Map<string, string>();
  const visit = (list: ActionInput[]): void => {
    for (const action of list) {
      if ("action" in action) {
        const registered = deps.actionRegistry.getAction(action.action);
        if (registered?.produces && typeof action.id === "string") {
          const prefix = `${registered.ownerPluginId}.`;
          const localName = registered.produces.startsWith(prefix)
            ? registered.produces.slice(prefix.length)
            : registered.produces;
          producers.set(action.id, localName);
        }
        continue;
      }
      if ("choose" in action) {
        for (const branch of action.choose) visit(branch.sequence);
        if (action.else) visit(action.else);
        continue;
      }
      if ("parallel" in action) {
        visit(action.parallel);
        continue;
      }
      if ("repeat" in action) {
        visit(action.repeat.sequence);
        continue;
      }
      if ("sequence" in action) {
        visit(action.sequence);
        continue;
      }
    }
  };
  visit(actions);
  return producers;
}

function walkArtifactRefs(
  actions: ActionInput[],
  basePath: Array<string | number>,
  producers: Map<string, string>,
  issues: DefinitionIssue[],
): void {
  for (const [index, action] of actions.entries()) {
    const path = [...basePath, index];

    if ("action" in action) {
      scanValueForArtifactRefs(
        action.config,
        [...path, "config"],
        producers,
        issues,
      );
      continue;
    }

    if ("choose" in action) {
      for (const [branchIndex, branch] of action.choose.entries()) {
        scanConditionForArtifactRefs(
          branch.when,
          [...path, "choose", branchIndex, "when"],
          producers,
          issues,
        );
        walkArtifactRefs(
          branch.sequence,
          [...path, "choose", branchIndex, "sequence"],
          producers,
          issues,
        );
      }
      if (action.else) {
        walkArtifactRefs(action.else, [...path, "else"], producers, issues);
      }
      continue;
    }

    if ("condition" in action) {
      scanConditionForArtifactRefs(
        action.condition,
        [...path, "condition"],
        producers,
        issues,
      );
      continue;
    }

    if ("variables" in action) {
      scanValueForArtifactRefs(
        action.variables,
        [...path, "variables"],
        producers,
        issues,
      );
      continue;
    }

    if ("parallel" in action) {
      walkArtifactRefs(action.parallel, [...path, "parallel"], producers, issues);
      continue;
    }

    if ("repeat" in action) {
      walkArtifactRefs(
        action.repeat.sequence,
        [...path, "repeat", "sequence"],
        producers,
        issues,
      );
      continue;
    }

    if ("sequence" in action) {
      walkArtifactRefs(action.sequence, [...path, "sequence"], producers, issues);
      continue;
    }
  }
}

/**
 * Recursively walk an arbitrary config value, scanning every string for
 * `{{ artifacts.<id>... }}` references. Object/array structure is preserved in
 * the issue path so the editor can point at the offending field.
 */
function scanValueForArtifactRefs(
  value: unknown,
  path: Array<string | number>,
  producers: Map<string, string>,
  issues: DefinitionIssue[],
): void {
  if (typeof value === "string") {
    scanStringForArtifactRefs(value, path, producers, issues);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanValueForArtifactRefs(item, [...path, index], producers, issues);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      scanValueForArtifactRefs(item, [...path, key], producers, issues);
    }
  }
}

/**
 * A condition is either a bare-expression string or a structured node.
 * Unlike a template field, a condition string is the WHOLE expression (no
 * `{{ }}` wrapper — that is rejected by the schema), so its artifact refs are
 * scanned over the entire string. The combinator nodes (`and` / `or` / `not`)
 * nest further conditions; `numeric_state.value` is itself a bare expression;
 * `time` / `state` carry no artifact refs.
 */
function scanConditionForArtifactRefs(
  condition: unknown,
  path: Array<string | number>,
  producers: Map<string, string>,
  issues: DefinitionIssue[],
): void {
  if (typeof condition === "string") {
    scanExpressionForArtifactRefs(condition, path, producers, issues);
    return;
  }
  if (condition === null || typeof condition !== "object") return;
  if ("and" in condition && Array.isArray(condition.and)) {
    for (const [i, c] of condition.and.entries()) {
      scanConditionForArtifactRefs(c, [...path, "and", i], producers, issues);
    }
    return;
  }
  if ("or" in condition && Array.isArray(condition.or)) {
    for (const [i, c] of condition.or.entries()) {
      scanConditionForArtifactRefs(c, [...path, "or", i], producers, issues);
    }
    return;
  }
  if ("not" in condition) {
    scanConditionForArtifactRefs(
      condition.not,
      [...path, "not"],
      producers,
      issues,
    );
    return;
  }
  if ("numeric_state" in condition) {
    const node = condition.numeric_state;
    if (node !== null && typeof node === "object" && "value" in node) {
      const { value } = node;
      if (typeof value === "string") {
        scanExpressionForArtifactRefs(
          value,
          [...path, "numeric_state", "value"],
          producers,
          issues,
        );
      }
    }
  }
  // `time` / `state` carry no artifact refs.
}

/**
 * Scan a TEMPLATE field's string: only inside `{{ ... }}` spans, so a literal
 * mention of the word "artifacts" in prose never triggers a false positive.
 */
function scanStringForArtifactRefs(
  text: string,
  path: Array<string | number>,
  producers: Map<string, string>,
  issues: DefinitionIssue[],
): void {
  for (const span of extractTemplateSpans(text)) {
    checkArtifactRefsInText(span, path, producers, issues);
  }
}

/**
 * Scan an EXPRESSION field's string (a bare expression). The whole string is
 * the expression, so artifact refs are matched directly without a `{{ }}`
 * wrapper.
 */
function scanExpressionForArtifactRefs(
  text: string,
  path: Array<string | number>,
  producers: Map<string, string>,
  issues: DefinitionIssue[],
): void {
  checkArtifactRefsInText(text, path, producers, issues);
}

/**
 * Run the `artifacts.<id>.<artifactType>` ref check over a single chunk of
 * source (a template span body, or a whole bare expression).
 */
function checkArtifactRefsInText(
  source: string,
  path: Array<string | number>,
  producers: Map<string, string>,
  issues: DefinitionIssue[],
): void {
  ARTIFACT_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ARTIFACT_REF_RE.exec(source)) !== null) {
    const id = match[1] ?? match[2];
    if (!id) continue;
    if (!producers.has(id)) {
      issues.push({
        path,
        message: `Reference to artifacts.${id} but no earlier action with id "${id}" produces an artifact. Give the producing action that id, or fix the reference.`,
      });
      continue;
    }
    // The producer exists. Its output is exposed as
    // `artifacts.<id>.<localName>.<field>`, so the segment right after <id>
    // MUST be the producer's local artifact name. A bare `artifacts.<id>`
    // (no second segment) is the whole-object ref and is fine; a present-but-
    // wrong segment silently resolves to undefined at run time.
    const artifactType = match[3] ?? match[4];
    const localName = producers.get(id);
    if (artifactType !== undefined && artifactType !== localName) {
      issues.push({
        path,
        message: `Reference to artifacts.${id}.${artifactType} but action "${id}" produces "${localName}". Reference it as artifacts.${id}.${localName}.<field>.`,
      });
    }
  }
}

/** Extract the bodies of every `{{ ... }}` span in a template string. */
function extractTemplateSpans(text: string): string[] {
  const spans: string[] = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[1] !== undefined) spans.push(match[1]);
  }
  return spans;
}

// ─── Connection-id validation ───────────────────────────────────────────

/**
 * Resolve the integration provider an action is bound to (its registered
 * `connectionProviderId`), or `undefined` for non-connection actions. Abstract
 * so both the registry-backed editor path and the RPC-backed propose path can
 * drive the same connectionId walk.
 */
export type ResolveConnectionProviderId = (
  actionId: string,
) => string | undefined;

/**
 * For each provider action bound to an integration provider
 * (`connectionProviderId`) whose `config.connectionId` is a literal id, verify
 * a connection with that id exists for the provider. Template-valued
 * connectionIds (`${{ ... }}` / `{{ ... }}`) are left to run-time resolution.
 *
 * Exported so the AI propose path can run the SAME check against the
 * user-scoped integration client (whose `listConnections` access check applies
 * exactly as a direct call would), reusing this walk instead of duplicating it.
 */
export async function collectConnectionIdIssues({
  actions,
  basePath = ["actions"],
  resolveConnectionProviderId,
  connectionLookup,
}: {
  actions: ActionInput[];
  basePath?: Array<string | number>;
  resolveConnectionProviderId: ResolveConnectionProviderId;
  connectionLookup: IntegrationConnectionLookup;
}): Promise<DefinitionIssue[]> {
  const issues: DefinitionIssue[] = [];
  // Cache per-provider lookups so an automation with many actions on the same
  // provider hits the integration lookup once per provider, not once per action.
  const cache = new Map<string, Promise<string[] | undefined>>();
  await walkConnectionIds({
    actions,
    basePath,
    resolveConnectionProviderId,
    connectionLookup,
    cache,
    issues,
  });
  return issues;
}

async function walkConnectionIds({
  actions,
  basePath,
  resolveConnectionProviderId,
  connectionLookup,
  cache,
  issues,
}: {
  actions: ActionInput[];
  basePath: Array<string | number>;
  resolveConnectionProviderId: ResolveConnectionProviderId;
  connectionLookup: IntegrationConnectionLookup;
  cache: Map<string, Promise<string[] | undefined>>;
  issues: DefinitionIssue[];
}): Promise<void> {
  for (const [index, action] of actions.entries()) {
    const path = [...basePath, index];

    if ("action" in action) {
      await checkConnectionId({
        action,
        path,
        resolveConnectionProviderId,
        connectionLookup,
        cache,
        issues,
      });
      continue;
    }
    if ("choose" in action) {
      for (const [branchIndex, branch] of action.choose.entries()) {
        await walkConnectionIds({
          actions: branch.sequence,
          basePath: [...path, "choose", branchIndex, "sequence"],
          resolveConnectionProviderId,
          connectionLookup,
          cache,
          issues,
        });
      }
      if (action.else) {
        await walkConnectionIds({
          actions: action.else,
          basePath: [...path, "else"],
          resolveConnectionProviderId,
          connectionLookup,
          cache,
          issues,
        });
      }
      continue;
    }
    if ("parallel" in action) {
      await walkConnectionIds({
        actions: action.parallel,
        basePath: [...path, "parallel"],
        resolveConnectionProviderId,
        connectionLookup,
        cache,
        issues,
      });
      continue;
    }
    if ("repeat" in action) {
      await walkConnectionIds({
        actions: action.repeat.sequence,
        basePath: [...path, "repeat", "sequence"],
        resolveConnectionProviderId,
        connectionLookup,
        cache,
        issues,
      });
      continue;
    }
    if ("sequence" in action) {
      await walkConnectionIds({
        actions: action.sequence,
        basePath: [...path, "sequence"],
        resolveConnectionProviderId,
        connectionLookup,
        cache,
        issues,
      });
      continue;
    }
  }
}

async function checkConnectionId({
  action,
  path,
  resolveConnectionProviderId,
  connectionLookup,
  cache,
  issues,
}: {
  action: Extract<ActionInput, { action: string }>;
  path: Array<string | number>;
  resolveConnectionProviderId: ResolveConnectionProviderId;
  connectionLookup: IntegrationConnectionLookup;
  cache: Map<string, Promise<string[] | undefined>>;
  issues: DefinitionIssue[];
}): Promise<void> {
  const providerId = resolveConnectionProviderId(action.action);
  if (!providerId) return;

  const connectionId = readConnectionId(action.config);
  if (connectionId === undefined) return;
  // A templated connectionId is resolved at run time; nothing to verify here.
  if (connectionId.includes("{{") || connectionId.includes("${{")) return;

  let pending = cache.get(providerId);
  if (!pending) {
    pending = connectionLookup.listConnectionIds({ providerId });
    cache.set(providerId, pending);
  }
  const connectionIds = await pending;
  // Lookup itself failed - degrade to a soft note rather than a false unknown.
  if (connectionIds === undefined) {
    issues.push({
      path: [...path, "config", "connectionId"],
      message: `Could not verify connectionId "${connectionId}" for action "${action.action}" - the integration connections could not be listed. Use automation.listConnections to confirm it exists.`,
    });
    return;
  }
  if (!connectionIds.includes(connectionId)) {
    issues.push({
      path: [...path, "config", "connectionId"],
      message: `Action "${action.action}" references unknown connectionId "${connectionId}". Call automation.listConnections to pick a configured connection for this provider.`,
    });
  }
}

/** Read a literal `connectionId` string from an action config, if present. */
function readConnectionId(config: unknown): string | undefined {
  if (config === null || typeof config !== "object") return undefined;
  const value = (config as Record<string, unknown>).connectionId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function validateTriggers(
  definition: AutomationDefinition,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): Promise<void> {
  for (const [index, trigger] of definition.triggers.entries()) {
    const registered = deps.triggerRegistry.getTrigger(trigger.event);
    if (!registered) {
      issues.push({
        path: ["triggers", index, "event"],
        message: `Unknown trigger event "${trigger.event}"`,
      });
      continue;
    }
    if (registered.config) {
      // Migrate-then-STRICT: removed/renamed trigger config fields are
      // migrated away before validation, but real typos still surface.
      await collectVersionedIssues({
        config: registered.config,
        value: trigger.config ?? {},
        basePath: ["triggers", index, "config"],
        issues,
      });
    }
  }
}

async function validateActionList(
  actions: ActionInput[],
  basePath: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): Promise<void> {
  for (const [index, action] of actions.entries()) {
    await validateAction(action, [...basePath, index], deps, issues);
  }
}

async function validateAction(
  action: ActionInput,
  path: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): Promise<void> {
  if ("action" in action) {
    const registered = deps.actionRegistry.getAction(action.action);
    if (!registered) {
      issues.push({
        path: [...path, "action"],
        message: `Unknown action "${action.action}"`,
      });
      return;
    }
    // Migrate-then-STRICT (assume-v1-on-read): a stored config that
    // carries a now-removed key (e.g. `sandbox`) is migrated away before
    // validation, so it no longer surfaces as "Unrecognized key" in the
    // editor — while genuine typos the migration doesn't account for still
    // do.
    await collectVersionedIssues({
      config: registered.config,
      value: action.config,
      basePath: [...path, "config"],
      issues,
    });
    return;
  }

  if ("choose" in action) {
    for (const [branchIndex, branch] of action.choose.entries()) {
      await validateActionList(
        branch.sequence,
        [...path, "choose", branchIndex, "sequence"],
        deps,
        issues,
      );
    }
    if (action.else) {
      await validateActionList(action.else, [...path, "else"], deps, issues);
    }
    return;
  }

  if ("parallel" in action) {
    await validateActionList(
      action.parallel,
      [...path, "parallel"],
      deps,
      issues,
    );
    return;
  }

  if ("repeat" in action) {
    await validateActionList(
      action.repeat.sequence,
      [...path, "repeat", "sequence"],
      deps,
      issues,
    );
    return;
  }

  if ("sequence" in action) {
    await validateActionList(
      action.sequence,
      [...path, "sequence"],
      deps,
      issues,
    );
    return;
  }

  // delay / variables / condition / stop / wait_for_trigger carry no
  // provider config to deep-validate — their structure is already fully
  // covered by AutomationDefinitionSchema.
}

/**
 * Migrate (assuming the stored value was written at v1) then STRICT-parse
 * a `Versioned` config, pushing any resulting Zod issues. Migration errors
 * (a broken chain or a throwing `migrate`) are reported as a config issue
 * rather than thrown, so one bad action can't abort the whole validation.
 */
async function collectVersionedIssues({
  config,
  value,
  basePath,
  issues,
}: {
  config: Versioned<unknown>;
  value: unknown;
  basePath: Array<string | number>;
  issues: DefinitionIssue[];
}): Promise<void> {
  try {
    await config.parseStrictAssumingV1(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      pushZodIssues(error, basePath, issues);
      return;
    }
    issues.push({
      path: basePath,
      message: extractErrorMessage(error),
    });
  }
}

function pushZodIssues(
  error: z.ZodError,
  basePath: Array<string | number>,
  issues: DefinitionIssue[],
): void {
  for (const issue of error.issues) {
    issues.push({
      path: [...basePath, ...issue.path.map((segment) => toPathSegment(segment))],
      message: issue.message,
    });
  }
}

/**
 * Zod issue paths are `PropertyKey[]` (string | number | symbol). The
 * automation contract's issue path is `(string | number)[]`, so coerce
 * the rare symbol segment to its string form.
 */
function toPathSegment(segment: PropertyKey): string | number {
  return typeof segment === "number" || typeof segment === "string"
    ? segment
    : String(segment);
}
