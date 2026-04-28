# Anomaly Detection for Health Check Results

> **Status**: Design — Pending Implementation  
> **Date**: 2026-04-28  
> **Scope**: Phase 1 (Spike/Drop Detection) + Prerequisites  
> **Future**: Phase 2 (Trend Drift) · Phase 3 (Cross-Metric Correlation)

## Overview

Add adaptive, baseline-learning anomaly detection to Checkstack's health check system. Rather than relying on static thresholds, the engine continuously learns what "normal" looks like for each metric by analyzing historical data, computing statistical baselines, and tracking natural variance. It alerts only when behavior genuinely deviates beyond the learned noise floor — eliminating the alert fatigue caused by fixed threshold configurations.

The system is **schema-driven**: it auto-infers anomaly detection behavior from existing `x-chart-*` metadata on result fields, with explicit overrides available for plugin authors and end-user operators.

## Design Principles

1. **Zero-config for 80% of metrics** — Auto-inference from existing chart metadata means most collectors get anomaly detection without any code changes.
2. **Three-layer override model** — Engine defaults → Developer annotations → User UI configuration.
3. **No false positives over missed detections** — Adaptive noise floor + confirmation window ensures only real anomalies generate notifications.
4. **Pure statistical core** — The detection engine is a stateless, side-effect-free module with deterministic inputs/outputs, enabling exhaustive unit testing.
5. **Schema-driven extensibility** — All detection behavior is derived from schema metadata, ensuring new strategies and collectors automatically participate.

---

## 1. Schema Extensions — The `x-anomaly-*` Metadata Family

### 1.1 HealthResultMeta Additions

Extend the existing `HealthResultMeta` interface in `core/common/src/chart-types.ts`:

```typescript
export interface HealthResultMeta {
  // ... existing keys ...

  /**
   * Override the anomaly detection direction for this field.
   * - "higher-is-better": Alert when value drops (e.g., success rate, availability)
   * - "lower-is-better": Alert when value rises (e.g., latency, error count)
   * - "deviation": Alert on any significant change in either direction (e.g., player count)
   */
  "x-anomaly-direction"?: "higher-is-better" | "lower-is-better" | "deviation";

  /**
   * Disable anomaly detection for this field entirely.
   * Use for fields where value changes are expected (e.g., server version strings).
   */
  "x-anomaly-ignore"?: boolean;

  /**
   * Sensitivity multiplier for this field (default: 1.0).
   * Higher values = fewer alerts (wider threshold).
   * Lower values = more alerts (tighter threshold).
   * Applied as: threshold = μ ± (3σ × sensitivity)
   */
  "x-anomaly-sensitivity"?: number;
}
```

### 1.2 Auto-Inference Rules

When no explicit `x-anomaly-*` metadata is present, the engine infers detection behavior from existing chart metadata:

| Chart Type | Unit Match | Inferred Direction | Rationale |
|:-----------|:-----------|:-------------------|:----------|
| `line` | Time units (`ms`, `s`, `sec`, `μs`, `ns`, `min`, `minutes`, `h`, `hours`, `d`, `days`, `w`, `weeks`) | `lower-is-better` | Duration/latency metrics |
| `line` | `%` | `higher-is-better` | Percentage metrics (availability) |
| `line` | Other / none | `deviation` | Unknown semantics, detect any change |
| `gauge` | `%` | `higher-is-better` | Success rates, availability |
| `gauge` | Other | `deviation` | Ambiguous direction |
| `counter` | Any | `deviation` | Could be errors (lower) or pods (higher) |
| `boolean` | — | Dominant state tracking | Alert on flip from dominant value |
| `text` | — | Dominant state tracking | Alert on shift from stable value |
| `status` | — | Dominant state tracking | Alert on shift from stable value |

**Time unit detection set**:
```typescript
const TIME_UNITS = new Set(["ms", "s", "sec", "μs", "ns", "min", "minutes", "h", "hours", "d", "days", "w", "weeks"]);
```

**Dominance-based detection** (boolean/text/status): These fields track a "dominance ratio" — the percentage of recent runs with the most common value. An anomaly fires when:
1. The current value differs from the dominant value, AND
2. The dominance ratio exceeds 90% (configurable)

This prevents false positives on fields that naturally alternate between states.

### 1.3 Three-Layer Override Model

| Layer | Who | How | Scope |
|:------|:----|:----|:------|
| **Layer 1** | Engine | Auto-infers from `x-chart-type` + `x-chart-unit` | All fields |
| **Layer 2** | Plugin Developer | Annotates via `x-anomaly-*` on schema factories | Per field |
| **Layer 3** | User/Operator | Configures via assignment-level UI settings | Per assignment + per field |

Each layer overrides the previous. Layer 3 (user) always wins.

---

## 2. Prerequisites — CacheProvider Abstraction

### 2.1 CacheProvider Interface

Create a generic cache abstraction in `core/cache-api`:

```typescript
export interface CacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

### 2.2 Scoped Cache Factory (Plugin Isolation)

Plugins never receive the raw `CacheProvider` directly. Instead, the backend provides a **scoped factory function** during plugin initialization (following the existing Scoped Registry Pattern used by `HealthCheckRegistry`):

```typescript
// Platform provides this to plugins during init
function createScopedCache(pluginId: string, provider: CacheProvider): CacheProvider {
  return {
    get: (key) => provider.get(`${pluginId}:${key}`),
    set: (key, value, ttlMs) => provider.set(`${pluginId}:${key}`, value, ttlMs),
    delete: (key) => provider.delete(`${pluginId}:${key}`),
  };
}
```

**Plugin usage**:
```typescript
// In plugin init — receives a pre-scoped cache
export default function init({ cache }: PluginContext) {
  // Keys are automatically namespaced: "my-plugin:baseline:abc123"
  await cache.set("baseline:abc123", baselineData, 3600_000);
  const data = await cache.get("baseline:abc123");
}
```

This ensures:
- **Key isolation**: No collisions between plugins using the same key names
- **Zero boilerplate**: Plugin authors don't need to remember to prefix keys
- **Consistent with existing patterns**: Mirrors the scoped registry factory for strategy IDs

### 2.3 InMemoryCachePlugin (`plugins/cache-memory-backend`)

Following the same pattern as `plugins/queue-memory-backend`, the in-memory cache implementation lives in a **plugin**, not in core. The `core/cache-api` package only defines the `CacheProvider` interface and `CachePlugin` contract — the actual implementation is pluggable.

Initial implementation uses a `Map` with TTL-based eviction. Suitable for single-instance deployments. A future `plugins/cache-redis-backend` can reuse the queue's Redis connection.

### 2.4 Infrastructure Configuration UI (IDE Editor Pattern)

The existing "Queue Configuration" page is redesigned into an **"Infrastructure Configuration"** page using the platform's **IDE Editor** UI pattern with tabs. Each infrastructure concern gets its own tab, and plugins can register additional tabs via extension slots.

**Built-in tabs**:
- **Queue** — Queue backend selection (BullMQ/Redis, In-Memory), concurrency, retry settings (migrated from the current Queue Config page)
- **Cache** — Cache backend selection (In-Memory, future: Redis), TTL defaults, eviction policy

**Plugin extension**:
The Infrastructure Configuration page and its slot definition live in a **core package** — either the existing `core/frontend` or a new dedicated `core/infrastructure-frontend` plugin. This makes it a platform-level extension point that feature plugins extend *into*, rather than being owned by any specific feature.

Plugins register additional tabs via the slot (e.g., a future "Storage" tab for blob storage, or "Telemetry" for external metrics export):

```typescript
// Defined in core — the shell page and slot
export const infrastructureConfigSlot = createSlotDefinition<{
  label: string;
  icon: React.ComponentType;
  component: React.ComponentType;
}>("infrastructure-config");
```

The built-in Queue and Cache tabs themselves are registered *through this same slot mechanism* — they are not hardcoded into the page. This ensures the pattern is dogfooded from day one.

**Auto-linking**: When Redis is configured for the queue, the cache tab auto-defaults to Redis (same connection) but can be configured independently.

---

## 3. The Statistical Core — Baseline Engine

### 3.1 Package: `core/anomaly-common` (Engine Module)

A pure, stateless module with zero dependencies on database, cache, or framework. All functions take explicit inputs and return deterministic outputs. **This is where 90% of unit tests live.**

### 3.2 Baseline Computation

Runs in the background job. Uses a sliding window of hourly aggregated data (default: 7 days, configurable per assignment).

For each monitored numeric field, computes:

| Metric | Formula | Purpose |
|:-------|:--------|:--------|
| **Mean (μ)** | `Σ values / n` | Expected value |
| **Standard Deviation (σ)** | `√(Σ(value - μ)² / n)` | Natural noise floor |
| **Trend coefficient** | Linear regression slope | Phase 2: drift detection |

**Stored as a lightweight JSON baseline object**:

```typescript
interface FieldBaseline {
  /** The expected value */
  mean: number;
  /** The natural variance */
  stdDev: number;
  /** Linear regression slope (for Phase 2) */
  trendSlope: number;
  /** Number of data points used */
  sampleCount: number;
  /** When this baseline was last computed */
  computedAt: string; // ISO timestamp
  /** Dominance tracking for boolean/text/status fields */
  dominantValue?: string | boolean;
  dominantRatio?: number;
}
```

Baselines are persisted to the database and cached via the `CacheProvider` for fast inline lookups.

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

New database table `anomalies`:

| Column | Type | Description |
|:-------|:-----|:------------|
| `id` | UUID | Primary key |
| `systemId` | UUID (FK) | Affected system |
| `assignmentId` | UUID (FK) | Health check assignment that detected it |
| `fieldPath` | String | Specific metric path (e.g., `collectors.request-abc.responseTimeMs`) |
| `state` | Enum | `suspicious`, `anomaly`, `recovered` |
| `direction` | Enum | `above`, `below`, `changed` |
| `baselineValue` | Number | Expected value (μ) at detection time |
| `baselineStdDev` | Number | Noise floor (σ) at detection time |
| `observedValue` | Number/String | Actual value that triggered detection |
| `deviation` | Number | How many σ from baseline |
| `suspiciousRunCount` | Number | Consecutive anomalous runs while suspicious |
| `confirmationThreshold` | Number | Runs required for confirmation (snapshot at creation) |
| `startedAt` | Timestamp | When the metric first deviated |
| `confirmedAt` | Timestamp | When it escalated to anomaly (nullable) |
| `recoveredAt` | Timestamp | When it returned to normal (nullable) |
| `metadata` | JSONB | Additional context (trend data, related anomalies) |

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
   - Query hourly aggregated data for the sliding window
   - Compute baselines (mean, σ, trend slope) for each monitored field
   - Persist baselines to database and update cache
2. Detect slow drifts (Phase 2): If trend slope exceeds threshold over the window
3. Cross-metric correlation (Phase 3): Identify correlated anomaly patterns across systems

---

## 6. Visualization

### 6.1 Expected Range Bands (Auto-Chart Integration)

On existing `AutoChartGrid` line charts:
- Render a translucent **shaded band** between `μ - 3σ` and `μ + 3σ` (the "expected range")
- Data points outside the band are highlighted:
  - **Orange dots**: `suspicious` state
  - **Red dots**: Confirmed `anomaly`
- The band adapts live as baselines update — users see the engine "learning"

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

On the existing health check assignment editor, a new "Anomaly Detection" section:

| Setting | Type | Default | Description |
|:--------|:-----|:--------|:------------|
| **Enabled** | Toggle | `true` | Global enable/disable for this assignment |
| **Sensitivity** | Slider (0.5 – 3.0) | `1.0` | Threshold multiplier. Higher = fewer alerts |
| **Confirmation Window** | Number input | `3` | Consecutive anomalous runs before escalation |
| **Baseline Window** | Duration selector | `7d` | How much history to use for baseline computation |
| **Notify** | Toggle | `true` | Generate notifications (disable for silent monitoring) |

**Per-field overrides table**: Auto-populated from the strategy/collector schemas. Each row shows:
- Field name and inferred direction
- Toggle to enable/disable detection
- Direction override dropdown
- Sensitivity override slider

---

## 9. Package Structure

| Package | Purpose |
|:--------|:--------|
| `core/cache-api` | `CacheProvider` interface, `CachePlugin` contract, scoped cache factory (mirrors `core/queue-api`) |
| `plugins/cache-memory-backend` | `InMemoryCachePlugin` — Map-based implementation with TTL eviction (mirrors `plugins/queue-memory-backend`) |
| `core/anomaly-common` | Shared types, anomaly entity schema, inference rules, direction constants **+ pure statistical core** (baseline computation, detection algorithms, state machine). Zero frontend/backend dependencies. **90% of test coverage lives here.** |
| `core/anomaly-backend` | Backend plugin — DB schema, migrations, background job, cache integration, notification sidecar, RPC endpoints, inline detector hook |
| `core/anomaly-frontend` | UI — range band overlays, anomaly markers, feed component, assignment config section, status badge integration |

---

## 10. Phasing

| Phase | Scope | What Ships |
|:------|:------|:-----------|
| **Pre-req** | CacheProvider abstraction | `core/cache-api` (interface + scoped factory), `plugins/cache-memory-backend` (InMemoryCachePlugin), Infrastructure Configuration page (IDE Editor pattern) with Queue + Cache tabs |
| **Phase 1** | Spike/Drop Detection | Baseline engine, fast inline detector, anomaly entity + lifecycle, confirmation window, adaptive noise floor, UI range bands, anomaly feed, notifications, assignment-level configuration |
| **Phase 2** | Trend Drift Detection | Background trend analyzer using linear regression slope, "creeping degradation" alerts, trend visualization overlays |
| **Phase 3** | Cross-Metric Correlation | Correlation engine across systems/metrics, blast radius hints, "When A degrades, B follows" detection |
| **Phase 4** | Developer Documentation | `docs/backend/anomaly-detection.md` — auto-inference rules, `x-anomaly-*` override reference, best practices for annotating strategy/collector result fields, worked examples for common patterns (latency, error rate, player count, boolean state), troubleshooting false positives |

Each phase builds on the previous. The schema extensions, entity model, and engine interfaces from Phase 1 are designed to support all phases without breaking changes.

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

New signals for real-time UI updates:
- `ANOMALY_STATE_CHANGED` — Fires on any state transition. Dashboard feed and status badges listen for this.
- `ANOMALY_BASELINE_UPDATED` — Fires when a baseline is recomputed. Chart range bands update live.

---

*Design authored 2026-04-28. Ready for implementation planning.*
