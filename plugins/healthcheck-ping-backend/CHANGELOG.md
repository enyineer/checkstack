# @checkstack/healthcheck-ping-backend

## 0.4.5

### Patch Changes

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/backend-api@0.34.1

## 0.4.4

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/backend-api@0.34.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/common@0.23.0

## 0.4.3

### Patch Changes

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/common@0.22.0

## 0.4.2

### Patch Changes

- @checkstack/healthcheck-common@1.16.2
- @checkstack/backend-api@0.32.1

## 0.4.1

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/healthcheck-common@1.16.1

## 0.4.0

### Minor Changes

- 43e4484: Extend `{{ … }}` environment templating across every built-in health-check type
  and add editor UX for it, so one check config can cover N environments (mirrors
  the existing HTTP `url` pattern).

  Templatable connection/target fields now marked `x-templatable`:

  - TLS: `host`, `servername`; TCP: `host`; Ping: `host`; gRPC: `host`, `service`.
  - MySQL / Postgres: `host`, `database`, `user`, `query`.
  - SSH: `host`, `username`, `command`; Redis: `host`, `args`; RCON: `host`,
    `command`.
  - DNS: `hostname`, `nameserver`; Jenkins: `url` (`baseUrl`), `jobName`;
    Container: `endpoint`, `container`.
  - SNMP: `host` (strategy), `oid` (collector).
  - Script (shell): `cwd` (working directory).

  This closes the last gaps so the coverage is now truly every built-in
  health-check type. The Script collectors' `script` bodies are deliberately NOT
  templatable: rendering `{{ … }}` into shell/TypeScript source would splice env
  values into executed code. Per-environment data reaches those scripts safely via
  the reserved `CHECKSTACK_ENV_*` shell vars (shell collector) and
  `globalThis.context.environment` (inline collector) instead.

  Because templating strips `{{ }}` and renders an undefined variable to an empty
  string, every REQUIRED templatable field now has a post-render config-error
  guard so an empty/invalid render is treated as a transport failure instead of a
  silent "healthy" empty probe. Strategy connection fields (host, database, user,
  endpoint, container, Jenkins base URL, SNMP host) throw from `createClient`;
  collector target fields (query, command, hostname, jobName, SNMP oid) return a
  `CollectorResult` with an `error`. Jenkins `baseUrl` moves its `.url()` validation to post-render.
  Secret fields (passwords/tokens/keys) are never templatable; optional fields
  (SNI `servername`, gRPC `service`, DNS `nameserver`, Redis `args`, Script `cwd`)
  are templatable but not non-empty-guarded, since an empty render is a legitimate
  "unset". SSRF/egress guards continue to run on the rendered host (rendering
  happens before `createClient`).

  Editor UX (`@checkstack/ui` + `@checkstack/healthcheck-frontend`):

  - The environment "Preview as" picker + live preview line now also apply to the
    strategy (connection) form, not just collector forms, so host/port templates
    preview too.
  - A single-line templatable field shows a small "Templating" badge next to its
    label and, when a completion provider is supplied, renders a
    `TemplateValueInput` with `{{ … }}` autocomplete. The health-check editor
    seeds the provider with the fixed `environment.* / check.* / system.*`
    namespace (`createReferenceCompletionProvider`, new `@checkstack/ui` export),
    and `DynamicForm` gains a `templatableFieldsOnly` prop so only `x-templatable`
    fields become template inputs (automation keeps templating every string field).

  BREAKING CHANGE: none. Existing non-templatable configs and stored values are
  unaffected; only fields explicitly marked `x-templatable` change behavior.

  The `@checkstack/ai-backend` bump reflects the regenerated docs index for the
  updated health-check collector and config-schema templating documentation.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/backend-api@0.31.1

## 0.3.21

### Patch Changes

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0

## 0.3.20

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
  - @checkstack/backend-api@0.30.0
  - @checkstack/healthcheck-common@1.14.0

## 0.3.19

### Patch Changes

- c55d7c6: Unify the healthcheck chart system on the `@checkstack/ui` SVG kit and
  redesign the HealthCheck drawer.

  - `@checkstack/ui` gains six chart primitives (each with a Storybook story):
    `StackedTimeline` (stacked status counts per bucket on the colorblind-safe
    status triad), `ChartTooltip` + `useBandHover` (the one shared chart
    tooltip and its cursor hit-testing), `ChartCard` / `chartCardChromeClass`
    (the premium gradient card chrome, flat on low-power devices), `StatTile`
    (number-led metric tile with delta chip, sparkline/ribbon footer, and
    click-to-expand disclosure), `DistributionBar` (stacked horizontal
    distribution + legend, replaces pies), and `CategoryRibbon` (categorical
    history ribbon). `TimeSeriesChart` gains a hover tooltip with a crosshair
    marker.
  - `@checkstack/common` adds four optional chart metadata keys to
    `BaseHealthResultMeta`: `x-chart-priority` (tile sort weight, lower first,
    default 100), `x-chart-good-direction` (`"up" | "down"`, which direction
    of change is an improvement; consumers fall back to
    `x-anomaly-direction`), and `x-chart-true-label` / `x-chart-false-label`
    (prose for a boolean field's values wherever they surface in text, e.g. a
    dominance chip reading "Usually successful (98%)" instead of "Usually
    true"). Built-in collector backends annotate their headline metrics and
    boolean fields accordingly (purely additive metadata).
  - `@checkstack/healthcheck-frontend` rebuilds the drawer: a hero status
    banner (status pill, healthy %, avg latency, interval, last run with the
    exact datetime on hover, full-width status ribbon) replaces the metric
    tiles; the status timeline and latency heroes share the `ChartCard`
    chrome; the auto-generated charts become a prioritized, click-to-expand
    2-up tile grid (collector ids demoted to hover titles); the anomaly
    Expected/Trend derivation is consolidated into one tested module shared by
    the latency hero and the tiles.

  BREAKING CHANGES: `recharts` is removed from `@checkstack/healthcheck-frontend`
  (and the unused dependency from `@checkstack/ui`); the
  `HealthCheckStatusTimeline` and `SparklineTooltip` components are deleted.
  Extensions rendering into `HealthCheckDiagramSlot` should build on the
  `@checkstack/ui` chart primitives instead.

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1

## 0.3.18

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0

## 0.3.17

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0

## 0.3.16

### Patch Changes

- Updated dependencies [0cac684]
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/backend-api@0.27.1

## 0.3.15

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0

## 0.3.14

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/backend-api@0.26.1

## 0.3.13

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/common@0.17.0

## 0.3.12

### Patch Changes

- 8cad340: Retune anomaly-detection defaults across every health-check strategy and the
  hardware collector for a low-noise, problem-focused out-of-the-box experience.

  The detection engine already learns a per-metric baseline, debounces with a
  confirmation window, and applies practical-significance floors. This pass tunes
  the per-metric **defaults** so a fresh install alerts only on genuine,
  statistically-significant, problem-mapping deviations instead of flooding on
  every metric that wiggles. 264 metrics were reviewed:

  - **Default-disabled** the high-noise and un-baselineable classes that were
    alerting for no good reason: raw identifiers and counts (status codes, error
    and row counts, build counts, player and executor counts), config echoes and
    near-constants (probe packet counts, CPU core count, total/swap memory),
    payload-size and other run-to-run-volatile values, and deterministic values
    like certificate days-remaining (governed by the check's own static-threshold
    health logic, not statistics). These stay chartable and can be re-enabled per
    field.
  - **Hardened** the signals that should alert - latency/response/execution time
    and availability/success/saturation percentages - with confirmation windows
    and absolute + relative floors so brief spikes and sub-threshold jitter no
    longer flap, and prefer percentage metrics over their absolute twins.

  No detection-engine or schema changes; only per-metric `x-anomaly-*` defaults.
  Users who had opted into any now-disabled metric keep their explicit override.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/backend-api@0.25.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0

## 0.3.11

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1

## 0.3.10

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/healthcheck-common@1.7.1

## 0.3.9

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0

## 0.3.8

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/backend-api@0.22.0
  - @checkstack/healthcheck-common@1.6.2

## 0.3.7

### Patch Changes

- @checkstack/healthcheck-common@1.6.1
- @checkstack/backend-api@0.21.7

## 0.3.6

### Patch Changes

- Updated dependencies [0b6f01b]
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/backend-api@0.21.6

## 0.3.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/healthcheck-common@1.5.4

## 0.3.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4

## 0.3.3

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/healthcheck-common@1.5.3

## 0.3.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/healthcheck-common@1.5.2

## 0.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/healthcheck-common@1.5.1

## 0.3.0

### Minor Changes

- 9dcc848: Health-check strategy and collector configs now migrate-then-validate when loaded, instead of being cast/rendered raw.

  These configs declared `version: 2`/`3` migrations but the load path never ran them: stored values are persisted UNVERSIONED, and the executor cast them straight to the strategy/collector type. Both the execution path (`queue-executor`) and the read API (`mapConfig`, feeding router / frontend / gitops `getConfiguration`) now use assume-v1-on-read (`Versioned.parseAssumingV1`): wrap as version 1, run the declared chain, then validate. Order is preserved: migrate -> secret resolve -> template render -> execute. An unregistered strategy/collector or a failed migrate falls back to the raw stored blob rather than dropping the configuration. Every reshaper migration is now IDEMPOTENT, guarding on its legacy discriminator so already-current data passes through untouched.

  BREAKING CHANGE: for any config GENUINELY at version 1 in the database (e.g. an HTTP strategy still carrying `url`/`method`, or an execute collector still carrying `command`/`args`), the declared migrations now actually RUN on load, so the loaded/returned shape changes for such rows. This is the intended fix - those fields were already supposed to have been migrated away. Configs already at the current shape are unaffected. No data backfill is performed; migration is applied on every read.

  This is a beta minor.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/common@0.13.0

## 0.2.23

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0

## 0.2.22

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/healthcheck-common@1.4.0

## 0.2.21

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/healthcheck-common@1.3.0

## 0.2.20

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/backend-api@0.17.1

## 0.2.19

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/healthcheck-common@1.1.2

## 0.2.18

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/healthcheck-common@1.1.1

## 0.2.17

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3

## 0.2.16

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/backend-api@0.15.2

## 0.2.15

### Patch Changes

- 42abfff: Add practical-significance floors to anomaly detection.

  Two new schema annotations — `x-anomaly-min-absolute-delta` and `x-anomaly-min-relative-delta` — let plugin authors and operators suppress alerts whose statistical deviation is large but practical impact is negligible. Both floors must clear in addition to the existing μ ± Nσ trigger; defaults are 0 (disabled) so existing behaviour is unchanged.

  This is the fix for cases like a 6 ms latency baseline whose σ ≈ 1 ms causes routine 20 ms blips to fire as anomalies despite Δ=14 ms being operationally irrelevant. With `min-absolute-delta: 50` and `min-relative-delta: 0.5`, those blips stay silent while a 6 ms → 200 ms spike still fires.

  Built-in plugins ship with sensible defaults applied to every per-run field: 50 ms + 50 % for ms-unit fields, 5 percentage points for `%`-unit fields, 1 + 25 % for counter fields, 1 GB + 5 % for disk fields, 50 MB + 10 % for memory fields, 1 day for TLS expiry, 0.5 + 25 % for load average, 1 + 5 % for Minecraft TPS. Operators can override per-system or per-field via the assignment UI.

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/healthcheck-common@1.0.2

## 0.2.14

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/healthcheck-common@1.0.1

## 0.2.13

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/common@0.7.0
  - @checkstack/healthcheck-common@1.0.0

## 0.2.12

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/backend-api@0.14.0

## 0.2.11

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/backend-api@0.13.1

## 0.2.10

### Patch Changes

- 8d1ef12: ## Downstream consumer bumps for the anomaly detection + cache system rollout

  Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

  - **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
  - **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
  - **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
  - **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0

## 0.2.9

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/backend-api@0.12.0

## 0.2.8

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/healthcheck-common@0.10.1

## 0.2.7

### Patch Changes

- 54a5f80: ### Health Check Editor Redesign — IDE-Style Experience

  Replaces the modal-based health check editor with a full-page, IDE-style experience:

  - **Strategy Picker Page**: New `/config/create` page with categorized strategy discovery, search filtering, and grouped card grid layout
  - **IDE Editor Page**: New `/config/:configId/edit` page with a split-view layout — explorer tree on the left, editor panel on the right
  - **Strategy Categories**: Introduces `StrategyCategory` enum with 16 categories (Networking, Database, Infrastructure, etc.) — all 13 strategy plugins now declare their category
  - **New RPC Endpoint**: Added `getConfiguration` (singular by ID) for efficient single-resource fetching on the edit page
  - **Explorer Tree**: Left-hand navigation with General, Check Items (collectors), and Access Control sections, with real-time validation indicators
  - **Validation Status Bar**: Bottom bar showing aggregated validation issues with clickable navigation
  - **Unsaved Changes Guard**: Browser `beforeunload` protection when the form is dirty
  - **Responsive Design**: Split-view on desktop, stacked layout on mobile
  - **Deleted**: Legacy `HealthCheckEditor.tsx` modal component

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/backend-api@0.11.0

## 0.2.6

### Patch Changes

- Updated dependencies [1f191cf]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/backend-api@0.10.1

## 0.2.5

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0

## 0.2.4

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0

## 0.2.3

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/healthcheck-common@0.8.4

## 0.2.2

### Patch Changes

- 0ebbe56: Security Vulnerability Remediation completed:
  - Refactored core authorization to Fail-Closed architecture with secure defaults.
  - Implemented `assertTeamManagementAccess` to resolve BOLA in Teams Management.
  - Protected internal S2S capabilities via explicit wildcard `serviceScope` definitions.
  - Disarmed OS Command Injection in DiskCollector via strict regex validation and bash escaping.
  - Re-architected inline script processing executing scripts in sandboxed Web Worker contexts.
  - Isolated subprocess environment scopes in PingStrategy limiting variable leakage.
  - Enforced strict token/API Key parsing with URLSearchParams checking.
  - Explicitly fail-fast on missing DATABASE_URL configuration across independent backend clusters.
  - Activated strict HTTP Security Headers (HSTS, CSP, X-Frame-Options) across the API automatically.
- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/healthcheck-common@0.8.3

## 0.2.1

### Patch Changes

- 869b4ab: ## Health Check Execution Improvements

  ### Breaking Changes (backend-api)

  - `HealthCheckStrategy.createClient()` now accepts `unknown` instead of `TConfig` due to TypeScript contravariance constraints. Implementations should use `this.config.validate(config)` to narrow the type.

  ### Features

  - **Platform-level hard timeout**: The executor now wraps the entire health check execution (connection + all collectors) in a single timeout, ensuring checks never hang indefinitely.
  - **Parallel collector execution**: Collectors now run in parallel using `Promise.allSettled()`, improving performance while ensuring all collectors complete regardless of individual failures.
  - **Base strategy config schema**: All strategy configs now extend `baseStrategyConfigSchema` which provides a standardized `timeout` field with sensible defaults (30s, min 100ms).

  ### Fixes

  - Fixed HTTP and Jenkins strategies clearing timeouts before reading the full response body.
  - Simplified registry type signatures by using default type parameters.

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0

## 0.2.0

### Minor Changes

- 3dd1914: Migrate health check strategies to VersionedAggregated with \_type discriminator

  All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

  **Key changes:**

  - **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
  - The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
  - Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
  - `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
  - `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
  - Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

  **Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0

## 0.1.14

### Patch Changes

- 48c2080: Migrate aggregation from batch to incremental (`mergeResult`)

  ### Breaking Changes (Internal)

  - Replaced `aggregateResult(runs[])` with `mergeResult(existing, run)` interface across all HealthCheckStrategy and CollectorStrategy implementations

  ### New Features

  - Added incremental aggregation utilities in `@checkstack/backend-api`:
    - `mergeCounter()` - track occurrences
    - `mergeAverage()` - track sum/count, compute avg
    - `mergeRate()` - track success/total, compute %
    - `mergeMinMax()` - track min/max values
  - Exported Zod schemas for internal state: `averageStateSchema`, `rateStateSchema`, `minMaxStateSchema`, `counterStateSchema`

  ### Improvements

  - Enables O(1) storage overhead by maintaining incremental aggregation state
  - Prepares for real-time hourly aggregation without batch accumulation

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/healthcheck-common@0.8.2

## 0.1.13

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/healthcheck-common@0.8.1

## 0.1.12

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.1.11

### Patch Changes

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0

## 0.1.10

### Patch Changes

- Updated dependencies [11d2679]
  - @checkstack/healthcheck-common@0.6.0

## 0.1.9

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1

## 0.1.8

### Patch Changes

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0

## 0.1.7

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2

## 0.1.6

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/healthcheck-common@0.4.1

## 0.1.5

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3

## 0.1.4

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/healthcheck-common@0.4.0

## 0.1.3

### Patch Changes

- @checkstack/backend-api@0.3.1

## 0.1.2

### Patch Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0

## 0.1.0

### Minor Changes

- f5b1f49: Refactored health check strategies to use `createClient()` pattern with built-in collectors.

  **Strategy Changes:**

  - Replaced `execute()` with `createClient()` that returns a transport client
  - Strategy configs now only contain connection parameters
  - Collector configs handle what to do with the connection

  **Built-in Collectors Added:**

  - DNS: `LookupCollector` for hostname resolution
  - gRPC: `HealthCollector` for gRPC health protocol
  - HTTP: `RequestCollector` for HTTP requests
  - MySQL: `QueryCollector` for database queries
  - Ping: `PingCollector` for ICMP ping
  - Postgres: `QueryCollector` for database queries
  - Redis: `CommandCollector` for Redis commands
  - Script: `ExecuteCollector` for script execution
  - SSH: `CommandCollector` for SSH commands
  - TCP: `BannerCollector` for TCP banner grabbing
  - TLS: `CertificateCollector` for certificate inspection

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/healthcheck-common@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/healthcheck-common@0.1.0
