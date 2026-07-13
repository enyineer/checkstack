# @checkstack/notification-teams-backend

## 0.0.75

### Patch Changes

- Updated dependencies [d00e099]
  - @checkstack/backend-api@0.33.0
  - @checkstack/common@0.22.0
  - @checkstack/notification-backend@1.8.2

## 0.0.74

### Patch Changes

- @checkstack/notification-backend@1.8.1
- @checkstack/backend-api@0.32.1

## 0.0.73

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/notification-backend@1.8.0

## 0.0.72

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/backend-api@0.31.1
  - @checkstack/notification-backend@1.7.0

## 0.0.71

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/notification-backend@1.6.7

## 0.0.70

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/notification-backend@1.6.6

## 0.0.69

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/notification-backend@1.6.5

## 0.0.68

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/notification-backend@1.6.4

## 0.0.67

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/notification-backend@1.6.3

## 0.0.66

### Patch Changes

- @checkstack/notification-backend@1.6.2

## 0.0.65

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/notification-backend@1.6.1

## 0.0.64

### Patch Changes

- Updated dependencies [d1b71b6]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [53666a7]
- Updated dependencies [0d912a3]
  - @checkstack/notification-backend@1.6.0
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0

## 0.0.63

### Patch Changes

- @checkstack/notification-backend@1.5.20

## 0.0.62

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/backend-api@0.26.1
  - @checkstack/notification-backend@1.5.19

## 0.0.61

### Patch Changes

- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/common@0.17.0
  - @checkstack/notification-backend@1.5.18

## 0.0.60

### Patch Changes

- @checkstack/notification-backend@1.5.17

## 0.0.59

### Patch Changes

- 8cad340: feat(notification-common): HTML and label subject-render helpers

  Add `renderSubjectsAsHtml` and `renderSubjectLabel` to
  `@checkstack/notification-common` (re-exported from
  `@checkstack/notification-backend`) so the last two notification channels that
  still hand-rolled their affected-subjects markup are single-sourced.

  - `renderSubjectsAsHtml` renders the subjects as an HTML `<ul>` (the canonical
    `<b>Affected:</b><ul><li>...</li></ul>` Pushover fallback). It now
    HTML-escapes subject names and URLs (previously interpolated raw) and prefixes
    the status emoji when a subject carries a status hint.
  - `renderSubjectLabel` returns just `<marker> <name>` for rich-card channels
    (Teams) that lay out the URL in their own structure but want the consistent
    status-emoji-or-bullet prefix.

  The Pushover (HTML list) and Teams (FactSet title) strategy plugins now route
  their subject rendering through these helpers. Output is unchanged for ordinary
  subject names; the Teams FactSet title now carries the shared bullet prefix and
  the Pushover HTML is now escaped, both behavior-preserving for non-markup data
  and pinned by unit tests.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/notification-backend@1.5.16
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0

## 0.0.58

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/notification-backend@1.5.15

## 0.0.57

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/notification-backend@1.5.14

## 0.0.56

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/notification-backend@1.5.13

## 0.0.55

### Patch Changes

- @checkstack/notification-backend@1.5.12

## 0.0.54

### Patch Changes

- Updated dependencies [6005271]
- Updated dependencies [079369a]
  - @checkstack/backend-api@0.22.0
  - @checkstack/notification-backend@1.5.11

## 0.0.53

### Patch Changes

- @checkstack/notification-backend@1.5.10
- @checkstack/backend-api@0.21.7

## 0.0.52

### Patch Changes

- @checkstack/notification-backend@1.5.9

## 0.0.51

### Patch Changes

- @checkstack/backend-api@0.21.6
- @checkstack/notification-backend@1.5.8

## 0.0.50

### Patch Changes

- @checkstack/notification-backend@1.5.7

## 0.0.49

### Patch Changes

- @checkstack/notification-backend@1.5.6

## 0.0.48

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/notification-backend@1.5.5

## 0.0.47

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/notification-backend@1.5.4

## 0.0.46

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/notification-backend@1.5.3

## 0.0.45

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/notification-backend@1.5.2

## 0.0.44

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/notification-backend@1.5.1

## 0.0.43

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
  - @checkstack/backend-api@0.21.0
  - @checkstack/notification-backend@1.5.0
  - @checkstack/common@0.13.0

## 0.0.42

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/notification-backend@1.4.2

## 0.0.41

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/notification-backend@1.4.1

## 0.0.40

### Patch Changes

- Updated dependencies [41c77f4]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/notification-backend@1.4.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0

## 0.0.39

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/notification-backend@1.3.0
  - @checkstack/backend-api@0.17.1

## 0.0.38

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/notification-backend@1.2.0

## 0.0.37

### Patch Changes

- a06b899: Dead-code audit cleanup and a small platform of shared notification helpers.

  **Removed (dead code)**

  - `core/backend/src/plugin-manager/deregistration-guard.ts` deleted. The exported `assertCanDeregister()` was never called and was a less-complete version of the dependents+isUninstallable checks already done inline by `previewUninstallOriginator` / `uninstallOriginator` in `plugin-manager-orchestrator.ts`.
  - `createMockQueueFactory` deprecated alias removed from `@checkstack/test-utils-backend`. Use `createMockQueueManager` directly.

  **New shared helpers**

  - `@checkstack/backend-api` now exports `requestTimeoutMs()` — a Zod field builder for outbound HTTP request timeouts (1s..60s, default 10s). Replaces hand-rolled `configNumber({}).min(1000).max(60_000).default(10_000)` in `integration-webhook-backend`, `integration-script-backend`, and `healthcheck-script-backend`'s inline collector.
  - `@checkstack/notification-common` now exports `SubjectStatusSchema` / `SubjectStatus`, mirroring the existing `ImportanceSchema`.
  - `@checkstack/notification-backend` now exports:
    - `SUBJECT_STATUS_EMOJI` / `IMPORTANCE_EMOJI` — the shared status / importance emoji maps that Discord, Slack, Teams, Webex and Telegram previously each redefined inline.
    - `postJson(opts)` — a timeout-bounded `fetch` wrapper that handles non-2xx logging and error mapping for webhook-style POSTs. Returns `{ ok: true, response } | { ok: false, error }`.

  **Migrated to shared helpers**

  - Discord, Slack, Gotify, Pushover notification backends now use `postJson`. Outer try/catch + per-plugin error mapping deleted (~140 LOC).
  - Discord, Slack, Teams, Telegram, Webex notification backends now use `IMPORTANCE_EMOJI`. Discord, Slack, Teams use `SUBJECT_STATUS_EMOJI`.
  - Teams, Webex, Backstage, Telegram kept their inline fetch/Bot logic: their error strings surface server response bodies to operators, or the transport isn't raw `fetch` (Telegram uses `grammy`'s `Bot`).

  **API surface tightening**

  - Per-plugin test-only re-exports in 6 notification backends (Pushover, Gotify, Backstage, Slack, Discord, Teams) and the `CertificateInfo` interface in `healthcheck-tls-backend/strategy.ts` are now JSDoc-tagged `@internal`. No behaviour change; signals that downstream consumers must not depend on them.

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/notification-backend@1.1.0

## 0.0.36

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/notification-backend@1.0.5

## 0.0.35

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/notification-backend@1.0.4

## 0.0.34

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/notification-backend@1.0.3

## 0.0.33

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/notification-backend@1.0.2

## 0.0.32

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/notification-backend@1.0.1
  - @checkstack/common@0.7.0

## 0.0.31

### Patch Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/notification-backend@1.0.0
  - @checkstack/backend-api@0.14.0

## 0.0.30

### Patch Changes

- @checkstack/backend-api@0.13.1
- @checkstack/notification-backend@0.2.1

## 0.0.29

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
  - @checkstack/common@0.7.0
  - @checkstack/notification-backend@0.2.0
  - @checkstack/backend-api@0.13.0

## 0.0.28

### Patch Changes

- @checkstack/notification-backend@0.1.23

## 0.0.27

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/notification-backend@0.1.22

## 0.0.26

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
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/notification-backend@0.1.21

## 0.0.25

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/notification-backend@0.1.20

## 0.0.24

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/notification-backend@0.1.19

## 0.0.23

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/notification-backend@0.1.18

## 0.0.22

### Patch Changes

- @checkstack/notification-backend@0.1.17

## 0.0.21

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/notification-backend@0.1.16

## 0.0.20

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/notification-backend@0.1.15

## 0.0.19

### Patch Changes

- @checkstack/notification-backend@0.1.14

## 0.0.18

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/notification-backend@0.1.13

## 0.0.17

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/notification-backend@0.1.12

## 0.0.16

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/notification-backend@0.1.11

## 0.0.15

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/notification-backend@0.1.10

## 0.0.14

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/notification-backend@0.1.9

## 0.0.13

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/notification-backend@0.1.8

## 0.0.12

### Patch Changes

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/notification-backend@0.1.7
  - @checkstack/backend-api@0.5.0

## 0.0.11

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/notification-backend@0.1.6

## 0.0.10

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/notification-backend@0.1.5

## 0.0.9

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/notification-backend@0.1.4

## 0.0.8

### Patch Changes

- @checkstack/notification-backend@0.1.3

## 0.0.7

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/notification-backend@0.1.2

## 0.0.6

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/notification-backend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/notification-backend@0.1.0

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/notification-backend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/notification-backend@0.0.3
  - @checkstack/common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/notification-backend@0.0.2

## 0.1.0

### Minor Changes

- 4c5aa9e: Add Microsoft Teams notification strategy - sends alerts to users via OAuth/Graph API

  - Admin configures Azure AD app credentials (Tenant ID, Client ID, Client Secret)
  - Users link their Microsoft account via OAuth flow
  - Messages sent as Adaptive Cards to 1:1 chats via Graph API
  - Supports importance-based coloring and action buttons
  - Includes detailed admin setup instructions for Azure AD configuration

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/notification-backend@0.1.2
  - @checkstack/common@0.2.0
