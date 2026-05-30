/**
 * Action / Trigger / Artifact-Type definition contracts.
 *
 * Plugins contribute to the automation platform by implementing these
 * interfaces and registering them through the corresponding extension
 * points (see `extension-points.ts`). All backend-only types live here;
 * frontend code uses the zod schemas exported from
 * `@checkstack/automation-common`.
 */
import { z } from "zod";
import type {
  Hook,
  Logger,
  ServiceRef,
  Versioned,
} from "@checkstack/backend-api";
import type { Actor, LucideIconName } from "@checkstack/common";

// ─── Artifact types ────────────────────────────────────────────────────────

/**
 * Reference to an artifact type.
 *
 * In a {@link ActionDefinition} (`produces` / `consumes`) this is the
 * **local** artifact-type id (e.g. `"issue"`) — the action registry
 * prefixes it with the owning plugin's id at registration, exactly as it
 * qualifies the action's own `id`, yielding the fully-qualified id (e.g.
 * `"integration-jira.issue"`). On a {@link RegisteredAction}, `produces`
 * is already qualified.
 */
export type ArtifactTypeRef = string;

/**
 * Definition of an artifact type. Plugins register these so their actions
 * can declare `produces` / `consumes` against a typed schema rather than
 * an opaque blob.
 *
 * The `data` field of an artifact is validated against this schema before
 * persistence.
 *
 * @template T — the runtime shape of the artifact `data`.
 */
export interface ArtifactTypeDefinition<T = unknown> {
  /** Local id; namespaced on registration to `{pluginId}.{id}`. */
  id: string;
  /** Display name for UI listings. */
  displayName: string;
  description?: string;
  /** Zod schema for the artifact's `data` payload. */
  schema: z.ZodType<T>;
}

export interface RegisteredArtifactType<T = unknown>
  extends ArtifactTypeDefinition<T> {
  /** Fully qualified id (`{pluginId}.{id}`). */
  qualifiedId: string;
  ownerPluginId: string;
  /** JSON Schema view of `schema` for UI consumption. */
  jsonSchema: Record<string, unknown>;
}

// ─── Triggers ──────────────────────────────────────────────────────────────

/**
 * Optional setup callback used by non-hook triggers (cron, interval,
 * polling templates). The trigger registers its own listening mechanism
 * (queue scheduled jobs, intervals, etc.) and calls `fire` when it should
 * emit an event into the dispatch engine.
 *
 * Returns a cleanup function that must tear the listener down when the
 * automation is disabled or deleted.
 */
export type TriggerSetupFn<TPayload, TConfig> = (params: {
  /** Per-automation trigger config (e.g. cron pattern). */
  config: TConfig;
  /** Stable identity of the automation + trigger combination this setup is for. */
  identity: {
    automationId: string;
    triggerId: string;
  };
  /** Fire the trigger. Dispatch engine will route the payload. */
  fire: (payload: TPayload) => Promise<void>;
  logger: Logger;
}) => Promise<TriggerTeardown>;

/**
 * Cleanup callback returned by `setup`. Called when the automation that
 * subscribed is disabled, deleted, or its definition changes.
 */
export type TriggerTeardown = () => Promise<void>;

/**
 * Trigger definition. A plugin describes an event the platform can react
 * to. Two flavours:
 *
 *   - **Hook-backed:** provide a `hook` reference. The automation backend
 *     subscribes via `onHook` in work-queue mode and routes each emission
 *     through `fire` for any automation that selected this trigger.
 *   - **Setup-backed:** provide `setup` (and optional `configSchema`). The
 *     automation backend invokes `setup` per-automation; the trigger
 *     manages its own emission mechanism (cron schedule, interval, etc.).
 *
 * Exactly one of `hook` / `setup` should be set. Setting neither means
 * the trigger can only be fired through `manualRun`.
 */
export interface TriggerDefinition<
  TPayload = unknown,
  TConfig = void,
> {
  /** Local id; namespaced on registration to `{pluginId}.{id}`. */
  id: string;
  displayName: string;
  description?: string;
  /** UI grouping. Defaults to "Uncategorized". */
  category?: string;
  icon?: LucideIconName;

  /** Zod schema for the trigger's payload. */
  payloadSchema: z.ZodType<TPayload>;
  /**
   * Optional config schema. Required when `setup` is provided and the
   * trigger needs per-automation configuration (e.g. cron pattern).
   */
  configSchema?: z.ZodType<TConfig>;

  /**
   * Extract a durable lookup key from the payload — typically the entity
   * id this trigger is "about" (e.g. `incidentId` for incident triggers,
   * `systemId` for system triggers).
   *
   * Used to scope artifact lookups and to match `wait_for_trigger` waits
   * to the right incoming event.
   */
  contextKey?: (payload: TPayload) => string | undefined;

  /** Hook-backed flavour. */
  hook?: Hook<TPayload>;
  /** Setup-backed flavour. */
  setup?: TriggerSetupFn<TPayload, TConfig>;

  /**
   * Optional structured config gate for hook-backed triggers. When set,
   * the trigger fan-in calls this with the incoming payload + the
   * per-automation trigger `config` BEFORE starting a run; a `false`
   * result skips the firing for that automation (in addition to, and
   * before, the operator's template `filter`).
   *
   * Used by structured triggers like `numeric_state` whose firing depends
   * on typed config (`field` / `above` / `below`) rather than a
   * hand-written filter expression. Pure + synchronous — no I/O.
   */
  evaluateConfig?: (payload: TPayload, config: TConfig) => boolean;
}

export interface RegisteredTrigger<TPayload = unknown, TConfig = unknown>
  extends Omit<TriggerDefinition<TPayload, TConfig>, "configSchema"> {
  qualifiedId: string;
  ownerPluginId: string;
  payloadJsonSchema: Record<string, unknown>;
  configJsonSchema?: Record<string, unknown>;
  /** Preserved here so the dispatch engine can re-validate config on load. */
  configSchema?: z.ZodType<TConfig>;
}

// ─── Actions ───────────────────────────────────────────────────────────────

/**
 * Result returned by an action's `execute` callback.
 *
 * - `success: true` and an optional `artifact` means the action did its
 *   job; the platform persists the artifact (typed against the declared
 *   `produces` schema) and continues dispatch.
 * - `success: false` triggers either a halt or, if the action has
 *   `continue_on_error: true`, logged-and-skipped behaviour.
 * - `retryAfterMs` is honoured by the queue when set.
 */
export interface ActionResult<TArtifact = unknown> {
  success: boolean;
  /** Produced artifact data; validated against the action's `produces` type. */
  artifact?: TArtifact;
  /** External system identifier — exposed in run-step logs for audit. */
  externalId?: string;
  error?: string;
  retryAfterMs?: number;
}

/**
 * The full run scope handed to an action's `execute`, mirroring the
 * shape the dispatch engine exposes to `{{ }}` template rendering. Lets
 * broad-context actions (notably the script actions) build a typed
 * `context` object or flatten the scope into shell env vars, without
 * having to declare every artifact type in `consumes`.
 *
 * Distinct from {@link ActionExecutionContext.consumedArtifacts}, which
 * is the narrow, explicitly-declared `consumes` subset.
 */
export interface ActionRunScope {
  /** The trigger that started this run, plus its raw payload. */
  trigger: {
    /**
     * The id of the specific trigger declaration that fired. Distinguishes
     * triggers within an automation - including two triggers on the same
     * `event` - so scripts/templates can branch on which one fired.
     */
    id: string;
    /** Fully-qualified trigger event id (e.g. `incident.created`). */
    event: string;
    /** Who/what caused the event (system, user, application, or service). */
    actor: Actor;
    /** Trigger payload exactly as emitted. */
    payload: Record<string, unknown>;
  };
  /**
   * Artifacts produced by upstream actions in this run, keyed by artifact
   * type (`jira.issue`) and, when the producing action set an `id`, by
   * that id too.
   */
  artifacts: Record<string, unknown>;
  /** Variables declared upstream via `variables` actions. */
  vars: Record<string, unknown>;
  /**
   * Present only when the action runs inside a `repeat` block: the
   * current iteration index and (for `for_each`) the current item.
   */
  repeat?: { index: number; item?: unknown };
}

/**
 * Execution context handed to an action's `execute` callback.
 *
 * `config` is already rendered — any `{{ }}` interpolation in the source
 * automation has been resolved against the run scope before this call.
 * Note: fields flagged as native-code editors (`x-editor-types` of
 * `shell` / `typescript` / `javascript`) are passed through verbatim and
 * are NOT template-rendered — script actions read run data from `scope`
 * (TS `context`) or injected env vars (shell), not from `{{ }}`.
 *
 * `consumedArtifacts` is the dispatch engine's resolution of upstream
 * artifacts the action declared in `consumes`. Lookup is by artifact type
 * within the current run's scope (`(automationId, contextKey, type)`).
 */
export interface ActionExecutionContext<TConfig = unknown> {
  /** Resolved config — templates rendered against the run scope. */
  config: TConfig;
  /**
   * Upstream artifacts the action consumes, keyed by their type
   * (`jira.issue`, `teams.message`, …). Undefined entries mean "not
   * found" — the action decides how to react.
   */
  consumedArtifacts: Record<string, unknown>;
  /**
   * Full run scope (trigger + all upstream artifacts + vars). Use this
   * for actions that need broad context (e.g. a script action building a
   * `context` object or shell env vars). Prefer `consumedArtifacts` when
   * you only need specific declared artifact types.
   *
   * Always populated by the dispatch engine at run time; optional only so
   * unit tests that exercise an action's `execute` directly may omit it.
   */
  scope?: ActionRunScope;

  /** Run identity. */
  runId: string;
  automationId: string;
  /** Durable lookup key for the current run (typically `incidentId`). */
  contextKey: string | null;

  /** Scoped logger — log lines surface in the run-detail UI. */
  logger: Logger;
  /**
   * Resolve a platform service. Mirrors the standard plugin DI pattern so
   * actions can use, e.g., the integration connection store.
   */
  getService: <T>(ref: ServiceRef<T>) => Promise<T>;
}

/**
 * Action definition. Plugins register actions to expose callable work to
 * the automation editor.
 *
 * @template TConfig — per-action-invocation configuration.
 * @template TArtifact — shape of artifact this action produces, if any.
 */
export interface ActionDefinition<
  TConfig = unknown,
  TArtifact = unknown,
> {
  /** Local id; namespaced on registration to `{pluginId}.{id}`. */
  id: string;
  displayName: string;
  description?: string;
  /** UI grouping. Defaults to "Uncategorized". */
  category?: string;
  icon?: LucideIconName;

  /** Per-invocation configuration schema. Versioned for safe migration. */
  config: Versioned<TConfig>;

  /**
   * Local id of the artifact type this action produces, if any (e.g.
   * `"issue"`). The registry qualifies it with the owning plugin id.
   */
  produces?: ArtifactTypeRef;
  /**
   * Local ids of the artifact types this action consumes — resolved from
   * upstream scope within the owning plugin's namespace. `consumedArtifacts`
   * is keyed by these same local ids.
   */
  consumes?: ArtifactTypeRef[];

  /**
   * Connection-backed actions (e.g. Jira) set this to the fully-qualified
   * integration provider id (`{pluginId}.{providerId}`) whose connection
   * store + `getConnectionOptions` resolvers supply this action's config
   * dropdowns. When present, the editor renders a connection picker and
   * bridges the action's `x-options-resolver` config fields to that
   * provider. Derive it from the provider plugin's own `pluginMetadata`
   * rather than a hardcoded string so it can't drift if the plugin is
   * renamed.
   */
  connectionProviderId?: string;

  /**
   * Run the action.
   */
  execute: (
    context: ActionExecutionContext<TConfig>,
  ) => Promise<ActionResult<TArtifact>>;
}

export interface RegisteredAction<TConfig = unknown, TArtifact = unknown>
  extends ActionDefinition<TConfig, TArtifact> {
  qualifiedId: string;
  ownerPluginId: string;
  /** JSON Schema view of the config schema. */
  configJsonSchema: Record<string, unknown>;
}
