# Anomaly Detection

Checkstack ships an adaptive, baseline-learning anomaly detector that operates on every health check result. Plugin authors do not run any detection code themselves — they only **declare intent on the schema**, and the engine does the rest.

This document is the day-to-day reference for plugin authors building strategies and collectors. It covers:

- The `x-anomaly-*` schema annotations every chartable result field must carry.
- The three-layer override model (engine defaults → plugin schema → user UI).
- Phase 1 (spike/drop) and Phase 2 (trend drift) lifecycles.
- Signals plugins can subscribe to.
- Worked examples for the four supported direction modes.
- Cold-start, false-positive, and troubleshooting guidance.

For the full design narrative, see [docs/plans/2026-04-28-anomaly-detection-design.md](../plans/2026-04-28-anomaly-detection-design.md).

---

## 1. The Big Picture

```
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

- **Spike detector** runs inline on every check completion — fast, per-field threshold check against a cached baseline. Detects sudden jumps and drops.
- **Drift evaluator** runs hourly inside the background analyzer — checks the regression slope of the baseline window. Detects gradual creep (memory leak, slow latency degradation).

Spikes and drifts on the same metric are tracked independently (`kind = 'spike'` vs `kind = 'drift'`).

---

## 2. The `x-anomaly-*` Schema Annotations

Every chartable health-result field **must** declare its anomaly behaviour. The type system enforces this — see the discriminated union `HealthResultMeta` in [core/common/src/chart-types.ts](../../core/common/src/chart-types.ts).

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
| `deviation` | Value crosses `µ ± 3σ · sensitivity` (either side) | Player count, request rate, traffic — where either direction is meaningful |
| `dominance` | Categorical value differs from the dominant value when baseline dominance ratio exceeds a sensitivity-scaled floor (~0.9) | `boolean`, `text`, `status` fields — alerts on a flip from the stable state |

For `dominance`, the engine tracks the most-common value and the ratio at which it occurs. It only alerts when:

1. The current value differs from the historical dominant value, **and**
2. The historical dominant ratio exceeds the threshold floor (default `0.9`, scaled by sensitivity — see [core/anomaly-common/src/engine/thresholds.ts](../../core/anomaly-common/src/engine/thresholds.ts)).

This prevents false positives on fields that legitimately alternate between states.

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
}),
```

A 200ms baseline with 25ms σ produces an upper trigger at `200 + 3 × 25 = 275ms`. Values up to 275ms are considered noise. A spike to 500ms is `suspicious`; if it stays high for 3 consecutive checks, it escalates to `anomaly` and a notification fires.

Drift on the same field detects creep — e.g., baseline mean walking from 200ms → 240ms over a week. Drift triggers when `|slope × sampleCount| > 2 × σ × sensitivity`.

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

## 4. Three-Layer Override Model

Every effective config is the result of resolving three layers. The runtime uses [resolveEffectiveConfig](../../core/anomaly-common/src/engine/config.ts) to compute the final values.

| Layer | Who | How | Scope |
|---|---|---|---|
| **Layer 1** | Engine | Hardcoded defaults in `AnomalySettingsSchema` (sensitivity 1.0, confirmation window 3, baseline window 7d, drift threshold 2, etc.). | All fields |
| **Layer 2** | Plugin developer | `x-anomaly-*` annotations on the result schema. | Per field, per chart type |
| **Layer 3** | User / operator | Assignment-level UI: template config + per-assignment overrides + per-field overrides. | Per assignment + per field |

**Resolution precedence (highest to lowest):**

1. Assignment field override
2. Template field override
3. Assignment global
4. Template global
5. Engine defaults

> Field-level overrides always win over global overrides. This is intentional: a template can mark a noisy field as `enabled: false`, and an operator can re-enable it for one specific system without affecting all other systems using the same template.

Plugin authors should pick conservative defaults for `sensitivity` and `confirmationWindow`. Operators can always loosen via the UI; aggressive defaults generate alert fatigue.

---

## 5. Anomaly Lifecycle

### 5.1 Storage Model

`anomalies` table ([core/anomaly-backend/src/schema.ts](../../core/anomaly-backend/src/schema.ts)) — at most one open row per `(systemId, configurationId, fieldPath, kind)`. Spike and drift on the same metric are independent rows.

| Column | Description |
|---|---|
| `kind` | `"spike"` (Phase 1, inline detector) or `"drift"` (Phase 2, hourly evaluator). |
| `state` | `"suspicious"`, `"anomaly"`, or `"recovered"`. |
| `direction` | `"above"`, `"below"`, or `"changed"`. |
| `baselineValue`, `baselineStdDev` | Snapshot of µ/σ at detection time. |
| `observedValue` | Actual value that triggered (stringified). |
| `deviation` | Sigma distance — for drifts, sigmas of projected change. |
| `suspiciousRunCount` / `confirmationThreshold` | Confirmation-window state. |
| `startedAt` / `confirmedAt` / `recoveredAt` | Lifecycle timestamps. |

### 5.2 State Machine (shared by spike + drift)

```
   normal ─[value exceeds threshold]─▶ suspicious
                                        │      ▲
                          [N consecutive│      │ [returns
                            confirmations]    │  to normal]
                                        ▼      │
                                     anomaly ──┘   ← suspicious cleared silently
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
| `suspicious → normal` | Silent | The row is deleted — transient spike absorbed. |
| `anomaly → recovered` | **Recovered** notification | Importance: `info` ("Good news"). |
| `recovered → archived` | None | Retained for historical analysis (default 30 days). |

### 5.3 Confirmation Windows

| Detector | Default | Rationale |
|---|---|---|
| Spike (inline, per-check) | **3 consecutive checks** | Three bad readings in a row before paging. |
| Drift (hourly analyzer) | **2 consecutive analyzer runs** | ≥2 hours of sustained trend before paging. Drift runs at analyzer cadence, not check cadence. |

### 5.4 Cold Start

The engine refuses to evaluate a field until the baseline has at least **24 samples** (`MIN_BASELINE_SAMPLES`). Before that, the field shows as "Learning" in the UI and no anomalies can fire. This prevents storms of false positives on freshly-deployed health checks.

---

## 6. Drift Detection (Phase 2)

Drift is a property of the windowed baseline, not of any single observation. The hourly background analyzer:

1. Computes `mean`, `stdDev`, `trendSlope`, and `dominantValue/Ratio` for each monitored field.
2. Persists baselines to `anomaly_baselines` and updates the cache.
3. Calls [detectDrift](../../core/anomaly-common/src/engine/drift.ts) on each numeric field with a fresh baseline.

The drift trigger is:

```
|slope × sampleCount| > driftThreshold × σ × sensitivity
```

Direction filtering:

| Field direction | Counted slope |
|---|---|
| `lower-is-better` | Only positive slope (worsening) |
| `higher-is-better` | Only negative slope (worsening) |
| `deviation` | Either |
| `dominance` | Never (categorical fields don't drift continuously) |

Edge case: when `stdDev === 0` and `slope !== 0`, `deviationSigmas` returns `Infinity` — any movement on a previously-constant metric is by definition outside the noise floor.

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
| `ANOMALY_STATE_CHANGED` | `{ systemId, anomalyId, newState }` | Any anomaly row transitions state (suspicious / anomaly / recovered). |
| `ANOMALY_BASELINE_UPDATED` | `{ systemId, configurationId, fieldPath, mean, stdDev, sampleCount }` | The hourly analyzer has recomputed a baseline. |
| `ANOMALY_TREND_DETECTED` | `{ systemId, anomalyId, fieldPath }` | A drift row transitioned to confirmed `anomaly`. Phase 2 only. |

The dashboard feed and chart range bands subscribe to these to update without a page reload.

---

## 8. Notifications

Anomaly notifications are dispatched through the shared notification sidecar ([core/anomaly-backend/src/notification.ts](../../core/anomaly-backend/src/notification.ts)). Plugin authors don't need to wire anything — confirmed and recovered transitions automatically fire the appropriate notification.

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

---

## 9. Caching Behaviour

The inline detector reads baselines from the `CacheProvider` first; cache misses fall back to the database (and warm the cache). Keys are namespaced under the anomaly plugin id (see [Cache System](cache-system.md)) and shaped as:

```
baseline:${configurationId}:${systemId}:${fieldPath}
```

Baselines are written with a 24-hour TTL by the analyzer. The next hourly tick refreshes them. Plugin authors do not normally need to touch this — the cache is internal to `core/anomaly-backend`.

---

## 10. Troubleshooting

### "I'm getting too many false positives on a noisy metric"

1. **Raise sensitivity in the schema.** Change `"x-anomaly-sensitivity": 1.0` → `1.5` or `2.0`. This widens the threshold band.
2. **Use `deviation` direction only when truly two-sided.** A field that should only fire on increases must use `"lower-is-better"` (or vice versa).
3. **Increase the confirmation window.** `"x-anomaly-confirmation-window": 5` requires five consecutive bad checks before paging.
4. **Review the baseline window in the assignment UI.** Operators can extend the window from 7d (default) to 14d for fields with weekly seasonality.

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

These are deterministic, side-effect-free functions — ideal for unit tests.

---

## 12. Phasing Summary

| Phase | Status | Scope |
|---|---|---|
| Pre-req | ✅ Shipped | [Cache System](cache-system.md) abstraction + Infrastructure Configuration UI. |
| Phase 1 | ✅ Shipped | Spike/drop detection with confirmation window, three-layer overrides, range bands on charts, system anomaly badge + feed widget, sidecar notifications. |
| Phase 2 | ✅ Shipped | Trend drift detection in the background analyzer (`kind = 'drift'` rows), drift confirmation across consecutive analyzer runs, trend-line overlay on `AutoChartGrid` charts. |
| Phase 3 | ❌ Dropped | Cross-metric correlation — investigated 2026-04-29 and dropped (cost/value did not justify the work; schema is forward-compatible if revived). |
| Phase 4 | 🚧 In progress | This document and supporting developer docs. |

---

## 13. Related Documentation

- [Cache System](cache-system.md) — provider abstraction the anomaly plugin uses for hot baselines.
- [Health Check Strategies](healthcheck-strategies.md) — where you author the result schemas that carry `x-anomaly-*` metadata.
- [Collector Plugin Development](collectors.md) — collectors also expose `result.schema` and participate in anomaly detection.
- [Health Check Custom Charts](../frontend/healthcheck-charts.md) — `x-chart-type` reference (the prerequisite for anomaly fields).
- [Signals](signals.md) — pattern for subscribing to `ANOMALY_*` events.
- [Anomaly Detection Design Plan](../plans/2026-04-28-anomaly-detection-design.md) — full design narrative and rationale.
