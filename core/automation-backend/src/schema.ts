import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Automations — top-level entity. The `definition` column holds the full
 * `AutomationDefinitionSchema`-validated JSON (triggers, conditions,
 * actions, mode).
 */
export const automations = pgTable(
  "automations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    /** "enabled" | "disabled" */
    status: text("status").notNull().default("enabled"),
    /** Validated AutomationDefinition (zod-checked on write). */
    definition: jsonb("definition")
      .notNull()
      .$type<Record<string, unknown>>(),
    /**
     * Origin marker. Set to "migrated-subscription:<id>" for rows produced
     * by the webhook-subscription auto-migration, or "gitops:<provider>"
     * for declaratively managed automations.
     */
    managedBy: text("managed_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("automations_status_idx").on(t.status),
    managedByIdx: index("automations_managed_by_idx").on(t.managedBy),
  }),
);

/**
 * Automation runs — one row per dispatch. Captures the originating
 * trigger, the payload it carried, and the durable context key for the
 * run scope (typically `incidentId`).
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /** Discriminator chosen at definition time. */
    triggerId: text("trigger_id").notNull(),
    /** Fully qualified event id (e.g. "incident.incident.created"). */
    triggerEventId: text("trigger_event_id").notNull(),
    triggerPayload: jsonb("trigger_payload")
      .notNull()
      .$type<Record<string, unknown>>(),
    /** Durable key linking the run to a domain entity. Nullable. */
    contextKey: text("context_key"),
    /** "pending" | "running" | "waiting" | "success" | "failed" | "cancelled" | "skipped" */
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    automationIdx: index("automation_runs_automation_idx").on(
      t.automationId,
      t.startedAt,
    ),
    statusIdx: index("automation_runs_status_idx").on(t.status),
    contextKeyIdx: index("automation_runs_context_key_idx").on(
      t.automationId,
      t.contextKey,
    ),
  }),
);

/**
 * Run steps — one row per attempted action node. `actionPath` is the
 * hierarchical path inside the action tree (e.g.
 * "actions[0].choose[1].then[2]") so we can correlate logs back to the
 * editor card.
 */
export const automationRunSteps = pgTable(
  "automation_run_steps",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    actionPath: text("action_path").notNull(),
    /** Operator-assigned action id, if any. */
    actionId: text("action_id"),
    /** Discriminator kind: "action" | "choose" | "parallel" | … */
    actionKind: text("action_kind").notNull(),
    /** Fully qualified action id for provider-action steps. */
    providerActionId: text("provider_action_id"),
    /** "pending" | "running" | "success" | "failed" | "skipped" | "waiting" */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    resultPayload: jsonb("result_payload").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    runIdx: index("automation_run_steps_run_idx").on(t.runId),
  }),
);

/**
 * Artifacts — typed payloads actions persist for downstream lookup.
 *
 * Lookup keys:
 *   - `(automationId, contextKey, artifactType)` — "give me the most recent
 *     jira.issue artifact for incident X in automation Y"
 *   - `(automationId, actionId)` — "give me what action Z produced"
 */
export const automationArtifacts = pgTable(
  "automation_artifacts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id")
      .notNull()
      .references(() => automationRunSteps.id, { onDelete: "cascade" }),
    /** Operator-assigned action id, if any. */
    actionId: text("action_id"),
    /** Fully qualified artifact type (e.g. "jira.issue"). */
    artifactType: text("artifact_type").notNull(),
    /** Free-form artifact data — validated against the type's schema on write. */
    data: jsonb("data").notNull().$type<Record<string, unknown>>(),
    /** Durable lookup key (typically `incidentId`). */
    contextKey: text("context_key"),
    /** Set when a downstream close action marks the artifact resolved. */
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    /**
     * Powers "find the most recent jira.issue for incident X" — the
     * default lookup when an action declares `consumes`.
     */
    contextLookupIdx: index(
      "automation_artifacts_context_lookup_idx",
    ).on(t.automationId, t.contextKey, t.artifactType, t.createdAt),
    /** Powers per-action lookup (`artifacts.<actionId>` references). */
    actionLookupIdx: index("automation_artifacts_action_lookup_idx").on(
      t.automationId,
      t.actionId,
      t.createdAt,
    ),
    /** Used by close actions to filter "still open" artifacts. */
    openIdx: index("automation_artifacts_open_idx").on(
      t.automationId,
      t.closedAt,
    ),
  }),
);

/**
 * Wait locks — durable bookkeeping for any kind of suspended run.
 *
 *   - `kind = "trigger"`: classic `wait_for_trigger`. Resumed by the
 *     trigger fan-in when a matching event arrives.
 *   - `kind = "delay"`: durable replacement for `setTimeout`. The dispatch
 *     engine persists the lock and enqueues a `automation-delay` queue
 *     job with `startDelay`; the queue consumer resumes the run on
 *     firing. The stalled-run sweeper also catches expired delay locks
 *     in case the queue job is lost.
 *
 * Either kind survives process restarts and horizontal scaling: the
 * lock is the source of truth, the queue / hook is the wake-up signal.
 */
export const automationWaitLocks = pgTable(
  "automation_wait_locks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    /** Action path of the suspended node — used to resume from the next sibling. */
    actionPath: text("action_path").notNull(),
    /**
     * Discriminator:
     *   - "trigger" — wait_for_trigger (woken by a matching event)
     *   - "delay"   — queue-backed sleep
     *   - "until"   — wait_until: polled condition re-check on an interval
     */
    kind: text("kind").notNull().default("trigger"),
    /**
     * Fully qualified event id being awaited (only meaningful when
     * kind = "trigger"). For "delay" / "until" a synthetic marker.
     */
    eventId: text("event_id").notNull(),
    /** Optional context-key filter (e.g. same incidentId). */
    contextKey: text("context_key"),
    /** Optional template that must evaluate truthy on the arriving payload. */
    filterTemplate: text("filter_template"),
    /**
     * Config for `kind = "until"` — the condition to re-evaluate, the
     * poll interval, and the timeout behaviour. JSON because the
     * condition may be a structured object, not just a template string.
     */
    waitConfig: jsonb("wait_config").$type<Record<string, unknown>>(),
    /**
     * Absolute deadline. For `kind = "trigger"`: nullable; if set, the
     * sweeper fails the run when exceeded. For `kind = "delay"`:
     * required; the firing time after which the run should resume even
     * if the queue job is lost. For `kind = "until"`: optional wait
     * deadline (null = wait forever); the sweeper re-ticks "until" locks
     * regardless, so a lost re-check job still self-heals.
     */
    timeoutAt: timestamp("timeout_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    /** Powers "any wait locks for this incoming event + context?" */
    eventLookupIdx: index("automation_wait_locks_event_lookup_idx").on(
      t.eventId,
      t.contextKey,
    ),
    /** Powers periodic timeout sweep. */
    timeoutIdx: index("automation_wait_locks_timeout_idx").on(t.timeoutAt),
    /** Powers the run-detail UI's "what are we waiting on?" view. */
    runIdx: index("automation_wait_locks_run_idx").on(t.runId),
    /** Powers the sweeper's "re-tick all until locks" scan. */
    kindIdx: index("automation_wait_locks_kind_idx").on(t.kind),
  }),
);

/**
 * Per-run durable execution state.
 *
 * Updated after every successfully-completed step (and again on
 * suspension) so a future process can resume a run from exactly where
 * the prior process left off.
 *
 *   - `scopeSnapshot` — JSON-encoded variable scope (`trigger`, `variables`,
 *     `artifacts`, plus helpers) sufficient to seed a fresh
 *     `DispatchContext` on resume.
 *   - `lastActionPath` — path of the most recently completed action; the
 *     walker resumes from the next sibling after this.
 *   - `lastHeartbeatAt` — bumped on every step write. The stalled-run
 *     sweeper uses this to identify runs that look dead.
 *
 * One row per active or waiting run. Cleared on terminal status.
 */
export const automationRunState = pgTable(
  "automation_run_state",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    scopeSnapshot: jsonb("scope_snapshot")
      .notNull()
      .$type<Record<string, unknown>>(),
    lastActionPath: text("last_action_path"),
    lastHeartbeatAt: timestamp("last_heartbeat_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    /**
     * Powers the stalled-run sweeper: scan runs whose heartbeat is older
     * than the threshold.
     */
    heartbeatIdx: index("automation_run_state_heartbeat_idx").on(
      t.lastHeartbeatAt,
    ),
  }),
);

/**
 * Pre-run dwell timers — the durable backing for a trigger's `for:`
 * dwell ("fire only if the matched state still holds after Y").
 *
 * A dwell is a property of the *trigger* and arms BEFORE any run exists,
 * so it cannot reuse `automation_wait_locks` (whose `runId` is NOT NULL).
 * The row is the source of truth; an `automation-dwell` queue job is just
 * the wake signal. Cancellation is DB-side (delete the row) — the queue
 * job pops later and no-ops because the row is gone (constraint 2).
 *
 *   - `armedStatus` — the status snapshotted at arm time; the expiry
 *     re-confirm proceeds only if the system is still in this status.
 *   - `fireAt` — absolute deadline; the queue job carries the matching
 *     `startDelay`, and the sweeper catches expired rows whose job was
 *     lost.
 *   - `payloadSnapshot` / `actorSnapshot` — the firing event's payload +
 *     actor, replayed into the run when the dwell fires.
 *
 * Unique on `(automationId, triggerId, contextKey)` so a re-fire re-arms
 * the same row (pushes `fireAt`) rather than stacking duplicate timers.
 */
export const automationDwellTimers = pgTable(
  "automation_dwell_timers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /** Operator-assigned or derived trigger id this dwell belongs to. */
    triggerId: text("trigger_id").notNull(),
    /** Fully qualified event id that armed the dwell. */
    eventId: text("event_id").notNull(),
    /** Durable context key (typically the systemId). Nullable. */
    contextKey: text("context_key"),
    /**
     * Status the system was in when the dwell armed. The expiry
     * re-confirm fires the run only if the system is still in this
     * status. Null when no live status was resolvable at arm time
     * (re-confirm then proceeds without a status gate).
     */
    armedStatus: text("armed_status"),
    /** Firing event payload, replayed into the run on fire. */
    payloadSnapshot: jsonb("payload_snapshot")
      .notNull()
      .$type<Record<string, unknown>>(),
    /** Firing event actor, replayed into the run on fire. */
    actorSnapshot: jsonb("actor_snapshot")
      .notNull()
      .$type<Record<string, unknown>>(),
    /** Absolute deadline (now + for). */
    fireAt: timestamp("fire_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    /**
     * Addressable for re-arm + cancellation. Postgres treats NULLs as
     * distinct in a unique index, so the rare null-context-key dwell
     * cannot rely on ON CONFLICT to de-dupe; the store handles that case
     * with an explicit find-then-update (see dwell-store.ts). Non-null
     * keys (the common systemId case) de-dupe via this index.
     */
    keyUnique: uniqueIndex("automation_dwell_timers_key_unique").on(
      t.automationId,
      t.triggerId,
      t.contextKey,
    ),
    /** Powers the sweeper's expired-dwell scan. */
    fireAtIdx: index("automation_dwell_timers_fire_at_idx").on(t.fireAt),
    /** Powers cleanup of dwells for a deleted/disabled automation. */
    automationIdx: index("automation_dwell_timers_automation_idx").on(
      t.automationId,
    ),
  }),
);

/**
 * Subscription-migration failures.
 *
 * Surfaces every webhook_subscription row the one-time migration
 * couldn't convert into an automation. Operators see them via the
 * `listMigrationFailures` RPC + acknowledge them once the source
 * subscription is recreated as an automation. Acknowledged rows are
 * dropped so the queue is self-cleaning.
 *
 * The table is empty under normal operation — its presence costs
 * nothing on greenfield installs.
 */
export const automationMigrationFailures = pgTable(
  "automation_migration_failures",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Source `webhook_subscriptions.id`. */
    subscriptionId: text("subscription_id").notNull().unique(),
    /** Subscription `name`, captured for the admin UI. */
    subscriptionName: text("subscription_name").notNull(),
    /** Source `providerId` (e.g. `integration-teams.teams`). */
    providerId: text("provider_id").notNull(),
    /** Source `eventId` the subscription was bound to. */
    eventId: text("event_id").notNull(),
    /** Short reason (a code or one-line summary). */
    reason: text("reason").notNull(),
    /** Detailed error message captured at migration time. */
    detail: text("detail"),
    /** Original `providerConfig` JSON for postmortem / manual rebuild. */
    providerConfig: jsonb("provider_config")
      .notNull()
      .$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

/**
 * Framework-owned entity state — the OPT-IN generic keyed store
 * ({@link createKeyedStore}) for HOMELESS `defineEntity` kinds, i.e. kinds
 * with no natural home for their current state (e.g. healthcheck's computed
 * `health` aggregate). One row per `(kind, entityId)`; the full zod-validated
 * state lives in the `state` jsonb column. A homeless kind needs ZERO
 * migrations: the platform owns this one table and the wake-index / Stage-1
 * routing / scope enrichment are all kind-agnostic.
 *
 * Plugin-backed kinds do NOT use this table — they keep their state in their
 * own schema and expose it through a `read` accessor.
 */
export const entityState = pgTable(
  "entity_state",
  {
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    /** Full validated state (zod-parsed before write). */
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.kind, t.entityId] }) }),
);

/**
 * Generic transition log — generalizes Phase 13's
 * `health_check_state_transitions` to ANY entity field. One row is
 * appended per changed tracked field on a real diff; powers
 * `inStateSince` / `inStateForMs` / `transitionCount` for arbitrary
 * entities.
 */
export const entityTransitions = pgTable(
  "entity_transitions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value").notNull(),
    transitionedAt: timestamp("transitioned_at").defaultNow().notNull(),
  },
  (t) => ({
    // Generalizes health_check_state_transitions lookup idx
    // (healthcheck schema.ts:176): "most recent transition into status X".
    lookupIdx: index("entity_transitions_lookup_idx").on(
      t.kind,
      t.entityId,
      t.field,
      t.transitionedAt,
    ),
  }),
);

/**
 * Wake-index — the reactive `wait_until` dependency set (reactive
 * automation engine §8.1). A suspended `wait_until` extracts the
 * `state.*` refs its condition reads and inserts one row here per ref,
 * all pointing at the owning `automation_wait_locks` row (`kind = "until"`).
 *
 * Rather than overloading the single `(eventId, contextKey)` columns on
 * `automation_wait_locks`, this child table lets one wait depend on a SET
 * of refs across any kinds. Stage-1 routing answers "which waits depend on
 * this just-changed `kind:id` ref?" with an indexed intersection join (§8.2).
 *
 * `ref` is `${kind}:${id}` (e.g. "incident:abc", "health:sys-1"), or the
 * kind-level wildcard `${kind}:*` when extraction couldn't resolve a
 * concrete id (§8.3 — the wait then wakes on ANY change of that kind and
 * re-evaluates). The `(waitLockId, ref)` pair is uniquely indexed so a
 * concurrent arm race can't double-insert the same dependency (§14.4 #3).
 */
export const automationWakeIndex = pgTable(
  "automation_wake_index",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    waitLockId: text("wait_lock_id")
      .notNull()
      .references(() => automationWaitLocks.id, { onDelete: "cascade" }),
    /** The dependency ref: `${kind}:${id}` or the kind wildcard `${kind}:*`. */
    ref: text("ref").notNull(),
  },
  (t) => ({
    /** Stage-1 lookup: "which waits depend on this just-changed ref?" */
    refIdx: index("automation_wake_index_ref_idx").on(t.ref),
    /** Cascade-friendly per-lock lookups + the arm-race uniqueness guard. */
    lockIdx: index("automation_wake_index_lock_idx").on(t.waitLockId),
    /** A wait depends on each distinct ref at most once (ON CONFLICT arm). */
    lockRefUnique: uniqueIndex("automation_wake_index_lock_ref_unique").on(
      t.waitLockId,
      t.ref,
    ),
  }),
);
