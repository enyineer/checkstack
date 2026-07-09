---
title: "Anomaly Detection"
description: "Checkstack ships an adaptive, baseline-learning anomaly detector that operates on every health check result. Plugin authors do not run any detection code themselves - they only declare intent on th…"
---

Checkstack ships an adaptive, baseline-learning anomaly detector that operates on every health check result. Plugin authors do not run any detection code themselves - they only **declare intent on the schema**, and the engine does the rest.

This document is the day-to-day reference for plugin authors building strategies and collectors. It covers:

- The `x-anomaly-*` schema annotations every chartable result field must carry.
- The override model (engine fallbacks → plugin schema → user field overrides).
- Phase 1 (spike/drop) and Phase 2 (trend drift) lifecycles.
- Signals plugins can subscribe to.
- Worked examples for the four supported direction modes.
- Cold-start, false-positive, and troubleshooting guidance.

---

## 1. The Big Picture

```text
   ┌─────────────────────────┐    every check       ┌────────────────────┐
   │ Strategy / Collector    │ ────────────────────▶│ checkCompleted hook│
   │ (your plugin)           │                       └────────┬───────────┘
   └─────────────────────────┘                                │
              │                                               ▼
              │ x-anomaly-* metadata                ┌─────────────────────┐
              │ on result schema                    │ Inline Spike Detector│
              └────────────────────┐                │ (anomaly-backend)   │
                                   ▼                └─────────┬───────────┘
                          ┌─────────────────┐                 │
                          │ healthcheck-    │                 │ µ ± 3σ check
                          │ common factory  │                 │ vs cached baseline
                          │ (healthResult*) │                 ▼
                          └─────────────────┘        ┌──────────────────┐
                                   ▲                 │ anomalies table  │
                                   │                 │ (state machine)  │
        ┌──────────────────────────┘                 └─────────┬────────┘
        │                                                      │
        │                                                      ▼ ANOMALY_STATE_CHANGED
        │  ┌─────────────────────────┐  hourly cron   ┌──────────────────┐
        └──┤ Background Baseline     │◀────────────── │ analyzer queue   │
           │ Analyzer (jobs/...)     │                └──────────────────┘
           └────────┬────────────────┘
                    │ µ, σ, slope, dominance
                    ▼
            ┌──────────────────────┐
            │ anomaly_baselines    │
            │ + cache (CacheProvider)│
            └──────────────────────┘
                    │
                    ▼
            ┌──────────────────────┐ Phase 2
            │ Drift Evaluator      │ |slope × n| > N·σ
            └──────────────────────┘ → kind = 'drift' rows
```

Two detectors share the same `anomalies` table:

- **Spike detector** runs inline on every check completion - fast, per-field threshold check against a cached baseline. Detects sudden jumps and drops.
- **Drift evaluator** runs hourly inside the background analyzer - checks the regression slope of the baseline window. Detects gradual creep (memory leak, slow latency degradation).

Spikes and drifts on the same metric are tracked independently (`kind = 'spike'` vs `kind = 'drift'`).

---

## 2. The `x-anomaly-*` Schema Annotations

Every chartable health-result field **must** declare its anomaly behaviour. The type system enforces this - see the discriminated union `HealthResultMeta` in [core/common/src/chart-types.ts](../../core/common/src/chart-types.ts).

### 2.1 Authoring Result Schemas

Use the `healthResult*` factories from `@checkstack/healthcheck-common`. These factories accept a metadata object whose type is `HealthResultMeta`, so the compiler checks every annotation:

```typescript
import {
  healthResultSchema,
  healthResultNumber,
  healthResultBoolean,
  healthResultString,
} from "@checkstack/healthcheck-common";

const result = healthResultSchema({
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Success Rate",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
  }),
  online: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Online",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
  lastError: healthResultString({
    // No x-chart-type → no anomaly detection. NonChartMeta variant.
  }).optional(),
});
```

### 2.2 Reference Table

| Key | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `x-anomaly-enabled` | `true` \| `false` | When `x-chart-type` is present | — | `false` opts a chartable field out of detection. |
| `x-anomaly-direction` | `"higher-is-better"` \| `"lower-is-better"` \| `"deviation"` \| `"dominance"` | When `x-anomaly-enabled: true` | — | What counts as anomalous. See §2.4. |
| `x-anomaly-sensitivity` | `number` | No | `1.0` | Multiplier on the threshold band. Higher = wider band = fewer alerts. |
| `x-anomaly-confirmation-window` | `number` | No | `3` | Consecutive runs required before a `suspicious` row escalates to `anomaly`. |
| `x-anomaly-drift-enabled` | `boolean` | No | `true` | Enable trend drift detection on this field. |
| `x-anomaly-drift-threshold` | `number` | No | `2` | Sigma multiplier in the drift trigger `\|slope × n\| > N · σ · sensitivity`. |
| `x-anomaly-min-absolute-delta` | `number` | No | `0` | Practical-significance floor on `\|value − μ\|`. Anomaly only fires when the statistical trigger is exceeded **and** absolute deviation ≥ this floor. Same unit as the field. Plugin authors should set a sensible default for low-baseline metrics (e.g. 50ms for latency). |
| `x-anomaly-min-relative-delta` | `number` | No | `0` | Practical-significance floor on `\|value − μ\| / max(\|μ\|, ε)`, expressed as a fraction. Anomaly only fires when the statistical trigger is exceeded **and** relative deviation ≥ this floor. Useful for high-magnitude metrics where small absolute changes are routine. |

### 2.3 The Discriminated Union

`HealthResultMeta` is a discriminated union, not a flat interface. The type system rejects ambiguous schemas:

```typescript
type HealthResultMeta =
  | ChartMetaAnomalyEnabled    // x-chart-type + x-anomaly-enabled: true (+ direction)
  | ChartMetaAnomalyDisabled   // x-chart-type + x-anomaly-enabled: false
  | NonChartMeta;              // No x-chart-type — anomaly detection N/A
```

> **Removed in Phase 1**: an earlier draft auto-inferred `direction` from `x-chart-type` + `x-chart-unit`. This caused silent surprises when guesses were wrong, so the inference module was deleted. Plugin authors now declare direction explicitly. Missing annotations are a compile error, not a silent default.

### 2.4 Direction Semantics

| Direction | Numeric trigger | Use for |
|---|---|---|
| `higher-is-better` | Value drops below `µ − 3σ · sensitivity` | Success rate, availability, signal strength, throughput |
| `lower-is-better` | Value rises above `µ + 3σ · sensitivity` | Latency, error count, queue depth, CPU usage |
| `deviation` | Value crosses `µ ± 3σ · sensitivity` (either side) | Player count, request rate, traffic - where either direction is meaningful |
| `dominance` | Categorical value differs from the dominant value when baseline dominance ratio exceeds a sensitivity-scaled floor (~0.9) | `boolean`, `text`, `status` fields - alerts on a flip from the stable state |

For `dominance`, the engine tracks the most-common value and the ratio at which it occurs. It only alerts when:

1. The current value differs from the historical dominant value, **and**
2. The historical dominant ratio exceeds the threshold floor (default `0.9`, scaled by sensitivity - see [core/anomaly-common/src/engine/thresholds.ts](../../core/anomaly-common/src/engine/thresholds.ts)).

This prevents false positives on fields that legitimately alternate between states.

### 2.5 Default alerting posture

Anomaly detection is opinionated about what alerts **out of the box**. The goal
is a low-noise default: a fresh install should surface only genuine,
statistically-significant, problem-mapping deviations - not a flood of alerts on
every metric that wiggles. A noisy default-enabled metric erodes trust in every
alert, so when in doubt, ship a metric **default-disabled** (still chartable; a
user can opt in per field).

Default **enabled** (`"x-anomaly-enabled": true`) - signals that have a stable,
learnable baseline and map to a real problem:

- Availability / success (`boolean`, `status`) via `dominance`.
- Latency / response / execution time via `lower-is-better`, always guarded by a
  confirmation window (`>= 3`) and both an absolute floor (tens of ms, so fast
  endpoints do not alert on small jitter) and a relative floor (`~0.5`), with a
  sensitivity that errs wider (fewer alerts).
- Saturation expressed as a **percentage or rate** (CPU %, memory %,
  packet-loss %, error/failure rate) via `lower-is-better`/`higher-is-better`
  with a confirmation window and a small absolute floor. Prefer the percentage
  form; if an absolute twin exists (e.g. memory used MB alongside used %), keep
  the percentage enabled and disable the absolute twin, which drifts without
  being a problem.

Default **disabled** (`"x-anomaly-enabled": false`) - high-noise or
un-baselineable classes:

- Informational text / identifiers (status text, banners, command output,
  certificate subject/issuer, raw record values) - no numeric baseline.
- Config echoes and near-constants (probe packet count, CPU core count, total or
  swap-total memory) - a baseline over a constant is meaningless.
- Values that legitimately change a lot run-to-run with no stable baseline and
  no clear good/bad direction (arbitrary query row counts, build counts,
  response/body sizes) - the core alert-fatigue class.
- Deterministic, monotonic values (e.g. certificate days-remaining, which
  decreases by exactly one per day) - these are static-threshold concerns
  enforced by the check's own health logic (a configurable minimum), not
  statistical outliers, so anomaly detection is left off for them.

---

## 3. Worked Examples

### Latency (lower-is-better)

```typescript
responseTimeMs: healthResultNumber({
  "x-chart-type": "line",
  "x-chart-label": "Response Time",
  "x-chart-unit": "ms",
  "x-anomaly-enabled": true,
  "x-anomaly-direction": "lower-is-better",
  "x-anomaly-min-absolute-delta": 50,
  "x-anomaly-min-relative-delta": 0.5,
}),
```

A 200ms baseline with 25ms σ produces an upper trigger at `200 + 3 × 25 = 275ms`. Values up to 275ms are considered noise. A spike to 500ms is `suspicious`; if it stays high for 3 consecutive checks, it escalates to `anomaly` and a notification fires.

Drift on the same field detects creep - e.g., baseline mean walking from 200ms → 240ms over a week. Drift triggers when `|slope × sampleCount| > 2 × σ × sensitivity`.

The floor pair `min-absolute-delta: 50` + `min-relative-delta: 0.5` suppresses false positives on low-baseline checks. Example: a 6ms baseline with 1ms σ has a statistical trigger at ~9ms - without floors a routine 20ms blip would fire even though Δ=14ms is not actionable. With the floors, the spike must clear both 50ms absolute *and* 50% relative before alerting; a 6ms → 200ms spike (Δ=194ms, +3233%) still fires.

### Success Rate (higher-is-better)

```typescript
successRate: healthResultNumber({
  "x-chart-type": "line",
  "x-chart-label": "Success Rate",
  "x-anomaly-enabled": true,
  "x-anomaly-direction": "higher-is-better",
}),
```

Drops below `µ − 3σ` are anomalous; increases (recovery) are not.

### Player Count (deviation)

```typescript
playerCount: healthResultNumber({
  "x-chart-type": "line",
  "x-chart-label": "Players Online",
  "x-anomaly-enabled": true,
  "x-anomaly-direction": "deviation",
  "x-anomaly-sensitivity": 1.5,   // looser band — gaming traffic is bursty
}),
```

Both unusual highs (DDoS, surge) and unusual lows (mass disconnect) are interesting. Sensitivity `1.5` widens the band to `µ ± 4.5σ` to suppress weekend/event noise.

### Service Status (dominance)

```typescript
serviceStatus: healthResultString({
  "x-chart-type": "status",
  "x-chart-label": "Service Status",
  "x-anomaly-enabled": true,
  "x-anomaly-direction": "dominance",
}),
```

If the field has been `"running"` for 95% of the baseline window, a flip to `"degraded"` fires an anomaly. If the field naturally toggles (e.g., `"idle"` ↔ `"working"` at 60/40), the dominance ratio falls below the threshold and no alert fires.

### Non-Chartable Auxiliary Field

```typescript
debugTrace: healthResultString({
  // No x-chart-type — falls into NonChartMeta variant.
  // Field is recorded but not charted and not subject to anomaly detection.
}).optional(),
```

### Opt-Out for a Chartable Field

```typescript
internalCounter: healthResultNumber({
  "x-chart-type": "line",
  "x-anomaly-enabled": false,    // Charted but never triggers anomalies
}),
```

---

## 4. Override Model

Configuration is field-only. The runtime uses [resolveEffectiveConfig](../../core/anomaly-common/src/engine/config.ts) to compute the final values for each field.

**Resolution precedence (highest to lowest):**

1. Assignment field override (user - per-system, per-field UI)
2. Template field override (user - template-wide field default in the UI)
3. Schema annotation (plugin developer - `x-anomaly-*` keys on the result schema)
4. Engine fallback constant (`sensitivity 1.0`, `confirmationWindow 3`, `driftEnabled true`, `driftThreshold 2`, floors `0`)

The only non-field-level settings on `AnomalySettings` are:

| Key | Why it's global | Scope |
|---|---|---|
| `enabled` | Master kill switch for the whole assignment. | Template + assignment |
| `baselineWindow` | One history per system, not per field. | Template + assignment |
| `notify` | One notification preference per assignment. | Template + assignment |

There is no global `sensitivity` / `confirmationWindow` / `driftEnabled` / `driftThreshold`. A single global multiplier across heterogeneous fields (ms vs % vs count) is meaningless, and per-field schema defaults already give the plugin author a place to express tuned defaults. If the user needs to adjust a metric, they do it in the field-level UI for that specific field.

Plugin authors should pick conservative defaults for `x-anomaly-sensitivity`, `x-anomaly-confirmation-window`, and the floor annotations. Operators can always loosen them per field; aggressive defaults generate alert fatigue.

---

## 5. Anomaly Lifecycle

### 5.1 Storage Model

`anomalies` table ([core/anomaly-backend/src/schema.ts](../../core/anomaly-backend/src/schema.ts)) - at most one open row per `(systemId, configurationId, environmentId, fieldPath, kind)`. Spike and drift on the same metric are independent rows, and so are two environments of the same check (see [5.7](#57-per-environment-scoping)).

| Column | Description |
|---|---|
| `environmentId` | Environment the anomaly was detected for. `null` = the env-less slice (no environment membership). Part of the row identity - see [5.7](#57-per-environment-scoping). |
| `kind` | `"spike"` (Phase 1, inline detector) or `"drift"` (Phase 2, hourly evaluator). |
| `state` | `"suspicious"`, `"anomaly"`, or `"recovered"`. |
| `direction` | `"above"`, `"below"`, or `"changed"`. |
| `baselineValue`, `baselineStdDev` | Snapshot of µ/σ at detection time. |
| `observedValue` | Actual value that triggered (stringified). |
| `deviation` | Sigma distance - for drifts, sigmas of projected change. |
| `suspiciousRunCount` / `confirmationThreshold` | Confirmation-window state. |
| `startedAt` / `confirmedAt` / `recoveredAt` | Lifecycle timestamps. |
| `suppressedAt` / `suppressedValue` / `suppressedBaseline` | Global suppression flag + snapshot (see [5.6](#56-global-suppression)). `suppressedAt IS NULL` means not suppressed. |

### 5.2 State Machine (shared by spike + drift)

```text
   normal ─[value exceeds threshold]─▶ suspicious
                                        │      ▲
                          [N consecutive│      │ [returns
                            confirmations]    │  to normal]
                                        ▼      │
                                     anomaly ──┘   ← suspicious cleared (no notification)
                                        │
                          [returns to normal]
                                        ▼
                                    recovered
                                        │
                          [retention window passes]
                                        ▼
                                    archived
```

| Transition | Notification | Notes |
|---|---|---|
| `normal → suspicious` | Silent | Transient noise is absorbed without alerting operators. |
| `suspicious → anomaly` | **Confirmed** notification | Fires after the confirmation window is met (default 3 for spikes, 2 for drifts). |
| `suspicious → normal` | Silent | The row is deleted - transient spike absorbed. Emits `ANOMALY_STATE_CHANGED` with `newState: "cleared"` (see below). |
| `anomaly → recovered` | **Recovered** notification | Importance: `info` ("Good news"). Fires on either the baseline-relative path or the self-resolution path (see [5.5](#55-self-resolution-new-normal)). |
| `recovered → archived` | None | Retained for historical analysis (default 30 days). |

"Silent" above means **no operator notification**. Every transition - including
`suspicious → normal` - still drops the router-level anomaly cache and
broadcasts `ANOMALY_STATE_CHANGED`, because a suspicious row is rendered on the
dashboard (the "Suspicious behaviour" badge and system signal) and must
disappear the moment it clears. A suspicious row is DELETED rather than moved to
`recovered`, so it has no persisted state left to report; the signal carries the
dedicated `newState: "cleared"` for that case.

> [!IMPORTANT]
> Do not treat `cleared` as `recovered` when deciding whether to alert. A
> `suspicious` row never produced a "confirmed" notification, so clearing it must
> not produce a "recovered" one. The two values are distinct precisely so an
> automation subscribed to `recovered` does not fire for a transient suspicion.

### 5.3 Confirmation Windows

| Detector | Default | Rationale |
|---|---|---|
| Spike (inline, per-check) | **3 consecutive checks** | Three bad readings in a row before paging. |
| Drift (hourly analyzer) | **2 consecutive analyzer runs** | ≥2 hours of sustained trend before paging. Drift runs at analyzer cadence, not check cadence. |

### 5.4 Cold Start

The engine refuses to evaluate a field until the baseline has at least **24 samples** (`MIN_BASELINE_SAMPLES`). Before that, the field shows as "Learning" in the UI and no anomalies can fire. This prevents storms of false positives on freshly-deployed health checks.

### 5.5 Self-resolution (new normal)

A confirmed anomaly used to be able to stay stuck indefinitely when the metric settled at a *new* level that became the real normal (the classic "broken, then fixed at a clearly different value" case): every fresh sample was still anomalous against the stale baseline, so the baseline-relative recovery branch never ran, and the row only cleared once the slow hourly analyzer dragged the mean across - hours to days later.

Both detectors now carry a baseline-independent escape hatch:

- **Spike** ([detector.ts](../../core/anomaly-backend/src/detector.ts)): each healthy sample for a confirmed anomaly is appended to a rolling window stored on the row's `metadata.recentSamples`. Once `STABLE_RESOLUTION_RUN_COUNT` (5) consecutive samples sit inside a relative band of each other (`STABLE_RESOLUTION_RELATIVE_BAND`, 10%), the row self-resolves to `recovered` - even while still anomalous against the old baseline.
- **Drift** ([drift-evaluator.ts](../../core/anomaly-backend/src/drift-evaluator.ts)): the slope-based detector keeps reporting drift while the 7-day window straddles both regimes. When the *projected change relative to the new mean* goes flat for `STABLE_DRIFT_RESOLUTION_RUN_COUNT` (2) consecutive analyzer runs (tracked via `metadata.stableDriftRunCount`), the row self-resolves.

The constants live in [engine/self-resolution.ts](../../core/anomaly-common/src/engine/self-resolution.ts). The original baseline-relative recovery path is unchanged and still fires first when applicable. The rolling counters live on the shared `anomalies` row (Postgres), so they survive across whichever pod claims the work.

### 5.6 Global suppression

Operators can **suppress** a confirmed anomaly so it disappears from the active feed until it "changes again". Suppression is **global (per row), not per-user** - distinct from the per-user notification mute in [8.2](#82-per-field-and-per-system-mute), which only silences notifications while the row stays active.

Suppression is modelled as a **flag layered on top of `state`** (a nullable `suppressedAt`), not a new enum value: the suspicious/anomaly/recovered state machine stays intact and un-suppressing simply reveals the underlying state again. Suppressing snapshots `suppressedValue` (the observed value) and `suppressedBaseline`.

- `suppressAnomaly` / `unsuppressAnomaly` RPCs (gated by `anomaly_feed.manage`) set and clear the flag. Both are scoped by `(anomalyId, systemId)` so a caller authorized on one system cannot mutate another system's row, and `suppressAnomaly` only acts on rows already in the `anomaly` state.
- `getAnomalies` takes a `suppression` filter: `"active"` (default, hides suppressed rows), `"suppressed"`, or `"all"`. The dashboard badge and widget use the default, so suppressed rows drop out of the active count.
- **Auto-unsuppress** ("changes again"): the inline detector clears suppression once a fresh observed value moves more than `SUPPRESSION_REACTIVATION_DELTA` (25%) away from `suppressedValue`. A baseline-relative recovery also clears suppression.

Suppression state lives on the shared `anomalies` row, so every horizontally-scaled pod reads the same suppressed/active set.

### 5.7 Per-environment scoping

When a `(system, configuration)` assignment fans out to multiple environments (see [per-environment health](/checkstack/user-guide/concepts/health-checks/)), each environment runs its own check and its baselines are computed per environment. Anomaly **rows** follow the same split: the open row is keyed on `(systemId, configurationId, environmentId, fieldPath, kind)`, so an anomaly for a check in environment A is a **distinct row** from the same check in environment B. A healthy value in one environment never masks (or merges with) an anomaly in another.

- **Detection.** The inline spike detector receives `environmentId` from the `checkCompleted` hook, and the drift evaluator receives it from the analyzer's per-environment loop. Both locate/create the row with `environmentId = <id>` when present, or `environment_id IS NULL` for the **env-less slice** (a check that opts out of fan-out, or a system with no environments).
- **Reads.** `getAnomalies` accepts an optional `environmentId` filter with the same tristate as `getAnomalyBaselines`: `undefined` returns every environment, `null` returns only the env-less slice, and a string returns that environment's anomalies. Each `AnomalyDto` and each `getActiveSignalAnomalies` row surfaces `environmentId`, so the system-detail widget renders an environment pill and the dashboard signal feed keeps two environments of the same field distinct.
- **Notifications.** When an anomaly is env-scoped, its environment id is appended to the notification collapse key (`anomaly.anomaly.<systemId>.<fieldPath>.<environmentId>`), so two failing environments render as two independent cards instead of collapsing into one. The env-less slice keeps the pre-feature two-segment key. Mutes stay env-agnostic (per system / per field).

> [!NOTE]
> No unique constraint is placed on the `anomalies` table (and none existed before): multiple rows legitimately share the identity tuple - a `recovered` historical row coexists with a fresh active row. Env is just an additional column on the row, stored in shared Postgres, so every pod reads the same per-`(system, config, env, field, kind)` state. On upgrade, existing cross-env rows backfill to `null` (the env-less slice) and remain until they recover; the next detection tick opens fresh per-environment rows for fanned-out checks.

---

## 6. Drift Detection (Phase 2)

Drift is a property of the windowed baseline, not of any single observation. The hourly background analyzer:

1. Computes `mean`, `stdDev`, `trendSlope`, and `dominantValue/Ratio` for each monitored field.
2. Persists baselines to `anomaly_baselines` and updates the cache.
3. Calls [detectDrift](../../core/anomaly-common/src/engine/drift.ts) on each numeric field with a fresh baseline.

The drift trigger is:

```text
|slope × sampleCount| > driftThreshold × σ × sensitivity
```

Direction filtering:

| Field direction | Counted slope |
|---|---|
| `lower-is-better` | Only positive slope (worsening) |
| `higher-is-better` | Only negative slope (worsening) |
| `deviation` | Either |
| `dominance` | Never (categorical fields don't drift continuously) |

Edge case: when `stdDev === 0` and `slope !== 0`, `deviationSigmas` returns `Infinity` - any movement on a previously-constant metric is by definition outside the noise floor.

To opt a field out of drift detection without affecting spike detection:

```typescript
"x-anomaly-drift-enabled": false,
```

To make drift detection more conservative for a noisy metric:

```typescript
"x-anomaly-drift-threshold": 3,   // Default is 2
```

---

## 7. Signals

The anomaly plugin broadcasts three signals on the platform signal bus ([core/anomaly-common/src/index.ts](../../core/anomaly-common/src/index.ts)). Frontend or backend code can subscribe to these for live updates.

| Signal | Payload | When |
|---|---|---|
| `ANOMALY_STATE_CHANGED` | `{ systemId, anomalyId, newState }` | Any anomaly row transitions state. `newState` is `suspicious` / `anomaly` / `recovered` / `cleared` - the last means an unconfirmed suspicious row was deleted, so it has no persisted state (see [5.2](#52-state-machine-shared-by-spike--drift)). |
| `ANOMALY_BASELINE_UPDATED` | `{ systemId, configurationId, fieldPath, mean, stdDev, sampleCount }` | The hourly analyzer has recomputed a baseline. |
| `ANOMALY_TREND_DETECTED` | `{ systemId, anomalyId, fieldPath }` | A drift row transitioned to confirmed `anomaly`. Phase 2 only. |

The dashboard feed and chart range bands subscribe to these to update without a page reload.

---

## 8. Notifications

Anomaly notifications are dispatched through the shared notification sidecar ([core/anomaly-backend/src/notification.ts](../../core/anomaly-backend/src/notification.ts)). Plugin authors don't need to wire anything - confirmed and recovered transitions automatically fire the appropriate notification.

| Action | Importance |
|---|---|
| `confirmed` (spike) | `warning` |
| `drift_confirmed` | `warning` |
| `recovered` | `info` (Good news) |
| `drift_recovered` | `info` |

### 8.1 Subscription model

Anomaly notifications target a dedicated per-system notification group, namespaced as `anomaly.system.<systemId>`, instead of the shared `catalog.system.<systemId>` group. This separation lets users opt out of anomaly noise without losing incident or healthcheck alerts for the same system. The groups are created lazily on the catalog `systemCreated` hook and torn down on `systemDeleted`. On first deploy, existing subscribers of each `catalog.system.<id>` group are seeded onto the new anomaly group via a one-time bootstrap migration so no one silently stops getting alerts.

### 8.2 Per-field and per-system mute

The `anomaly_notification_mutes` table holds user-scoped mutes. A row's existence means that user has muted notifications for that `(systemId, fieldPath)` pair. An empty `fieldPath` represents a system-wide mute. The dispatcher consults this table after fetching subscribers and filters out muted users before calling `notifyUsers`.

The system anomaly widget on each system detail page exposes a bell icon on every anomaly row (per-field mute) plus a `Mute all` toggle in the card header (per-system mute). Mutes are user-scoped and persist across sessions.

> [!NOTE]
> A mute only silences notifications - the anomaly row stays active and visible. To hide a row from the active feed entirely, use [global suppression](#56-global-suppression) (the eye-off icon on a confirmed anomaly row), which is per-row rather than per-user.

---

## 9. Caching Behaviour

The inline detector reads baselines from the `CacheProvider` first; cache misses fall back to the database (and warm the cache). Keys are namespaced under the anomaly plugin id (see [Cache System](/checkstack/developer-guide/backend/cache-system/)) and shaped as:

```text
baseline:${configurationId}:${systemId}:${environmentId ?? "<none>"}:${fieldPath}
```

The env segment keeps per-environment baselines from shadowing each other; the env-less slice uses the literal `<none>`. Baselines are written with a 24-hour TTL by the analyzer. The next hourly tick refreshes them. Plugin authors do not normally need to touch this - the cache is internal to `core/anomaly-backend`.

---

## 10. Troubleshooting

### "I'm getting too many false positives on a noisy metric"

1. **Raise sensitivity in the schema.** Change `"x-anomaly-sensitivity": 1.0` → `1.5` or `2.0`. This widens the threshold band.
2. **Use `deviation` direction only when truly two-sided.** A field that should only fire on increases must use `"lower-is-better"` (or vice versa).
3. **Increase the confirmation window.** `"x-anomaly-confirmation-window": 5` requires five consecutive bad checks before paging.
4. **Review the baseline window in the assignment UI.** Operators can extend the window from 7d (default) to 14d for fields with weekly seasonality.

### "Tiny absolute changes on a low-baseline metric keep alerting"

A 6 ms latency baseline with 1 ms σ has a statistical trigger at ~9 ms - even a routine 20 ms blip crosses 11 σ and fires. Statistical significance ≠ operational significance. Set a practical-significance floor:

```typescript
responseTimeMs: healthResultNumber({
  "x-chart-type": "line",
  "x-chart-unit": "ms",
  "x-anomaly-enabled": true,
  "x-anomaly-direction": "lower-is-better",
  "x-anomaly-min-absolute-delta": 50,    // ignore Δ < 50 ms
  "x-anomaly-min-relative-delta": 0.5,   // and Δ < 50%
}),
```

Both floors must clear in addition to the statistical trigger. Defaults of `0` mean disabled. The shipped per-run schemas in built-in plugins set sensible defaults - `50 ms` + `50%` for ms-unit fields, `5` percentage points for `%`-unit fields, `1` count + `25%` for counters, `1` GB + `5%` for disk, `50` MB + `10%` for memory - but operators can override per-system or per-field via the UI.

### "Big proportional changes on a high-magnitude metric never alert"

The opposite problem: if a `2000ms` baseline has a `min-absolute-delta` of `50ms` set somewhere, a 2.5% bump (50ms) crosses it routinely. For high-magnitude metrics, prefer the relative floor over absolute, or raise the absolute floor in an assignment-level override.

### "I made a change to a strategy and now nothing alerts"

The baseline cache key includes `configurationId`. Schema-shape changes that alter the field path (e.g., renaming `latencyMs` → `responseTimeMs`) invalidate baselines for that field. Wait one analyzer cycle (1 hour) for fresh baselines, plus the cold-start window (24 samples).

### "A `dominance` field never alerts even though the value flipped"

The dominant ratio in the baseline is below the required floor (~0.9). A field that bounces between two values 60/40 will never alert because neither state is dominant. If you genuinely care about transitions on a bouncy field, model it as two booleans (one per state) instead.

### "I want to disable anomaly detection for a chartable field"

```typescript
internalCounter: healthResultNumber({
  "x-chart-type": "line",
  "x-anomaly-enabled": false,
}),
```

The field is still charted; it simply skips all anomaly evaluation.

### "I want to disable drift detection but keep spike detection"

```typescript
errorCount: healthResultNumber({
  "x-chart-type": "line",
  "x-anomaly-enabled": true,
  "x-anomaly-direction": "lower-is-better",
  "x-anomaly-drift-enabled": false,
}),
```

---

## 11. Pure-Engine Module (for Testing)

The statistical core lives in `core/anomaly-common` and has zero database/cache dependencies. Plugin authors writing tests against anomaly-aware code can call the pure functions directly:

| Function | File | Purpose |
|---|---|---|
| `computeMean` / `computeStdDev` | [engine/baseline.ts](../../core/anomaly-common/src/engine/baseline.ts) | Aggregate statistics. |
| `computeLinearRegressionSlope` | [engine/baseline.ts](../../core/anomaly-common/src/engine/baseline.ts) | Slope used by drift evaluator. |
| `computeDominance` | [engine/baseline.ts](../../core/anomaly-common/src/engine/baseline.ts) | Mode + ratio for categorical fields. |
| `computeThresholds` / `isAnomalous` | [engine/thresholds.ts](../../core/anomaly-common/src/engine/thresholds.ts) | Spike trigger math. |
| `isCategoricalAnomalous` | [engine/thresholds.ts](../../core/anomaly-common/src/engine/thresholds.ts) | Dominance trigger math. |
| `detectDrift` | [engine/drift.ts](../../core/anomaly-common/src/engine/drift.ts) | Drift trigger math. |
| `resolveEffectiveConfig` | [engine/config.ts](../../core/anomaly-common/src/engine/config.ts) | Three-layer override resolution. |
| `hasSettledAtNewLevel` / `appendRecentSample` | [engine/self-resolution.ts](../../core/anomaly-common/src/engine/self-resolution.ts) | Spike self-resolution: rolling window + tight-band test. |
| `isDriftFlatRelative` | [engine/self-resolution.ts](../../core/anomaly-common/src/engine/self-resolution.ts) | Drift self-resolution: flat-relative-slope test. |
| `hasChangedSinceSuppression` | [engine/self-resolution.ts](../../core/anomaly-common/src/engine/self-resolution.ts) | Auto-unsuppress: relative-move test. |

These are deterministic, side-effect-free functions - ideal for unit tests.

---

## 12. Phasing Summary

| Phase | Status | Scope |
|---|---|---|
| Pre-req | ✅ Shipped | [Cache System](/checkstack/developer-guide/backend/cache-system/) abstraction + Infrastructure Configuration UI. |
| Phase 1 | ✅ Shipped | Spike/drop detection with confirmation window, field-level overrides, range bands on charts, system anomaly badge + feed widget, sidecar notifications. |
| Phase 2 | ✅ Shipped | Trend drift detection in the background analyzer (`kind = 'drift'` rows), drift confirmation across consecutive analyzer runs, trend-line overlay on `AutoChartGrid` charts. |
| Phase 3 | ❌ Dropped | Cross-metric correlation - investigated 2026-04-29 and dropped (cost/value did not justify the work; schema is forward-compatible if revived). |
| Phase 4 | 🚧 In progress | This document and supporting developer docs. |

---

## 13. Related Documentation

- [Cache System](/checkstack/developer-guide/backend/cache-system/) - provider abstraction the anomaly plugin uses for hot baselines.
- [Health Check Strategies](/checkstack/developer-guide/backend/healthchecks/strategies/) - where you author the result schemas that carry `x-anomaly-*` metadata.
- [Collector Plugin Development](/checkstack/developer-guide/backend/healthchecks/collectors/) - collectors also expose `result.schema` and participate in anomaly detection.
- [Health Check Custom Charts](/checkstack/developer-guide/frontend/healthcheck-charts/) - `x-chart-type` reference (the prerequisite for anomaly fields).
- [Signals](/checkstack/developer-guide/backend/signals/) - pattern for subscribing to `ANOMALY_*` events.
