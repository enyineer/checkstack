# Anomaly Detection for Health Check Results

> **Status**: Phase 1 + Pre-req shipped · Phase 2 implemented · Phase 4 in progress  
> **Date**: 2026-04-28 (initial design) · 2026-04-29 (Phase 2 + as-built reconciliation, Phase 3 dropped, Phase 4 promoted)  
> **Scope**: Pre-req (Cache abstraction · Infrastructure UI) · Phase 1 (Spike/Drop) · Phase 2 (Trend Drift) · Phase 4 (Developer Documentation)  
> **Dropped**: Phase 3 (Cross-Metric Correlation) — see §10 for rationale

## Overview

Add adaptive, baseline-learning anomaly detection to Checkstack's health check system. Rather than relying on static thresholds, the engine continuously learns what "normal" looks like for each metric by analyzing historical data, computing statistical baselines, and tracking natural variance. It alerts only when behavior genuinely deviates beyond the learned noise floor — eliminating the alert fatigue caused by fixed threshold configurations.

The system is **schema-driven**: detection behaviour is declared on each result field via `x-anomaly-*` metadata, with explicit overrides available to end-user operators. Plugin authors must explicitly opt fields in or out — the engine deliberately does *not* auto-infer behaviour from chart metadata, because misinference produces silent surprises that are hard to debug.

## Design Principles

1. **Explicit over implicit** — Plugin authors annotate every chartable field with explicit anomaly behaviour. The type system forces the choice; missing annotations are a compile error, not a silent default.
2. **Three-layer override model** — Engine defaults → Schema annotations → User UI configuration.
3. **No false positives over missed detections** — Adaptive noise floor + confirmation window ensures only real anomalies generate notifications.
4. **Pure statistical core** — The detection engine is a stateless, side-effect-free module with deterministic inputs/outputs, enabling exhaustive unit testing.
5. **Schema-driven extensibility** — All detection behaviour is derived from schema metadata, so new strategies and collectors automatically participate.

---

## 1. Schema Extensions — The `x-anomaly-*` Metadata Family

### 1.1 HealthResultMeta — Discriminated Union

`HealthResultMeta` in [core/common/src/chart-types.ts](../../core/common/src/chart-types.ts) is a **discriminated union** rather than a flat interface. This forces plugin authors to make an explicit choice and lets the type system reject ambiguous schemas:

```typescript
type HealthResultMeta =
  | ChartMetaAnomalyEnabled       // x-chart-type + x-anomaly-enabled: true (+ direction)
  | ChartMetaAnomalyDisabled      // x-chart-type + x-anomaly-enabled: false
  | NonChartMeta;                 // No x-chart-type — anomaly detection N/A
```

When a field carries `x-chart-type`, it **must** also carry `x-anomaly-enabled`. When `x-anomaly-enabled: true`, it **must** also carry `x-anomaly-direction`.

Available `x-anomaly-*` keys:

| Key | Type | Purpose |
|:----|:-----|:--------|
| `x-anomaly-enabled` | `true \| false` | Required when `x-chart-type` is present. `false` opts a chartable field out of anomaly detection. |
| `x-anomaly-direction` | `"higher-is-better" \| "lower-is-better" \| "deviation" \| "dominance"` | Required when `enabled: true`. See §1.2. |
| `x-anomaly-sensitivity` | `number` | Optional. Multiplier on threshold width (default `1.0`). Higher = fewer alerts. |
| `x-anomaly-confirmation-window` | `number` | Optional. Consecutive runs required to escalate suspicious → anomaly (default `3`). |
| `x-anomaly-drift-enabled` | `boolean` | Optional. Enable/disable trend drift detection for this specific field (default `true`). |
| `x-anomaly-drift-threshold` | `number` | Optional. Drift trigger sigma multiplier (default `2`). See §5.3. |

### 1.2 Direction Semantics

The four `x-anomaly-direction` values specify *what counts as an anomaly* for the field:

| Direction | Numeric trigger | Use for |
|:----------|:----------------|:--------|
| `higher-is-better` | Value drops below `μ − Nσ` | Success rate, availability, signal strength |
| `lower-is-better` | Value rises above `μ + Nσ` | Latency, error count, queue depth |
| `deviation` | Value crosses `μ ± Nσ` in either direction | Player count, request rate (where either direction is meaningful) |
| `dominance` | Categorical value differs from the dominant value when the baseline dominance ratio is high | `boolean`, `text`, `status` fields — alerts on a flip from the stable state |

**Dominance details**: For categorical fields, the analyzer tracks the most common value across the baseline window and the ratio at which it occurs. An anomaly fires when the current value differs from `dominantValue` *and* `dominantRatio` exceeds a sensitivity-scaled floor (base 0.9, scaled by sensitivity — see [core/anomaly-common/src/engine/thresholds.ts](../../core/anomaly-common/src/engine/thresholds.ts):54). This prevents false positives on fields that naturally alternate between states.

### 1.3 Three-Layer Override Model

| Layer | Who | How | Scope |
|:------|:----|:----|:------|
| **Layer 1** | Engine | Defaults defined in `AnomalySettingsSchema` (sensitivity 1.0, confirmation window 3, baseline window 7d, etc.) | All fields |
| **Layer 2** | Plugin Developer | Annotates via `x-anomaly-*` on schema factories | Per field, per chart type |
| **Layer 3** | User/Operator | Configures via assignment-level UI settings (template config + per-assignment overrides + per-field overrides) | Per assignment + per field |

Each layer overrides the previous. Field-level overrides always win over global overrides because they represent more specific intent — `resolveEffectiveConfig` in [core/anomaly-common/src/engine/config.ts](../../core/anomaly-common/src/engine/config.ts) implements the precedence order.

> **Note**: An earlier design draft proposed *auto-inferring* direction from `x-chart-type` + `x-chart-unit`. This was deliberately removed during Phase 1 implementation (the `core/anomaly-common/src/engine/inference.ts` module was deleted) because misinference produced silent, hard-to-debug surprises. Plugin authors now declare intent explicitly.

---

## 2. Prerequisites — CacheProvider Abstraction (shipped)

### 2.1 CacheProvider Interface

Defined in [core/cache-api/src/cache-provider.ts](../../core/cache-api/src/cache-provider.ts):

```typescript
export interface CacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
```

`has` was added during implementation so callers can distinguish "missing" from "stored as `undefined`" without paying for full deserialization.

### 2.2 CacheManager + Scoped Cache Factory

Two concerns split:

- **`CacheManager`** ([core/cache-api/src/cache-manager.ts](../../core/cache-api/src/cache-manager.ts)) — owns lifecycle and backend switching. Plugins call `cacheManager.getProvider()` to get the active provider; the platform replaces the underlying provider atomically when the operator changes the cache backend in the Infrastructure Configuration UI.
- **`createScopedCache`** — namespacing layer. Each plugin receives a provider whose keys are automatically prefixed with the plugin id. Object-destructured signature per the project's argument-style rules:

```typescript
export function createScopedCache({
  pluginId,
  provider,
}: {
  pluginId: string;
  provider: CacheProvider;
}): CacheProvider;
```

Plugin usage:

```typescript
// In plugin init — receives a pre-scoped cache via cacheManager.getProvider()
init: async ({ cacheManager }) => {
  const cache = cacheManager.getProvider();
  // Keys are automatically namespaced: "anomaly:baseline:abc123"
  await cache.set("baseline:abc123", baselineData, 3_600_000);
  const data = await cache.get("baseline:abc123");
}
```

Benefits: key isolation between plugins, zero boilerplate, consistent with the scoped registry pattern used by `HealthCheckRegistry`.

### 2.3 InMemoryCachePlugin (`plugins/cache-memory-backend`)

Mirrors `plugins/queue-memory-backend`: the in-memory implementation lives in a plugin, not in core. `core/cache-api` only defines the `CacheProvider` interface, the `CachePlugin` contract, and the `CacheManager`. The default implementation uses a `Map` with TTL-based eviction ([plugins/cache-memory-backend/src/memory-cache.ts](../../plugins/cache-memory-backend/src/memory-cache.ts)) and is suitable for single-instance deployments. A future `plugins/cache-redis-backend` can reuse the queue's Redis connection.

### 2.4 Infrastructure Configuration UI

Implemented as a dedicated package, [core/infrastructure-frontend](../../core/infrastructure-frontend/), exposing `InfrastructureConfigPage` ([pages/InfrastructureConfigPage.tsx](../../core/infrastructure-frontend/src/pages/InfrastructureConfigPage.tsx)) — the IDE-Editor-style tabbed page that replaces the legacy Queue Configuration page.

**Built-in tabs**:
- **Queue** — Queue backend selection (BullMQ/Redis, In-Memory), concurrency, retry settings.
- **Cache** — Cache backend selection (In-Memory, future: Redis), TTL defaults.

**Plugin extension**: tabs are registered through a slot (`createSlotDefinition`) so feature plugins can contribute additional tabs (e.g., a future "Storage" tab) without touching the core page. The Queue and Cache tabs themselves are registered through the same slot mechanism — the pattern is dogfooded from day one.

**Auto-linking**: When Redis is configured for the queue, the cache tab auto-defaults to Redis (same connection) but can be configured independently.

---

## 3. The Statistical Core — Baseline Engine

### 3.1 Package: `core/anomaly-common` (Engine Module)

A pure, stateless module with zero dependencies on database, cache, or framework. All functions take explicit inputs and return deterministic outputs. **This is where 90% of unit tests live.**

As-built modules:

- [engine/baseline.ts](../../core/anomaly-common/src/engine/baseline.ts) — `computeMean`, `computeStdDev`, `computeLinearRegressionSlope`, `computeDominance`.
- [engine/thresholds.ts](../../core/anomaly-common/src/engine/thresholds.ts) — `computeThresholds`, `isAnomalous`, `isCategoricalAnomalous`.
- [engine/config.ts](../../core/anomaly-common/src/engine/config.ts) — `resolveEffectiveConfig`.
- [engine/drift.ts](../../core/anomaly-common/src/engine/drift.ts) — `detectDrift` (Phase 2).
- [schema.ts](../../core/anomaly-common/src/schema.ts) — Zod schemas for `AnomalyDirection`, `AnomalyState`, `AnomalyKind`, `FieldBaseline`, `AnomalyFieldConfig`, `AnomalySettings`.

### 3.2 Baseline Computation

Runs in the background job. Uses a sliding window of hourly aggregated data (default: 7 days, configurable per assignment).

For each monitored numeric field, computes:

| Metric | Formula | Purpose |
|:-------|:--------|:--------|
| **Mean (μ)** | `Σ values / n` | Expected value |
| **Standard Deviation (σ)** | `√(Σ(value − μ)² / n)` | Natural noise floor |
| **Trend slope** | Linear regression slope on chronologically ordered values | Phase 2: drift detection |

For categorical fields (`x-anomaly-direction: "dominance"`), also computes `dominantValue` and `dominantRatio` via `computeDominance`.

**Stored as `FieldBaseline`**:

```typescript
interface FieldBaseline {
  /** The expected value */
  mean: number;
  /** The natural variance */
  stdDev: number;
  /** Linear regression slope (Phase 2 drift detection) */
  trendSlope: number;
  /** Number of data points used */
  sampleCount: number;
  /** When this baseline was last computed */
  computedAt: string; // ISO timestamp
  /** Dominance tracking for boolean/text/status fields */
  dominantValue?: string | boolean | number;
  dominantRatio?: number;
}
```

Baselines are persisted to the `anomaly_baselines` table and cached via the `CacheProvider` (key `baseline:${configurationId}:${systemId}:${fieldPath}`) for fast inline lookups.

### 3.3 Detection Thresholds

Used by the inline fast detector. Default threshold: `μ ± (3σ × sensitivity)` — the three-sigma rule.

| Direction | Lower Boundary | Upper Boundary |
|:----------|:---------------|:---------------|
| `higher-is-better` | `μ - (3σ × sensitivity)` ← triggers | No upper trigger |
| `lower-is-better` | No lower trigger | `μ + (3σ × sensitivity)` ← triggers |
| `deviation` | `μ - (3σ × sensitivity)` ← triggers | `μ + (3σ × sensitivity)` ← triggers |

### 3.4 Cold Start Handling

No anomaly detection until the baseline window has at least **24 hours of data**. Before that, the field shows a "Learning" state in the UI. This prevents false positives during initial deployment or after a new health check is created.

### 3.5 Testing Strategy

The anomaly engine is the most test-critical module. Required test coverage:

- **Basic detection**: Values inside/outside thresholds with known baselines
- **Direction modes**: `higher-is-better`, `lower-is-better`, `deviation` all behave correctly
- **Sensitivity multiplier**: Higher sensitivity = wider bands = fewer detections
- **Cold start**: No detections when `sampleCount < threshold`
- **High-variance metrics**: Metrics with large σ naturally tolerate wider swings
- **Stable metrics**: Metrics with near-zero σ detect tiny changes
- **Boolean/text dominance**: State flip detection with dominance ratio thresholds
- **Edge cases**: Zero σ (constant metric), negative values, NaN/Infinity handling, single data point
- **Baseline computation**: Correct mean/σ calculation from aggregated bucket data
- **Confirmation window**: State machine transitions with various run sequences
- **Flapping detection**: Rapid state oscillation handling
- **Recovery**: Correct transition back to normal after anomaly clears

---

## 4. Anomaly Entity & Lifecycle

### 4.1 Data Model

`anomalies` table ([core/anomaly-backend/src/schema.ts](../../core/anomaly-backend/src/schema.ts)):

| Column | Type | Description |
|:-------|:-----|:------------|
| `id` | UUID | Primary key |
| `systemId` | text | Affected system |
| `configurationId` | UUID | Health check configuration that detected it |
| `fieldPath` | text | Specific metric path (e.g., `collectors.request-abc.responseTimeMs`) |
| `kind` | Enum (`spike` \| `drift`) | Phase 1 spikes vs Phase 2 drifts. Default `spike` for backward compatibility. |
| `state` | Enum (`suspicious` \| `anomaly` \| `recovered`) | Lifecycle state |
| `direction` | Enum (`above` \| `below` \| `changed`) | Which side of the baseline triggered |
| `baselineValue` | double | Expected value (μ) at detection time (nullable) |
| `baselineStdDev` | double | Noise floor (σ) at detection time (nullable) |
| `observedValue` | text | Actual value that triggered detection (stringified) |
| `deviation` | double | How many σ from baseline (or σ-of-projected-change for drift) |
| `suspiciousRunCount` | integer | Consecutive anomalous observations while suspicious |
| `confirmationThreshold` | integer | Runs required for confirmation (snapshot at creation) |
| `startedAt` | timestamp | When the metric first deviated |
| `confirmedAt` | timestamp | When it escalated to anomaly (nullable) |
| `recoveredAt` | timestamp | When it returned to normal (nullable) |
| `metadata` | jsonb | Additional context (trend data, related anomalies) |

Uniqueness: at most one open anomaly row per `(systemId, configurationId, fieldPath, kind)` — spikes and drifts on the same metric are tracked independently.

### 4.2 State Machine

```
                          [value exceeds threshold]
               normal ──────────────────────────────→ suspicious
                 ↑                                        │
                 │                                        │
    [after cooldown]                        ┌─────────────┤
                 │                          │             │
                 │          [returns to     │  [sustained N runs]
                 │           normal]        │             │
                 │              ↓           ↓             ↓
              recovered ←── anomaly    ←── suspicious ──→ anomaly
                             │                              │
                             │      [fires notification]    │
                             │                              │
                             └──── [returns to normal] ─────┘
                                          │
                                   [fires recovery
                                    notification]
```

**Key transitions**:
- `normal → suspicious`: Value exceeds detection threshold. **Silent** — no notification.
- `suspicious → anomaly`: Value sustained for N consecutive runs (default: 3). **Fires notification.**
- `suspicious → normal`: Value returns to normal before confirmation. **Silent** — transient spike absorbed.
- `anomaly → recovered`: Value returns to normal. **Fires recovery notification.**
- `recovered → normal`: After configurable cooldown period. Anomaly archived for history.

### 4.3 Retention

Recovered anomalies are archived after a configurable period (default: 30 days). This enables historical analysis ("this metric had 12 anomalies last month").

---

## 5. Execution Model — Dual-Phase Detection

### 5.1 Inline Fast Detector (Real-time)

Runs on the health check execution path, immediately after assertion evaluation:

1. For each field in the result, look up the cached baseline from `CacheProvider`
2. If no baseline exists (cold start), skip — field is in "Learning" state
3. Compare the current value against the detection threshold
4. If anomalous:
   - Look up existing anomaly entity for this field/assignment
   - If none: create with state `suspicious`
   - If `suspicious`: increment `suspiciousRunCount`. If threshold reached → transition to `anomaly`, fire notification
   - If `anomaly`: update `observedValue` (it's still anomalous)
5. If normal:
   - If `suspicious` exists: delete it (transient spike absorbed)
   - If `anomaly` exists: transition to `recovered`, fire recovery notification

**Performance**: The inline detector is essentially a single numeric comparison per field against a cached value — effectively zero overhead.

### 5.2 Background Baseline Analyzer (Periodic)

Runs as a scheduled background job (default: every hour):

1. For each active health check assignment with anomaly detection enabled:
   - Query hourly aggregated data for the sliding window via `getRunsForAnalysis` ([core/healthcheck-backend/src/service.ts](../../core/healthcheck-backend/src/service.ts)).
   - Reverse to chronological order.
   - Compute baselines (mean, σ, trend slope, dominance) for each monitored field.
   - Persist baselines to `anomaly_baselines` and update the cache.
   - Run `evaluateDrift` per field (see §5.3) to advance the drift state machine.
2. Cross-metric correlation (Phase 3, future): Identify correlated anomaly patterns across systems.

### 5.3 Drift Evaluator (Phase 2)

Drift is a property of the *windowed baseline*, not of any single observation, so detection runs in the analyzer rather than the inline path.

For each numeric field with a freshly computed baseline:

1. Look up the schema-declared `direction` and the user-effective config (`enabled`, `sensitivity`, `driftEnabled`, `driftThreshold`) via `resolveEffectiveConfig`.
2. Skip when `driftEnabled` is false, `direction === "dominance"`, or `sampleCount < 24` (cold start).
3. Call `detectDrift({ slope, stdDev, sampleCount, direction, sensitivity, threshold })`. The trigger is:

   ```
   |slope × sampleCount| > driftThreshold × σ × sensitivity
   ```

   Direction filtering: `lower-is-better` only counts positive slope (metric getting worse); `higher-is-better` only counts negative slope; `deviation` counts either.

4. Reconcile against the existing `kind = 'drift'` row for `(systemId, configurationId, fieldPath)`:

| Current state | Drifting now? | Action |
|:--------------|:--------------|:-------|
| no row | yes | Insert `state='suspicious'`, `kind='drift'`, `suspiciousRunCount=1`, `confirmationThreshold=2` |
| `suspicious` | yes | Increment count; on threshold reach → `state='anomaly'`, set `confirmedAt`, broadcast `ANOMALY_STATE_CHANGED` + `ANOMALY_TREND_DETECTED`, dispatch drift-confirmed notification |
| `anomaly` | yes | Refresh `observedValue` (current mean) and `deviation` (sigmas of projected change) |
| `suspicious` | no | Delete row (transient drift absorbed) |
| `anomaly` | no | Transition to `recovered`, broadcast signal, dispatch drift-recovered notification |

The state machine is identical in shape to the spike detector but ticks at the analyzer's cadence (default: hourly) rather than per check execution. Confirmation window for drift defaults to **2 analyzer runs** so a confirmed drift represents at least ~2 hours of sustained trend — significantly more conservative than the 3 consecutive checks used for spikes.

---

## 6. Visualization

### 6.1 Expected Range Bands + Trend Lines (Auto-Chart Integration)

On existing `AutoChartGrid` line charts ([core/healthcheck-frontend/src/auto-charts/AutoChartGrid.tsx](../../core/healthcheck-frontend/src/auto-charts/AutoChartGrid.tsx)):

- **Phase 1**: a translucent shaded band between `μ - 3σ` and `μ + 3σ` (the "expected range"); a dashed reference line at `μ` itself. Data points outside the band are highlighted (orange = `suspicious`, red = confirmed `anomaly`).
- **Phase 2**: when `baseline.trendSlope` is non-zero, a dashed regression line is rendered through the chart's index domain so the operator can see the direction and magnitude of the drift the analyzer detected. Color: `hsl(var(--muted-foreground))` to keep it subordinate to the data series.

The band and the trend line both adapt live as baselines update — `ANOMALY_BASELINE_UPDATED` triggers a query refetch.

On `gauge` charts:
- Expected range shown as a colored arc segment (green = expected, red = anomalous zone)

### 6.2 Anomaly Feed (Dashboard Extension)

A timeline-style feed component (following the existing dashboard activity feed pattern):
- Shows active and recent anomalies across all systems
- Each entry displays:
  - System name and metric name
  - Deviation magnitude in human terms ("Response Time 3.2× above baseline")
  - Time in current state
  - Sparkline thumbnail
- Clicking navigates to the specific health check history view, zoomed to the anomaly timeframe
- Rendered as a dashboard extension slot — not a separate top-level page

### 6.3 System Status Badge Integration

The existing system status badge gains a new visual indicator:
- When a system has active anomalies but is otherwise `healthy`, a subtle **pulsing indicator** communicates "nothing is broken yet, but something is unusual"
- This does NOT override the health state — it's an additive visual layer

---

## 7. Notification Integration

### 7.1 Notification Flow

Uses the existing **Sidecar Notification Orchestration** pattern:

**Anomaly confirmed** (`suspicious → anomaly`):
- System name, metric name, current value vs. baseline
- Deviation magnitude: "Response Time is 340ms, normally 120ms ± 15ms"
- Deep-link to health check history view
- Importance: Severity-based (degraded/critical depending on deviation magnitude)

**Anomaly recovered** (`anomaly → recovered`):
- System name, metric name, recovered value
- Duration of the anomaly
- Importance: Info ("Good News")

### 7.2 Importance Mapping

| Deviation | Importance |
|:----------|:-----------|
| 3σ – 5σ | Degraded |
| > 5σ | Critical |
| Recovery | Info |

---

## 8. Assignment-Level User Configuration

On the existing health check assignment editor, an "Anomaly Detection" section:

| Setting | Type | Default | Description |
|:--------|:-----|:--------|:------------|
| **Enabled** | Toggle | `true` | Global enable/disable for spike detection on this assignment |
| **Sensitivity** | Slider (0.5 – 3.0) | `1.0` | Threshold multiplier. Higher = fewer alerts |
| **Confirmation Window** | Number input | `3` | Consecutive anomalous checks before escalation (spikes) |
| **Baseline Window** | Duration selector | `7d` | How much history to use for baseline computation |
| **Notify** | Toggle | `true` | Generate notifications (disable for silent monitoring) |
| **Drift Enabled** | Toggle | `true` | Enable trend drift detection for this assignment (Phase 2) |
| **Drift Threshold** | Slider (1.0 – 4.0) | `2.0` | Sigma multiplier on the drift trigger `\|slope×n\| > N×σ` (Phase 2) |

**Per-field overrides table**: populated from the strategy/collector schemas. Each row shows:
- Field name and schema-declared direction
- Toggle to enable/disable detection
- Direction override dropdown
- Sensitivity override slider
- Confirmation window override
- Drift override (toggle + threshold slider)

---

## 9. Package Structure

| Package | Purpose |
|:--------|:--------|
| `core/cache-api` | `CacheProvider` interface, `CachePlugin` contract, `CacheManager`, scoped cache factory (mirrors `core/queue-api`) |
| `plugins/cache-memory-backend` | `InMemoryCachePlugin` — Map-based implementation with TTL eviction (mirrors `plugins/queue-memory-backend`) |
| `core/infrastructure-frontend` | Infrastructure Configuration page (Queue + Cache tabs, slot for plugin-contributed tabs) |
| `core/anomaly-common` | Shared Zod schemas, RPC contract, signals, direction constants **+ pure statistical core** (baseline computation, detection algorithms, drift detection, config resolution). Zero frontend/backend dependencies. **90% of test coverage lives here.** |
| `core/anomaly-backend` | Backend plugin — DB schema, migrations, background baseline analyzer, drift evaluator, cache integration, notification sidecar, RPC endpoints, inline spike detector hook |
| `core/anomaly-frontend` | UI — assignment config panel, per-field overrides editor, anomaly feed widget, status badge |
| `core/healthcheck-frontend` | Owns chart rendering — Phase 1 added expected-range bands and Phase 2 added trend-line overlays in `AutoChartGrid` |

---

## 10. Phasing

| Phase | Status | Scope | What Ships |
|:------|:-------|:------|:-----------|
| **Pre-req** | ✅ Shipped | CacheProvider abstraction | `core/cache-api` (interface + `CacheManager` + scoped factory), `plugins/cache-memory-backend` (InMemoryCachePlugin), `core/infrastructure-frontend` Infrastructure Configuration page with Queue + Cache tabs registered through a shared slot |
| **Phase 1** | ✅ Shipped | Spike/Drop Detection | Baseline engine, fast inline detector, `anomalies` entity + lifecycle, confirmation window, adaptive noise floor (3σ), UI range bands, `SystemAnomalyWidget` feed, sidecar notifications, assignment-level configuration with per-field overrides |
| **Phase 2** | ✅ Shipped | Trend Drift Detection | Linear regression slope on chronologically-ordered baseline window, drift detection in the background analyzer (`kind = 'drift'` rows), drift confirmation across consecutive analyzer runs, "creeping degradation" notifications, trend-line overlay on `AutoChartGrid` line charts, drift toggle/threshold in template + per-field UI |
| **Phase 3** | ❌ Dropped | Cross-Metric Correlation | Investigated 2026-04-29 and dropped from the roadmap. Cost/value did not justify the work: useful within-system correlation requires N² field-pair computation per analyzer tick plus careful sparse-data handling, lag-window search, and false-positive control, while the UX value (a "blast radius" hint panel) is largely served by operators reading the existing `SystemAnomalyWidget` feed. The schema and entity model are forward-compatible, so this can be revived later without breaking changes. |
| **Phase 4** | 🚧 In progress | Developer Documentation | [docs/backend/anomaly-detection.md](../backend/anomaly-detection.md) — `x-anomaly-*` reference, three-layer override, lifecycle, signals, plugin integration. Plus expansion of [docs/backend/cache-system.md](../backend/cache-system.md) for plugin authors. |

Each phase builds on the previous. The schema extensions, entity model, and engine interfaces are designed to support all phases without breaking changes.

---

## 11. Access Control

| Resource | Rule | Default |
|:---------|:-----|:--------|
| View anomaly feed | `anomaly.status` | Public (dashboard visibility) |
| View anomaly details | `anomaly.details` | Restricted (deviation values, baselines) |
| Configure anomaly settings | `anomaly.configuration` | Admin/Team |
| Escalate to incident | `incident.manage` | Existing rule |

---

## 12. Signals & Real-time

Signals broadcast on the platform signal bus ([core/anomaly-common/src/index.ts](../../core/anomaly-common/src/index.ts)):

- `ANOMALY_STATE_CHANGED` — Fires on any anomaly lifecycle transition. Carries `{ systemId, anomalyId, newState }`. Dashboard feed and status badges listen for this.
- `ANOMALY_BASELINE_UPDATED` — Fires when a baseline is recomputed by the background analyzer. Carries `{ systemId, configurationId, fieldPath, mean, stdDev, sampleCount }`. Chart range bands and trend lines re-render live.
- `ANOMALY_TREND_DETECTED` — Phase 2. Fires when a new drift transitions to confirmed `anomaly`. Carries `{ systemId, anomalyId, fieldPath }`.

---

*Design authored 2026-04-28. Phase 2 + as-built reconciliation 2026-04-29.*
