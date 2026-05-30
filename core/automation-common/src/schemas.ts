import { z } from "zod";

/**
 * Schemas for the Automation platform.
 *
 * The data model mirrors Home Assistant's automation editor:
 *
 *   - An **automation** has a list of **triggers** (event entry points),
 *     optional **conditions** that gate the whole run, and a list of
 *     **actions** (the work to do).
 *   - Each action is one of nine primitive types. The discriminator is the
 *     presence of a key (`action`, `choose`, `parallel`, `delay`, `repeat`,
 *     `variables`, `condition`, `stop`, `wait_for_trigger`) — there's no
 *     `kind:` field.
 *   - Conditions and templated values use the shared template engine
 *     (`@checkstack/template-engine`).
 *
 * The automation definition is the source of truth — stored as JSON in the
 * `automations.definition` column, also round-tripped from YAML in the UI.
 */

// ─── Duration ──────────────────────────────────────────────────────────────

/**
 * A duration expressed in a single unit, or a template that renders to a
 * number of seconds. Used by a trigger's `for:` dwell (decision D1). The
 * object form is preferred for the editor's duration widget; the template
 * form is the escape hatch for computed durations.
 */
export const DurationSchema = z.union([
  z.object({ seconds: z.number().int().min(1).max(60 * 60 * 24 * 30) }),
  z.object({ minutes: z.number().int().min(1).max(60 * 24 * 30) }),
  z.object({ hours: z.number().int().min(1).max(24 * 30) }),
  z
    .object({ template: z.string().min(1) })
    .describe("Template rendering to a number of seconds."),
]);

export type Duration = z.infer<typeof DurationSchema>;

/**
 * Resolve a {@link Duration} to milliseconds. The template branch needs a
 * render context, so callers that may receive a template pass a
 * `renderSeconds` resolver. Returns null for an unrenderable / invalid
 * duration.
 */
export function durationToMs(
  duration: Duration,
  renderSeconds?: (template: string) => number | undefined,
): number | null {
  if ("seconds" in duration) return duration.seconds * 1000;
  if ("minutes" in duration) return duration.minutes * 60_000;
  if ("hours" in duration) return duration.hours * 3_600_000;
  const seconds = renderSeconds?.(duration.template);
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.floor(seconds) * 1000;
}

// ─── Trigger ─────────────────────────────────────────────────────────────

/**
 * A trigger is an entry point for an automation. When the underlying event
 * fires (and the filter passes), the automation runs.
 *
 * - `event` is the fully-qualified event id (e.g. `incident.incident.created`).
 * - `id` is an optional discriminator the operator can reference in
 *   `choose: when` clauses (auto-derived from `event` when unique).
 * - `filter` is an optional template returning truthy/falsy to gate the
 *   trigger itself before any action runs.
 * - `config` is the trigger's own configuration — only used by triggers
 *   that need extra setup (cron pattern for `time.cron`, etc.).
 * - `for` is an optional dwell: fire only if the matched state still holds
 *   after the duration (re-confirmed at expiry, restart-safe).
 */
export const TriggerSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/i, "Trigger id must be a slug")
    .optional()
    .describe(
      "Operator-assigned discriminator. Auto-derives from event when unique.",
    ),
  event: z
    .string()
    .min(1)
    .describe("Fully qualified event id (pluginId.hookId)."),
  filter: z
    .string()
    .optional()
    .describe(
      "Optional template returning truthy/falsy. Gates the trigger before the run starts.",
    ),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Per-trigger configuration (e.g. cron pattern for time.cron, interval seconds for time.interval).",
    ),
  for: DurationSchema.optional().describe(
    "Dwell: fire only if the matched state still holds after this duration. Re-confirmed at expiry, restart-safe.",
  ),
});

export type Trigger = z.infer<typeof TriggerSchema>;

// ─── Condition (recursive) ────────────────────────────────────────────────

/**
 * Structured condition variants (Wave 2 Phase 16). Each evaluates over the
 * pre-resolved scope (Phase 14 `health.*`) plus a FRESH `now` computed per
 * evaluation (constraint 7 — never the frozen scope `now`).
 */

/**
 * `numeric_state` — compare a numeric `value` (a template/path string or a
 * literal number) against optional `above` / `below` bounds.
 */
export const NumericStateConditionSchema = z
  .object({
    numeric_state: z.object({
      value: z
        .union([z.string().min(1), z.number()])
        .describe("Template/path string or literal number to compare."),
      above: z.number().optional(),
      below: z.number().optional(),
    }),
  })
  .refine(
    (c) =>
      c.numeric_state.above !== undefined ||
      c.numeric_state.below !== undefined,
    { message: "numeric_state requires at least one of `above` / `below`" },
  );

export type NumericStateCondition = z.infer<
  typeof NumericStateConditionSchema
>;

/**
 * `time` — on-call / quiet-hours gating. `after` / `before` are `HH:mm`
 * (24h). `weekday` is a list of 0-6 (Sunday = 0). `timezone` is an IANA
 * zone (defaults to UTC).
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeConditionSchema = z
  .object({
    time: z.object({
      after: z
        .string()
        .regex(HHMM, "Expected HH:mm (24h)")
        .optional()
        .describe("Inclusive lower bound, local to `timezone`."),
      before: z
        .string()
        .regex(HHMM, "Expected HH:mm (24h)")
        .optional()
        .describe("Exclusive upper bound, local to `timezone`."),
      weekday: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .optional()
        .describe("Allowed weekdays (0 = Sunday … 6 = Saturday)."),
      timezone: z
        .string()
        .min(1)
        .optional()
        .describe("IANA timezone (e.g. `Europe/Berlin`). Defaults to UTC."),
    }),
  })
  .refine(
    (c) =>
      c.time.after !== undefined ||
      c.time.before !== undefined ||
      c.time.weekday !== undefined,
    { message: "time requires at least one of `after` / `before` / `weekday`" },
  );

export type TimeCondition = z.infer<typeof TimeConditionSchema>;

/**
 * `state` — condition-side dwell. True when `entity` (a system id) has been
 * in `status` for at least `for` (read from the pre-resolved
 * `health.*.in_status_for_ms`; NO new timer — it reads, it doesn't time).
 */
export const StateConditionSchema = z.object({
  state: z.object({
    entity: z
      .string()
      .min(1)
      .describe("System id whose live health state to read."),
    status: z
      .enum(["healthy", "degraded", "unhealthy"])
      .describe("Status the entity must currently be in."),
    for: DurationSchema.optional().describe(
      "Optional minimum dwell — the entity must have held `status` at least this long.",
    ),
  }),
});

export type StateCondition = z.infer<typeof StateConditionSchema>;

/**
 * A condition is either:
 *   - A template string that evaluates truthy/falsy,
 *   - A `{ and | or | not }` combinator wrapping nested conditions, OR
 *   - A structured variant (`numeric_state`, `time`, `state`).
 *
 * Recursive — uses `z.lazy` for the combinator branches. The raw template
 * string stays the escape hatch for anything the structured variants don't
 * cover.
 */
export type ConditionInput =
  | string
  | { and: ConditionInput[] }
  | { or: ConditionInput[] }
  | { not: ConditionInput }
  | NumericStateCondition
  | TimeCondition
  | StateCondition;

export const ConditionSchema: z.ZodType<ConditionInput> = z.lazy(() =>
  z.union([
    z
      .string()
      .min(1)
      .describe("Template returning truthy/falsy."),
    z.object({
      and: z.array(ConditionSchema).min(1),
    }),
    z.object({
      or: z.array(ConditionSchema).min(1),
    }),
    z.object({
      not: ConditionSchema,
    }),
    NumericStateConditionSchema,
    TimeConditionSchema,
    StateConditionSchema,
  ]),
);

export type Condition = z.infer<typeof ConditionSchema>;

// ─── Action primitives (recursive discriminated union) ────────────────────

/**
 * Base fields every action carries. `id` is referenced by downstream
 * artifact lookups (`artifacts.<id>.<name>.<field>`) and by run-step audit
 * logs. Every action that PRODUCES an artifact MUST have an `id` (enforced
 * semantically in validate-definition, since the schema can't know which
 * actions produce). `id` must be a valid identifier so it can be used as a
 * plain template segment.
 */
const ActionBase = {
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "Action id must be a valid identifier (letters, digits, underscore; no leading digit)",
    )
    .optional(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  continue_on_error: z.boolean().default(false),
};

/**
 * 1. Provider action — calls a registered action by namespaced id.
 */
export const ProviderActionSchema = z.object({
  ...ActionBase,
  action: z
    .string()
    .min(1)
    .regex(
      /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/i,
      "Action id must be namespaced (plugin.action_name)",
    ),
  config: z.record(z.string(), z.unknown()).default({}),
});

export type ProviderAction = z.infer<typeof ProviderActionSchema>;

// Forward declaration for self-referential Action schemas via z.lazy.
// Exported so downstream packages (and the oRPC contract) can name them.
export type ActionInput =
  | z.infer<typeof ProviderActionSchema>
  | ChooseInput
  | ParallelInput
  | DelayInput
  | RepeatInput
  | VariablesInput
  | ConditionGuardInput
  | StopInput
  | WaitForTriggerInput
  | WaitUntilInput
  | SequenceInput;

export interface ChooseInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  choose: Array<{ when: ConditionInput; sequence: ActionInput[] }>;
  else?: ActionInput[];
}

export interface ParallelInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  parallel: ActionInput[];
}

export interface DelayInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  delay: { seconds: number } | { template: string };
}

export type RepeatMode =
  | { count: number }
  | { for_each: string }
  | { while: string; max_iterations?: number }
  | { until: string; max_iterations?: number };

export interface RepeatInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  repeat: RepeatMode & { sequence: ActionInput[] };
}

export interface VariablesInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  variables: Record<string, unknown>;
}

export interface ConditionGuardInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  condition: ConditionInput;
}

export interface StopInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  stop: { reason?: string; error?: boolean };
}

export interface WaitForTriggerInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  wait_for_trigger: {
    event: string;
    filter?: string;
    timeout_seconds?: number;
    context_key?: string;
  };
}

export interface WaitUntilInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  wait_until: {
    condition: ConditionInput;
    timeout_seconds?: number;
    /** Default true (HA semantics): on timeout, continue rather than fail. */
    continue_on_timeout?: boolean;
    /** How often to re-check the condition (seconds). Default 30. */
    poll_seconds?: number;
  };
}

export interface SequenceInput {
  id?: string;
  description?: string;
  enabled?: boolean;
  continue_on_error?: boolean;
  sequence: ActionInput[];
}

/**
 * 2. Choose — if/elif/else branching.
 */
export const ChooseActionSchema: z.ZodType<ChooseInput> = z.lazy(() =>
  z.object({
    ...ActionBase,
    choose: z
      .array(
        z.object({
          when: ConditionSchema,
          sequence: z.array(ActionSchema).min(1),
        }),
      )
      .min(1),
    else: z.array(ActionSchema).optional(),
  }),
);

/**
 * 3. Parallel — fan out actions concurrently; wait for all.
 */
export const ParallelActionSchema: z.ZodType<ParallelInput> = z.lazy(() =>
  z.object({
    ...ActionBase,
    parallel: z.array(ActionSchema).min(1),
  }),
);

/**
 * 4. Delay — sleep for a fixed or templated number of seconds.
 *
 * Either a plain number of seconds OR a template that renders to one.
 */
export const DelayActionSchema = z.object({
  ...ActionBase,
  delay: z.union([
    z.object({ seconds: z.number().int().min(0).max(86_400) }),
    z.object({ template: z.string().min(1) }),
  ]),
});

/**
 * 5. Repeat — count / for_each / while / until modes.
 *
 * - `count` runs the sequence N times. `repeat.index` is exposed.
 * - `for_each` is a template that renders to a JSON array; the sequence
 *   runs once per item, with `repeat.item` and `repeat.index` exposed.
 * - `while` evaluates a condition before each iteration; loop stops when
 *   it goes false. `max_iterations` defaults to 1000 as a safety net.
 * - `until` evaluates after each iteration; loop stops when it goes true.
 */
export const RepeatActionSchema: z.ZodType<RepeatInput> = z.lazy(() =>
  z.object({
    ...ActionBase,
    repeat: z.union([
      z.object({
        count: z.number().int().min(1).max(10_000),
        sequence: z.array(ActionSchema).min(1),
      }),
      z.object({
        for_each: z.string().min(1),
        sequence: z.array(ActionSchema).min(1),
      }),
      z.object({
        while: z.string().min(1),
        max_iterations: z.number().int().min(1).max(10_000).optional(),
        sequence: z.array(ActionSchema).min(1),
      }),
      z.object({
        until: z.string().min(1),
        max_iterations: z.number().int().min(1).max(10_000).optional(),
        sequence: z.array(ActionSchema).min(1),
      }),
    ]),
  }),
);

/**
 * 6. Variables — define local scoped values for downstream actions.
 *
 * Values can be literals or templates. Templates render at execution time
 * and the rendered value is stored under the variable name in scope.
 */
export const VariablesActionSchema = z.object({
  ...ActionBase,
  variables: z.record(z.string().min(1), z.unknown()).refine(
    (record) => Object.keys(record).length > 0,
    { message: "At least one variable required" },
  ),
});

/**
 * 7. Condition (guard) — mid-run assertion. If false, the run halts
 * (unless `continue_on_error: true`).
 */
export const ConditionGuardActionSchema: z.ZodType<ConditionGuardInput> = z.lazy(
  () =>
    z.object({
      ...ActionBase,
      condition: ConditionSchema,
    }),
);

/**
 * 8. Stop — explicit halt with optional reason and error flag.
 */
export const StopActionSchema = z.object({
  ...ActionBase,
  stop: z.object({
    reason: z.string().optional(),
    error: z.boolean().default(false),
  }),
});

/**
 * 10. Sequence — wrap an ordered list of actions as a single action.
 *
 * Mirrors HA's `sequence:` wrapping. Primary use case: providing a
 * multi-action branch inside `parallel` (each parallel branch is itself
 * an Action, so without this wrapper you'd be limited to one action per
 * branch). Also useful when an `id` / `continue_on_error` should apply
 * to a group of actions atomically.
 *
 * Implementation: identical to walking a top-level `actions:` list.
 */
export const SequenceActionSchema: z.ZodType<SequenceInput> = z.lazy(() =>
  z.object({
    ...ActionBase,
    sequence: z.array(ActionSchema).min(1),
  }),
);

/**
 * 9. Wait for trigger — suspend the run until a matching event arrives.
 *
 * `context_key` defaults to the trigger event's declared context key
 * (typically `incidentId`), so a wait inside an incident.created run
 * matches the incident.resolved event for the same incident.
 */
export const WaitForTriggerActionSchema = z.object({
  ...ActionBase,
  wait_for_trigger: z.object({
    event: z.string().min(1),
    filter: z.string().optional(),
    timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(60 * 60 * 24 * 30) // 30 days
      .optional(),
    context_key: z.string().optional(),
  }),
});

/**
 * 11. Wait until — suspend the run until a CONDITION becomes true, with an
 * optional timeout. Unlike `wait_for_trigger` (wait for an *event*), this
 * polls the condition on an interval, re-resolving live state each tick.
 *
 * `continue_on_timeout` defaults to true (HA's `wait_template` semantics):
 * on timeout the run continues rather than failing.
 */
export const WaitUntilActionSchema: z.ZodType<WaitUntilInput> = z.lazy(() =>
  z.object({
    ...ActionBase,
    wait_until: z.object({
      condition: ConditionSchema,
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(60 * 60 * 24 * 30) // 30 days
        .optional(),
      continue_on_timeout: z.boolean().default(true),
      poll_seconds: z
        .number()
        .int()
        .min(1)
        .max(60 * 60) // 1h max poll interval
        .default(30),
    }),
  }),
);

/**
 * The discriminated union of all 9 action primitives. Discrimination is by
 * presence of a key (action / choose / parallel / etc.), matching the
 * YAML-friendly authoring style.
 *
 * Implemented as `z.union` (zod's `discriminatedUnion` requires a single
 * tag field, which we don't use). The dispatch engine narrows manually.
 */
export const ActionSchema: z.ZodType<ActionInput> = z.lazy(() =>
  z.union([
    ProviderActionSchema,
    ChooseActionSchema,
    ParallelActionSchema,
    DelayActionSchema,
    RepeatActionSchema,
    VariablesActionSchema,
    ConditionGuardActionSchema,
    StopActionSchema,
    WaitForTriggerActionSchema,
    WaitUntilActionSchema,
    SequenceActionSchema,
  ]),
);

export type Action = z.infer<typeof ActionSchema>;

// ─── Execution mode ───────────────────────────────────────────────────────

/**
 * What to do when a trigger fires while a previous run of the same
 * automation is still in progress.
 *
 *   - `single`: skip the new trigger (default; safest for stateful flows).
 *   - `parallel`: start a new run alongside; runs are independent.
 *   - `queued`: queue the new trigger; process after current completes.
 *   - `restart`: abort the in-flight run, start fresh.
 */
export const AutomationModeSchema = z
  .enum(["single", "parallel", "queued", "restart"])
  .default("single");

export type AutomationMode = z.infer<typeof AutomationModeSchema>;

// ─── Automation definition (top-level) ────────────────────────────────────

/**
 * The full definition of an automation. Persisted as JSON in
 * `automations.definition`. Round-trippable to YAML.
 */
export const AutomationDefinitionSchema = z.object({
  /** Operator-visible name. */
  name: z.string().min(1).max(200),
  /** Optional description for the UI / docs. */
  description: z.string().optional(),
  /** Entry points. At least one required. */
  triggers: z.array(TriggerSchema).min(1),
  /** Pre-run gate conditions. All must pass for the actions to run. */
  conditions: z.array(ConditionSchema).default([]),
  /** Ordered list of actions. */
  actions: z.array(ActionSchema).default([]),
  /** Concurrency mode. */
  mode: AutomationModeSchema,
  /** Max parallel runs (only meaningful in parallel/queued modes). */
  max_runs: z.number().int().min(1).max(1000).default(10),
  /**
   * Explicit live-state resolution list (sensing layer). By default the
   * engine resolves the state of the system named by the trigger's
   * `contextKey` (the common single-system case). Listing system ids here
   * resolves their state too, surfaced in templates under
   * `health.systems[<id>]` for cross-system rules. Bounded to keep the
   * pre-evaluation batch query cheap.
   */
  uses_state: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe(
      "Extra system ids whose live health state is resolved into scope under health.systems[id].",
    ),
});

export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;

// ─── Automation persistence row schemas (API surface) ─────────────────────

export const AutomationStatusSchema = z.enum(["enabled", "disabled"]);
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>;

export const AutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: AutomationStatusSchema,
  definition: AutomationDefinitionSchema,
  managedBy: z.string().optional().describe("GitOps provider id when managed declaratively"),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Automation = z.infer<typeof AutomationSchema>;

// ─── Run state ────────────────────────────────────────────────────────────

export const RunStatusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "success",
  "failed",
  "cancelled",
  "skipped",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepStatusSchema = z.enum([
  "pending",
  "running",
  "success",
  "failed",
  "skipped",
  "waiting",
]);

export type StepStatus = z.infer<typeof StepStatusSchema>;

export const AutomationRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  triggerId: z.string().describe("Which trigger fired this run"),
  triggerEventId: z.string(),
  triggerPayload: z.record(z.string(), z.unknown()),
  contextKey: z
    .string()
    .nullable()
    .describe("Durable key linking this run to a domain entity (e.g. incidentId)"),
  status: RunStatusSchema,
  errorMessage: z.string().optional(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().optional(),
});

export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export const AutomationRunStepSchema = z.object({
  id: z.string(),
  runId: z.string(),
  /** Hierarchical path of the action in the action tree, e.g. "actions[0].choose[1].then[2]". */
  actionPath: z.string(),
  /** Action id when the user assigned one, else null. */
  actionId: z.string().nullable(),
  /** Action kind discriminator: "action" | "choose" | "parallel" | ... */
  actionKind: z.string(),
  /** For provider actions, the resolved action id (e.g. "jira.create_issue"). */
  providerActionId: z.string().nullable(),
  status: StepStatusSchema,
  attempts: z.number().int(),
  errorMessage: z.string().optional(),
  resultPayload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Result data returned by the action — typically the artifact."),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().optional(),
});

export type AutomationRunStep = z.infer<typeof AutomationRunStepSchema>;

// ─── Artifact ─────────────────────────────────────────────────────────────

/**
 * A persisted artifact — what an action produced in an external system,
 * recorded so future actions in the same automation (or future runs) can
 * find and act on it.
 *
 * Keyed by `(automationId, contextKey, artifactType)` for the common case
 * and additionally indexed by `actionId` when the operator assigned one.
 */
export const AutomationArtifactSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  runId: z.string(),
  /** Step that produced this artifact. */
  stepId: z.string(),
  /** Optional operator-assigned action id (preferred lookup key). */
  actionId: z.string().nullable(),
  /** Provider-declared artifact type id (e.g. `jira.issue`, `teams.message`). */
  artifactType: z.string(),
  /** Free-form payload — the artifact data. */
  data: z.record(z.string(), z.unknown()),
  /** Durable lookup key (typically `incidentId`). */
  contextKey: z.string().nullable(),
  /** When the upstream artifact was closed/resolved (set by close actions). */
  closedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
});

export type AutomationArtifact = z.infer<typeof AutomationArtifactSchema>;

// ─── API inputs ──────────────────────────────────────────────────────────

export const CreateAutomationInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  status: AutomationStatusSchema.default("enabled"),
  definition: AutomationDefinitionSchema,
});

export type CreateAutomationInput = z.infer<typeof CreateAutomationInputSchema>;

export const UpdateAutomationInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: AutomationStatusSchema.optional(),
  definition: AutomationDefinitionSchema.optional(),
});

export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInputSchema>;

export const ValidateDefinitionInputSchema = z.object({
  definition: z.unknown(),
});

export const ValidateDefinitionResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(
    z.object({
      path: z.array(z.union([z.string(), z.number()])),
      message: z.string(),
    }),
  ),
});

export type ValidateDefinitionResult = z.infer<typeof ValidateDefinitionResultSchema>;

export const ListRunsInputSchema = z.object({
  automationId: z.string().optional(),
  status: RunStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const ManualRunInputSchema = z.object({
  automationId: z.string(),
  triggerId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

// ─── Plugin-contributed trigger / action / artifact info (registry API) ──

/**
 * Wire format for "what triggers does this plugin offer" listing endpoints.
 */
export const TriggerInfoSchema = z.object({
  qualifiedId: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  category: z.string().default("Uncategorized"),
  ownerPluginId: z.string(),
  payloadSchema: z.record(z.string(), z.unknown()).describe("JSON Schema"),
  configSchema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("JSON Schema, when the trigger needs configuration"),
  contextKey: z
    .string()
    .optional()
    .describe("Default context key path inside the payload (e.g. 'incidentId')"),
});

export type TriggerInfo = z.infer<typeof TriggerInfoSchema>;

export const ActionInfoSchema = z.object({
  qualifiedId: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  category: z.string().default("Uncategorized"),
  ownerPluginId: z.string(),
  configSchema: z.record(z.string(), z.unknown()),
  produces: z.string().optional().describe("Artifact type id this action produces, if any"),
  consumes: z
    .array(z.string())
    .default([])
    .describe("Artifact type ids this action consumes"),
  connectionProviderId: z
    .string()
    .optional()
    .describe(
      "Fully-qualified integration provider id whose connection store + option resolvers supply this action's config dropdowns",
    ),
});

export type ActionInfo = z.infer<typeof ActionInfoSchema>;

export const ArtifactTypeInfoSchema = z.object({
  qualifiedId: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  ownerPluginId: z.string(),
  schema: z.record(z.string(), z.unknown()).describe("JSON Schema for the data field"),
});

export type ArtifactTypeInfo = z.infer<typeof ArtifactTypeInfoSchema>;
