# Catalog UX redesign — a navigable system catalog at scale

> **Status:** IA LOCKED 2026-06-01 — maintainer approved the split browse +
> manager-gated `/config`, the group-first collapsible IA, and the new
> `CatalogBrowseHealthSlot` contract; build not started.
> **Branch:** off `main`
> **Issue:** #250
> **Goal:** turn the system catalog from an 18-line placeholder home + an
> un-filtered management list into a deliberate, **group-first browse experience**
> that stays legible and navigable at hundreds of systems across many groups.
> This was a **design-led** effort: the IA and interaction model (§2-§5) are now
> locked (§6); the build (§8) proceeds against them.

Self-contained handoff. Every current-state claim carries a `file:line` anchor so
the implementer never has to guess. The plan honours `.agent/rules/*` — no `any`,
zod for validation, typed object args, `isLowPower` guards on every animation
(`performance.md`), look-and-feel parity with sibling pages
(`code-style-guide.md`, the global frontend rules), per-package beta-minor
changesets, and same-PR docs.

---

## 0. TL;DR — the locked decisions (read this first, then §2 for the design)

All four below are **DECIDED** (maintainer-approved 2026-06-01). Rationale and
rejected alternatives are kept in §6 as the decision record.

- **DECIDED — keep browse and management split, share components.** A new
  read-only **browse** view replaces the `CatalogPage` stub at `home: "/"`; the
  existing manager-gated **management** view stays at `config: "/config"`. They
  share one component vocabulary (the same group-first list, search bar, density
  toggle) so they feel like one product, but they are two routes with two access
  postures. Rationale + the rejected "one converged gated view" in §6.1.
- **DECIDED — group-first, collapsible grouped-list is the primary navigation
  model** (not a sidebar tree, not a board). Rationale + rejected alternatives in
  §6.2.
- **DECIDED — surface health rollups inline on browse via the new
  `CatalogBrowseHealthSlot` platform contract** + the existing
  `SystemStateBadgesSlot` extension (the same decoupled mechanism
  `SystemDetailPage` already uses, `core/catalog-frontend/src/components/SystemDetailPage.tsx:110`),
  NOT by adding a `healthcheck`/`incident` dependency to `catalog-frontend`.
  Rationale + the dependency-coupling trap in §6.3.
- **DECIDED — ship the three detail-page cleanups in Phase 1** (NotFound, readable
  metadata, drop hardcoded `en-US`) as a low-risk standalone PR that does not block
  the IA. Rationale in §6.4.

All four are locked; the build (§8) proceeds against them. The new
`CatalogBrowseHealthSlot` contract is approved (§4.2, §6.3) — it still ships with
same-PR docs + a changeset per the platform-contract rules (§9, §10).

---

## 1. Current state (verified `file:line` anchors)

### 1.1 The four catalog frontend surfaces

- **`CatalogPage` — the public home, an 18-line stub.**
  `core/catalog-frontend/src/components/CatalogPage.tsx:6-18`. Renders only
  `<PageLayout title="Catalog" icon={Layers}>` + one muted `<p>` ("Welcome to the
  Service Catalog.", `:15`) and a `logger.info` on mount (`:9-11`). **There is no
  browse view at all** — non-managers land here and see nothing actionable.
- **`CatalogConfigPage` — the 523-line management page.**
  `core/catalog-frontend/src/components/CatalogConfigPage.tsx`. Gated behind
  `catalogAccess.system.manage` via `PageLayout`'s `allowed` prop (`:325-327`,
  `accessApi.useAccess` at `:49-51`). Two-column `grid grid-cols-1 lg:grid-cols-2`
  (`:335`) of a Systems card and a Groups card. CRUD + `@dnd-kit` drag-and-drop
  (sensors `:106-115`, `DndContext` `:328`, `DragOverlay` `:482`), polished
  `EmptyState` usage (`:367-382`, `:434-449`), `Tip` coaching (`:344`, `:412`),
  `ConfirmationModal` (`:512`). **Maps over `systems`/`groups` with no client-side
  filter** (`systems.map` `:385`, `groups.map` `:452`); both lists are
  `space-y-2` stacks (`:384`, `:451`) that grow unbounded.
- **`SystemDetailPage` — the per-system detail.**
  `core/catalog-frontend/src/components/SystemDetailPage.tsx`. Three concrete
  rough edges:
  - **Not-found renders `<AccessDenied />`** (`:91-101`, `notFound` state set at
    `:63-67`) — misleading; a missing id is a 404, not a permission failure.
  - **Metadata dumped as raw JSON** in a `<pre>` via
    `JSON.stringify(system.metadata, undefined, 2)` (`:279-281`).
  - **Dates hardcoded to `"en-US"`** — `toLocaleDateString("en-US", …)` at `:153`
    (created) and `:162` (updated).
  - (Healthy structure to preserve: `SystemDetailsTopSlot` `:129`,
    `SystemDetailsSlot` `:135`, `SystemStateBadgesSlot` in header `:110`,
    notification manager `:111-116`.)

### 1.2 Routing + access

- Routes: `home: "/"`, `config: "/config"`, `systemDetail: "/system/:systemId"`
  (`core/catalog-common/src/routes.ts:6-10`).
- Registration: `home → CatalogPage`, `config → CatalogConfigPage` with
  `accessRule: catalogAccess.system.manage` (`:47`), `systemDetail →
  SystemDetailPage`, all lazy-loaded
  (`core/catalog-frontend/src/index.tsx:33-56`).
- Access rules (read vs manage, system vs group vs view) live in
  `core/catalog-common/src/access.ts`; the contract gates each proc:
  `getSystems`/`getGroups` need `catalogAccess.system.read` /
  `catalogAccess.group.read` (`core/catalog-common/src/rpc-contract.ts:66-85`),
  mutations need `*.manage` (`:106-268`).

### 1.3 Data the browse view can read

- **Catalog data:** `getSystems` → `{ systems: System[] }`
  (`rpc-contract.ts:66-70`), `getGroups` → `Group[]` (`:81-85`), `getEntities` →
  `{ systems, groups }` in one call (`:55-64`). `Group` carries `systemIds`
  (used at `CatalogConfigPage.tsx:312-313`). `System` carries `name`,
  `description`, `metadata`, `createdAt`, `updatedAt` (used at
  `SystemDetailPage.tsx:146-167,270-281`).
- **Health rollup data exists but is owned by healthcheck:**
  `getBulkSystemHealthStatus({ systemIds }) → { statuses: Record<id,
  SystemHealthStatusResponse> }`
  (`core/healthcheck-common/src/rpc-contract.ts:472-484`), `status` ∈ the
  `HealthCheckStatusSchema` enum. `catalog-frontend` does **not** depend on
  `healthcheck-common` (deps in `core/catalog-frontend/package.json` — only
  auth/gitops/notification/tips/ui). So a direct bulk-health read would require a
  new cross-plugin dependency (see §6.3 for why we avoid it).
- **The decoupled rollup mechanism already in use:** `SystemStateBadgesSlot`
  (`core/catalog-common/src/slots.ts:72-74`) is a catalog-owned slot that
  healthcheck fills with `SystemHealthBadge`
  (`core/healthcheck-frontend/src/components/SystemHealthBadge.tsx:21-41`).
  `SystemDetailPage` already renders it in the header
  (`SystemDetailPage.tsx:110`). The badge optionally reads bulk data from a
  `SystemBadgeDataProvider` context
  (`useSystemBadgeDataOptional`, `SystemHealthBadge.tsx:23-33`).
- **Reactive entities (backend):** catalog defines reactive `catalog-system` /
  `catalog-group` entities with plugin-backed `read`
  (`core/catalog-backend/src/index.ts:128-150`), but their *current state* is the
  `name`/`description`/`metadata` already returned by `getSystems`/`getGroups` —
  **not** health. Health is a separate compute-on-read entity owned by
  healthcheck (per `reactive-automation-engine.md` §10.3). So "catalog owns
  reactive system/group entities with health state" in the issue is imprecise:
  catalog owns the *system/group* entities; *health* is a healthcheck entity
  surfaced through the slot. The plan treats health as healthcheck-owned and
  reaches it through the slot.

### 1.4 The sibling "home" pages to match visually

- **`SloOverviewPage`** (`core/slo-frontend/src/pages/SloOverviewPage.tsx`) is the
  closest precedent: `PageLayout` with a `Manage …` link in `actions` (`:49-57`),
  an `EmptyState` with `steps`+`actions` when empty (`:64-82`), and a responsive
  grid of clickable `Card`s linking to detail (`:84-137`) with status `Badge`s
  (`:101-109`). Wrapped in `wrapInSuspense` (`:147`). **The browse view mirrors
  this shell exactly.**
- **`Dashboard`** (`core/dashboard-frontend/src/Dashboard.tsx`) is the closest
  precedent for *systems-with-rollups*: it wraps a system grid in
  `SystemBadgeDataProvider` (`:54`, provider at
  `core/dashboard-frontend/src/components/SystemBadgeDataProvider.tsx:50-121`)
  which bulk-fetches health+incident+maintenance and exposes
  `getSystemBadgeData(systemId)` via context. **Dashboard, not catalog, is where
  cross-plugin rollup deps live today.** The browse view stays decoupled and uses
  the slot instead (§6.3).

### 1.5 Reusable `@checkstack/ui` primitives (all exported from
`core/ui/src/index.ts`)

| Primitive | Anchor | Use in this plan |
|---|---|---|
| `PageLayout` (`title/subtitle/icon/actions/loading/allowed/maxWidth`) | `core/ui/src/components/PageLayout.tsx:11-19` | Shell for both browse + manage |
| `EmptyState` (`title/description/icon/steps/actions`) | `EmptyState.tsx:5-19` | First-run coaching empty state |
| `ListEmptyState` (`resource/description/icon/actions`) | `ListEmptyState.tsx:5-24` | "No results" for a filtered-to-empty list |
| `NotFound` (`message?`) — `isLowPower`-guarded animation | `NotFound.tsx:44-154` (guards `:48`,`:61`,`:73`,`:92`,`:114`,`:146`) | SystemDetail not-found |
| `Input` | `Input.tsx:4` | Search box |
| `Select` (Radix) | `Select.tsx:7-` | Group / health / sort filters |
| `Badge` (`success/warning/destructive/…`) | `Badge.tsx` | Group health rollup pill |
| `HealthBadge` (`healthy/degraded/unhealthy`, `compact/full`) — health colour tokens | `HealthBadge.tsx:5-57` | Reference tokens; rendered via the slot |
| `Tabs` (keyboard arrow nav built in) | `Tabs.tsx:3-` | Optional density/scope segmented control |
| `Accordion` | `Accordion.tsx` | Collapsible group sections |
| `Card`/`CardHeader`/`CardContent`/`CardTitle` | `Card.tsx` | Group + system cards |
| `PaginatedList` (`items/loading/pagination/children/emptyContent`) | `PaginatedList.tsx:6-40` | Pagination fallback for huge ungrouped lists |
| `SectionHeader` (`title/icon/description`) | `SectionHeader.tsx:4-` | Group section headers |
| `usePerformance()` → `{ isLowPower }` | `PerformanceProvider.tsx:31` | Guard all animation |
| `wrapInSuspense` | `@checkstack/frontend-api` (used `SloOverviewPage.tsx:147`) | Wrap browse page |

**Local hook to copy, not import:** `useDebouncedValue`
(`core/script-packages-frontend/src/hooks/useDebouncedValue.ts`) — there is **no
shared `useDebounce` in `@checkstack/ui`**. Copy a tiny `useDebouncedValue` into
`catalog-frontend/src/hooks/` (or lift it to `@checkstack/ui` in a follow-up; do
not unilaterally add a shared hook this PR per `code-style-guide.md`).

---

## 2. Information architecture — the LOCKED design (approved 2026-06-01)

The catalog answers three operator questions at scale: *what exists*, *where is a
specific thing*, and *what is its rolling-up health*. The IA is **group-first**:
the primary spatial organiser is the group, because that is how operators already
think (teams / products / environments — the framing in the management page's own
group `Tip`, `CatalogConfigPage.tsx:415-417`) and it is the only structure the
data model gives us (`Group.systemIds`).

### 2.1 The browse surface (`home: "/"`, read-only)

```
┌─ PageLayout title="Catalog" icon={Layers} ───────────────────────────────┐
│  actions: [ "Manage catalog →" link  (only if canManage) ]                │
│                                                                           │
│  ┌─ CatalogBrowseToolbar ────────────────────────────────────────────┐   │
│  │ [🔍 Search systems & groups]  [Group ▾] [Health ▾] [Tags ▾]        │   │
│  │                                   [Density: ▢ Comfortable / ☰ Compact] │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ── Group: Payments ───────────────────  ⬤ 12 systems · ▲ 1 degraded ──┐  │
│   │  ▸ checkout-api      [Healthy]        runbook ↗                     │  │
│   │  ▸ ledger-worker     [Degraded]                                     │  │
│   │  …                                                                  │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│  ── Group: Platform ───────────────────  ⬤ 8 systems · ⬤ all healthy ──┐  │
│   │  (collapsed)                                                        │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│  ── Ungrouped ─────────────────────────  ⬤ 3 systems ──────────────────┐  │
│   │  …                                                                  │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Group-first collapsible list.** Each group is an `Accordion`/`Card` section
  (`SectionHeader` for the header row) listing its member systems. A synthetic
  **"Ungrouped"** section collects systems in no group (computed from
  `getEntities`: `systems` minus the union of all `group.systemIds`). A system in
  multiple groups appears under each (matches the management model where a system
  can belong to many groups — `systemGroupMap` at `CatalogConfigPage.tsx:311-318`).
- **Group header carries the rollup**: member count + a health rollup pill
  (`Badge`) — e.g. "all healthy" (`success`), "1 degraded" (`warning`), "2
  unhealthy" (`destructive`). The rollup is computed client-side from the
  per-system statuses the slot surfaces (§4.2). Group health = worst member
  status (the same "a group is healthy when all of its systems are healthy"
  semantic the management `Tip` states, `CatalogConfigPage.tsx:415-417`).
- **System rows** are dense, single-line at default density: name (link to
  `systemDetail`), the `SystemStateBadgesSlot` rendering (health/maintenance/
  incident badges contributed by other plugins), and a truncated description.
  Compact density drops the description to a tooltip; comfortable density shows
  it inline (§3.3).
- **Default collapse policy:** groups with any non-healthy member are expanded;
  all-healthy groups start collapsed (so attention goes to what needs it). With
  zero health data available (healthcheck not installed / no checks), all groups
  start expanded. Persist per-group open/closed in URL state (`?open=payments,…`)
  so a shared link reopens the same view.

### 2.2 The management surface (`config: "/config"`, manager-gated)

Keep the existing `CatalogConfigPage` (DnD assignment is its reason to exist) but
**adopt the same toolbar** (search + group/health filter + density) above the two
cards, and apply the filter to both `systems.map` (`:385`) and `groups.map`
(`:452`). The DnD interaction, `EmptyState`s, `Tip`s, and `ConfirmationModal`
stay. This is where convergence pays off: the browse toolbar component is shared,
so the two surfaces feel like one tool with different verbs (browse vs. arrange).

### 2.3 The flow: browse → detail → manage

- Browse system row → `systemDetail` (read-only context: monitoring slots,
  contacts, links, groups — already built).
- Browse "Manage catalog →" (header `actions`, **only when `canManage`**) →
  `config`. Mirror `SloOverviewPage`'s `actions` link pattern
  (`SloOverviewPage.tsx:49-57`).
- Detail → "Manage this system" affordance for managers (a button in
  `headerActions` that links to `config?focus=<systemId>`, opening the editor —
  reuses the existing `?action=create` URL-param pattern at
  `CatalogConfigPage.tsx:96-103`; add a `focus` param that opens the system
  editor for that id).
- Manage → back to browse via the standard nav; the management page already lives
  under the same plugin nav entry.

### 2.4 Manager vs read-only affordances

| Affordance | Read-only user | Manager |
|---|---|---|
| Browse `/` | full browse, search, filter, density | same + "Manage catalog →" in header |
| System rows | link to detail | same + (optional) inline "edit" affordance deep-linking to `config?focus=` |
| `/config` | `PageLayout allowed={false}` → AccessDenied (existing, `:325-327`) | full CRUD + DnD |
| Empty catalog | coaching `EmptyState` *without* create actions | coaching `EmptyState` *with* "Add your first system" linking to `/config` |

Gate on `catalogAccess.system.manage` via `accessApi.useAccess`
(`CatalogConfigPage.tsx:49-51`) on the browse page too, to decide whether to show
manager affordances — read access is already enforced by the route/contract.

---

## 3. Interaction design detail

### 3.1 Search

- Single `Input` (`🔍` lucide `Search` icon) filtering **systems and groups** by
  name + description, case-insensitive `includes` — same matching the command
  palette search provider uses server-side
  (`core/catalog-backend/src/index.ts:343-351`), reproduced client-side over the
  already-loaded `getEntities` data (no new endpoint needed at operator scale —
  thousands of rows, see §5).
- Debounce input through a local `useDebouncedValue` (150ms) before filtering, to
  keep typing smooth on large lists.
- A search match inside a collapsed group **auto-expands** that group and
  highlights the matched substring. Groups with zero matches hide entirely while a
  query is active.
- Persist the query in `?q=` (URL state via `useSearchParams`, the existing
  pattern at `CatalogConfigPage.tsx:48`).

### 3.2 Filters

Three `Select` dropdowns, all reflected in URL state:

- **Group** — narrow to one group (`?group=<id>`). Mutually informs the
  group-first layout: selecting a group collapses the view to that section.
- **Health** — `all / healthy / degraded / unhealthy / unknown` (`?health=`).
  Filters system rows by the status the slot surfaces (§4.2). "unknown" = no
  health data (healthcheck absent or no checks wired).
- **Tag/metadata** — `?tag=` over `System.metadata` keys/values. Metadata is
  free-form `Record<string, unknown>`; surface only string-valued entries as
  filter chips (see §4.3 metadata rendering — same normaliser).

Filters compose (AND). When the composed result is empty, render `ListEmptyState`
(`resource="systems"`, an action to clear filters) rather than the first-run
`EmptyState`.

### 3.3 Density

- A two-option control (segmented `Tabs` or a `Toggle`): **Comfortable** (default,
  description inline, more padding) vs **Compact** (single-line rows, description
  in a `Tooltip`, tighter `space-y`). Persist in `?density=` and/or `localStorage`
  so it survives navigation.
- Density only changes per-row chrome, never which data loads.

### 3.4 Virtualization / pagination — the scale decision

- **Default: render grouped, with per-group lazy expansion.** Because the list is
  group-partitioned and all-healthy groups start collapsed, the number of mounted
  rows stays small even with hundreds of systems. Collapsed groups render only
  their header (count + rollup), not their rows.
- **Within a very large single group** (configurable threshold, default **50**
  rows), cap the rendered rows and show a "Show all N" expander, OR drop that
  group's body into `PaginatedList` (`PaginatedList.tsx:6-40`). Prefer the
  expander for simplicity; `PaginatedList` is the fallback if a single group
  routinely exceeds a few hundred.
- **Explicitly NOT introducing a windowing library** (react-virtual etc.) in this
  pass — it is not an existing dependency and group partitioning + collapse keeps
  mounted-node counts bounded. Revisit only if a measured single-group case
  exceeds what `PaginatedList` handles. (`performance.md`: prefer the simpler
  bounded approach; add complexity only for a measured reason.)

---

## 4. Component breakdown + primitive reuse

New components under `core/catalog-frontend/src/components/browse/` (split per the
file-hygiene rule — small, single-purpose modules):

| Component | Responsibility | Reuses |
|---|---|---|
| `CatalogPage` (rewrite of the stub) | Browse page shell: loads `getEntities`, derives groups + ungrouped, owns URL filter state, manager gate, renders toolbar + sections; `wrapInSuspense` | `PageLayout`, `EmptyState`, `ListEmptyState`, `wrapInSuspense`, `useAccess` |
| `CatalogBrowseToolbar` | Search `Input` + 3 `Select` filters + density control; pure controlled component (state lifted to page) | `Input`, `Select`, `Tabs`/`Toggle`, lucide `Search` |
| `CatalogGroupSection` | One collapsible group: header (name, count, health rollup `Badge`) + member rows; open state from URL | `Accordion`/`Card`, `SectionHeader`, `Badge` |
| `CatalogSystemRow` | One system: name link, `SystemStateBadgesSlot`, description (density-aware), optional manager edit affordance | `ExtensionSlot`, `Link`, `Tooltip` |
| `useCatalogBrowseState` (hook) | Parse/serialise `?q/group/health/tag/density/open` URL state; debounced query; derive filtered+grouped model | `useSearchParams`, local `useDebouncedValue` |
| `useDebouncedValue` (hook, copied) | tiny debounce | copy from `script-packages-frontend/src/hooks/useDebouncedValue.ts` |

Shared toolbar reuse: `CatalogConfigPage` imports `CatalogBrowseToolbar` and the
filtering hook so browse and manage share one search/filter implementation (§2.2).

### 4.1 PageLayout shell parity

Match `SloOverviewPage` exactly: `PageLayout` with `actions` = the conditional
"Manage catalog →" link (`SloOverviewPage.tsx:49-57`), `LoadingSpinner` while
queries load (`:59-62`), first-run `EmptyState` with `steps`+`actions` when the
catalog is empty (`:64-82`). Use `icon={Layers}` (the stub's current icon,
`CatalogPage.tsx:14`) for continuity.

### 4.2 Inline health rollup WITHOUT a new dependency (the key mechanism)

- **Per-system status** is rendered by the existing `SystemStateBadgesSlot`
  (`CatalogSystemRow` renders `<ExtensionSlot slot={SystemStateBadgesSlot}
  context={{ system }} />`, exactly as `SystemDetailPage.tsx:110` does). No
  catalog→healthcheck dependency. **Note: `SystemHealthBadge` renders NOTHING for
  healthy systems** — it returns an empty fragment when `status` is undefined or
  `"healthy"` (`SystemHealthBadge.tsx:39`). So in the Phase 2 "counts only" rows, a
  system with no visible badge means "healthy or unknown" by design — absence of a
  badge is the healthy signal, and the rows never try to infer a rollup from slot
  render output.
- **Group rollup** (count of degraded/unhealthy members for the header `Badge`)
  needs the *statuses as data*, not just rendered badges — and crucially **must
  derive "all healthy" from the bulk-data path, NOT from slot render output**,
  because healthy systems emit no badge (above). The dependency graph matters and
  was verified:
  - The bulk-data context is **owned by `dashboard-frontend`**, not
    healthcheck-frontend: `SystemBadgeDataProvider` +
    `useSystemBadgeData`/`useSystemBadgeDataOptional` live in
    `core/dashboard-frontend/src/components/SystemBadgeDataProvider.tsx:50-137`,
    and the provider itself imports `healthcheck-common`/`incident-common`/
    `maintenance-common` to bulk-fetch (`:1-14,62-80`). `SystemHealthBadge`
    consumes this context via `import { useSystemBadgeDataOptional } from
    "@checkstack/dashboard-frontend"` (`SystemHealthBadge.tsx:6,23`).
    `healthcheck-frontend` **already depends on `dashboard-frontend`** (verified in
    `core/healthcheck-frontend/package.json`).
  - **Recommended approach:** add a catalog-owned **`CatalogBrowseHealthSlot`**.
    `catalog-frontend` only **consumes** it (renders the slot + reads a context the
    slot publishes for group-header rollups); when the slot is unfilled, headers
    show counts only. `healthcheck-frontend` **fills** the slot, and its filler
    wraps `dashboard-frontend`'s existing `SystemBadgeDataProvider`
    (`SystemBadgeDataProvider.tsx:50`) over the browse list, exposing the
    bulk-fetched statuses to catalog's rollup context. The rollup is computed from
    those statuses (worst-of), so an all-healthy group is derived as "every member
    status === healthy" from the provider data — never from the (empty) slot
    render. So the cross-plugin coupling lives entirely on the **filler side**
    (healthcheck-frontend → dashboard-frontend, a dependency that **already
    exists**); **no NEW catalog→healthcheck or catalog→dashboard dependency is
    introduced**, and catalog stays standalone (works with healthcheck/dashboard
    absent — the slot is simply unfilled).
  - **Reuse dashboard's provider (recommended), do NOT build a parallel one.**
    A lighter catalog/healthcheck-local provider would duplicate the bulk health/
    incident/maintenance fetch + the `SignalAutoInvalidator` realtime story that
    `SystemBadgeDataProvider` already owns (`SystemBadgeDataProvider.tsx:42-48`).
    Reusing it keeps one bulk-data path and one invalidation story.
  - **`typecheck:references` implication:** catalog-frontend gains no new
    `@checkstack/*` dep (only the new catalog-common slot, an existing intra-plugin
    dep already in the reference graph), so no catalog-side reference change is
    needed. The healthcheck-frontend filler uses deps it already declares
    (`dashboard-frontend`). Run `bun run typecheck:references:generate` only if
    Phase 4's filler happens to pull in a workspace dep healthcheck-frontend does
    not already declare (it should not).
  - **This slot is the one genuinely new platform contract in this plan and MUST
    be documented (§9) and changeset-flagged.**

### 4.3 Readable metadata rendering (shared normaliser)

Replace the `<pre>JSON.stringify</pre>` (`SystemDetailPage.tsx:279-281`) with a
key/value list: a `normalizeMetadata(meta: Record<string, unknown>)` helper that
maps each entry to `{ key, displayValue }` — primitives shown inline, objects/
arrays shown as a compact `JSON.stringify` *value* inside a `<code>` (so structure
survives without a raw blob). Render as a definition list (`<dl>`) styled like the
existing "About/Contacts/Groups" sections (`SystemDetailPage.tsx:142-267`). The
same normaliser feeds the browse tag filter (§3.2). Validate the metadata shape
with a small zod schema (`z.record(z.string(), z.unknown())`, matching the
contract at `rpc-contract.ts:18`).

### 4.4 Locale handling

Drop `"en-US"` from `toLocaleDateString` (`SystemDetailPage.tsx:153,162`). Search
the repo for the prevailing convention first; if none exists, pass `undefined`
locale (uses the browser/runtime default) with the same options object. Wrap in a
tiny `formatDate(date)` helper in `catalog-frontend/src/utils` so both timestamps
go through one place. (If a shared date util already exists in `@checkstack/ui` or
`@checkstack/common`, use that instead — verify during Phase 1.)

---

## 5. State, scale, and read-consistency (`state-and-scale.md`)

Per the project rule, answer the three questions for every stateful piece:

1. **Where does state live?** All browse state is **ephemeral UI state** (filters,
   density, open/closed groups) held in URL params + `localStorage`. The
   *catalog* data is durable in the `systems`/`groups` Postgres tables, read via
   `getEntities` (`rpc-contract.ts:55-64`). *Health* is healthcheck-owned
   (compute-on-read, `reactive-automation-engine.md` §10.3), read via the bulk
   endpoint through the optional provider (§4.2).
2. **Same answer on every pod?** Yes — all reads are oRPC queries against the
   shared DB; no pod-local state. URL/localStorage state is per-browser, not
   server state, so horizontal scale is irrelevant to it.
3. **Duplicated anywhere?** No new materialised copy. The group rollup is computed
   on the client from already-fetched statuses; health is NOT re-stored in
   catalog. **No new backend table, no new current-state store.**

**Scale of client-side filtering:** entity counts are operator-scale (thousands,
matching the explicit scale framing in `reactive-automation-engine.md` §15.1, "not
millions"). `getEntities` already returns the full set and the command palette
already filters client-side over it. So in-page filtering over the loaded set is
correct and adds no backend surface. **If** a deployment exceeds ~5-10k systems,
the follow-up is a paginated/searchable `getSystems` endpoint — out of scope here,
noted as a future hook in §9.

---

## 6. Decision record — LOCKED (maintainer-approved 2026-06-01)

These were the design-led open questions; all are now decided. Rationale and
rejected alternatives retained as the record.

### 6.1 Converge browse + management, or keep split? → **DECIDED: keep split, share components.**

- **Decision (LOCKED):** two routes (`/` read-only browse, `/config`
  manager-gated management), sharing the toolbar + filtering hook + row
  vocabulary.
- **Rationale:** (a) The access postures genuinely differ — `/config` is gated at
  the route level (`index.tsx:47`) and renders AccessDenied for non-managers
  (`PageLayout allowed`, `CatalogConfigPage.tsx:325-327`); a converged view would
  have to conditionally hide half its surface per-user, which is more error-prone
  than two clean routes. (b) The management page's reason to exist is **DnD
  assignment** and CRUD dialogs — affordances that would clutter a read-only
  browse for the majority (non-manager) audience. (c) The issue's "one
  well-thought-out interface" goal is satisfied by *shared components*, not a
  single mega-route. The sibling SLO plugin already models exactly this split
  (`SloOverviewPage` + `SloConfigPage`) and it reads as one product.
- **Rejected:** one converged gated view — higher per-user conditional
  complexity, worse default for the read-only majority, diverges from the
  established overview/config sibling pattern.

### 6.2 Primary navigation model? → **DECIDED: group-first collapsible grouped-list.**

- **Decision (LOCKED):** collapsible group sections + a synthetic Ungrouped
  section.
- **Rejected — sidebar tree:** groups are a flat, many-to-many membership
  (`Group.systemIds`, a system can be in several groups), not a true hierarchy; a
  tree implies single-parent nesting the data model does not have, and a
  persistent sidebar costs horizontal space on mobile.
- **Rejected — board (kanban columns per group):** columns do not degrade on
  mobile, and horizontal scroll is a known navigability anti-pattern at hundreds
  of systems. The grouped-list collapses cleanly to one column on mobile.
- **Rationale:** the grouped-list is the only model that (a) fits the flat
  many-to-many data, (b) collapses to a single mobile column, (c) reuses
  `Accordion`/`Card`/`SectionHeader` we already have, and (d) keeps mounted DOM
  bounded via collapse (§3.4).

### 6.3 Surface health rollups inline? → **DECIDED: yes, via the new `CatalogBrowseHealthSlot`, no hard dep.**

- **Decision (LOCKED):** per-system badges via the existing
  `SystemStateBadgesSlot`; group rollups via a new optional
  `CatalogBrowseHealthSlot` (an approved new platform contract) that healthcheck
  fills with a `SystemBadgeDataProvider`-backed context (§4.2). When healthcheck is
  absent, show counts only.
- **Rationale:** health at a glance is the single biggest legibility win for
  operators (the issue calls it out), and the slot mechanism already exists and is
  already used on detail. Adding `healthcheck-common`/`dashboard-frontend` as a
  hard catalog dependency would (a) violate the plugin-decoupling the slot
  architecture exists to provide, (b) break catalog in deployments without
  healthcheck, and (c) require `typecheck:references:generate` churn. The slot
  keeps catalog standalone.
- **Rejected — direct `getBulkSystemHealthStatus` call from catalog-frontend:**
  introduces the coupling above for no benefit the slot does not already give.

### 6.4 Detail-page cleanups here or split? → **DECIDED: ship in Phase 1 as a standalone PR.**

- **Decision (LOCKED):** the three cleanups (NotFound, metadata, locale) ship
  first, as one small low-risk PR, before/independent of the IA build.
- **Rationale:** they are independent, low-risk, and high-value-per-line; the
  root-cause note in the issue confirms they are decoupled from the home-page
  direction. Shipping them first de-risks the PR series and gives an immediate
  user-visible fix while the IA is being signed off.

---

## 7. Accessibility pass (applies to every phase)

- **Search/filter:** label every control (`aria-label` on the search `Input`, on
  each `Select`). The density control as `Tabs` already ships arrow-key nav
  (`Tabs.tsx:24-43`); if a `Toggle` is used instead, give it `role="switch"` +
  `aria-checked`.
- **Collapsible groups:** the group header is a real `<button>` with
  `aria-expanded` and `aria-controls` pointing at the section body
  (`Accordion` provides this; verify). Focus order: toolbar → group headers →
  rows within an expanded group.
- **Icon-only buttons** (the management page's edit/delete/assign on
  `DraggableSystem`/`DroppableGroup`, and any new row affordance) need
  `aria-label` — the issue flags these as currently missing. Audit
  `DraggableSystem`/`DroppableGroup` and add labels in the Phase 3 management
  pass.
- **Drag-and-drop keyboard affordance:** `@dnd-kit` supports a
  `KeyboardSensor`; the page currently registers only `PointerSensor` +
  `TouchSensor` (`CatalogConfigPage.tsx:106-115`). Add `KeyboardSensor` with the
  sortable coordinate getter so assignment is keyboard-operable, and ensure the
  existing "use the assign button" alternative (`CatalogConfigPage.tsx:360-362`)
  stays as the non-DnD path.
- **Health colour:** never rely on colour alone — `HealthBadge` already pairs
  colour with an icon + label (`HealthBadge.tsx:35-56`); group rollup `Badge`s
  must include a text count ("1 degraded"), not just a colour.
- **`isLowPower` (`performance.md`):** any expand/collapse or
  search-highlight transition must be guarded by `usePerformance().isLowPower`
  (jump to end-state when low-power), matching `NotFound`'s pattern
  (`NotFound.tsx:48,61,73,146`). No `animate-*` infinite loops, no `backdrop-blur`
  without a solid fallback. The "recently added" glow on the management page is
  **already `isLowPower`-guarded** in `DroppableGroup.tsx` (`usePerformance` at
  `:41`, guards at `:62,:127`) and the drag transition path; while in Phase 3,
  **verify** the existing guard covers the recently-added glow (and confirm
  `DraggableSystem.tsx` needs none — it imports no animation that requires one).
  Do not re-add a guard that already exists.
- **Mobile:** verify the grouped-list at the smallest viewport (single column,
  collapsed-by-default, toolbar wraps to stacked controls). The management page's
  two-column `grid lg:grid-cols-2` (`CatalogConfigPage.tsx:335`) and DnD already
  collapse to one column at `<lg`; verify DnD/touch still works (the `TouchSensor`
  at `:111-114` handles this — re-test).

---

## 8. Phased breakdown (each phase = one shippable PR, own changeset + tests)

### Phase 1 — Detail-page cleanups (independent, low-risk, ships first)

- **Scope:** `SystemDetailPage.tsx` — swap `<AccessDenied/>` for `<NotFound/>` on
  the not-found branch (`:91-101`); replace the JSON `<pre>` with the
  `normalizeMetadata` key/value list (`:279-281`, §4.3); drop hardcoded `"en-US"`
  via a `formatDate` helper (`:153,162`, §4.4).
- **Touches:** `core/catalog-frontend/src/components/SystemDetailPage.tsx`, new
  `core/catalog-frontend/src/utils/{formatDate,normalizeMetadata}.ts`.
- **Test matrix:**

  | Test | Asserts |
  |---|---|
  | `normalizeMetadata.test.ts` | primitives inline; objects/arrays stringified; empty → `[]`; non-string keys skipped |
  | `formatDate.test.ts` | no `en-US`; stable output for a fixed `Date` under a pinned locale; invalid date guarded |
  | render: not-found | renders `NotFound`, not `AccessDenied`, when `systemId` resolves to no system |
  | render: metadata | renders a `<dl>`, no `<pre>` raw blob |

- **Changeset:** `@checkstack/catalog-frontend` minor (beta), "fix: …".

### Phase 2 — Browse view foundation (the IA build)

- **Scope:** rewrite `CatalogPage` (§2.1, §4) — toolbar, group sections,
  ungrouped section, URL state hook, search + filters + density, manager
  "Manage catalog →" affordance, first-run + filtered-empty empty states. **No
  inline health rollup yet** (counts only) — keeps this PR free of the slot
  contract.
- **Touches:** `core/catalog-frontend/src/components/CatalogPage.tsx` (rewrite),
  new `components/browse/*`, `hooks/useCatalogBrowseState.ts`,
  `hooks/useDebouncedValue.ts`.
- **Test matrix:**

  | Test | Asserts |
  |---|---|
  | `useCatalogBrowseState.test.ts` | URL round-trip for `q/group/health/tag/density/open`; debounce; ungrouped derivation; multi-group membership |
  | filter logic | search matches name+description case-insensitively; filters compose (AND); empty-result path |
  | render: empty catalog | first-run `EmptyState` (manager sees create CTA, read-only does not) |
  | render: populated | groups render with counts; collapsed all-healthy vs expanded; ungrouped section present |
  | render: filtered-empty | `ListEmptyState` with clear-filters action |
  | a11y | search/filters labelled; group header is a button with `aria-expanded` |

- **Changeset:** `@checkstack/catalog-frontend` minor (beta), "feat: …".

### Phase 3 — Management parity + a11y + mobile

- **Scope:** import `CatalogBrowseToolbar` + filter hook into `CatalogConfigPage`;
  apply filtering to both lists (`:385`, `:452`); add `KeyboardSensor` (§7);
  `aria-label` audit on icon-only buttons in `DraggableSystem`/`DroppableGroup`;
  **verify** the existing `isLowPower` guard in `DroppableGroup.tsx`
  (`:41,:62,:127`) covers the recently-added glow (no new guard to add); mobile
  re-test of the two-column grid + DnD.
- **Touches:** `CatalogConfigPage.tsx`, `DraggableSystem.tsx`,
  `DroppableGroup.tsx`.
- **Test matrix:**

  | Test | Asserts |
  |---|---|
  | filter applied to systems list | filtered `systems` rendered; clear restores all |
  | filter applied to groups list | same for groups |
  | a11y | every icon-only button has an `aria-label`; `KeyboardSensor` registered |
  | low-power | confirm the existing `DroppableGroup` `isLowPower` guard suppresses the recently-added glow (regression guard, not a new guard) |

- **Changeset:** `@checkstack/catalog-frontend` minor (beta).

### Phase 4 — Inline health rollups (the slot contract)

- **Scope:** add `CatalogBrowseHealthSlot` to `catalog-common/src/slots.ts`;
  catalog browse renders the slot wrapper + a context the group headers read for
  rollups (§4.2); healthcheck-frontend fills the slot, wrapping
  `dashboard-frontend`'s existing `SystemBadgeDataProvider` (an already-declared
  healthcheck-frontend → dashboard-frontend dep, §4.2) to supply bulk statuses.
  Per-system badges already work via `SystemStateBadgesSlot` from Phase 2's rows;
  this phase adds the *group rollup* (derived from the provider's status data,
  since healthy systems emit no badge — §4.2) + health filter wiring.
- **Touches:** `core/catalog-common/src/slots.ts` (new slot — **platform
  contract**), `catalog-frontend/src/components/browse/*`,
  `core/healthcheck-frontend/src/index.tsx` (+ a small slot-filler component that
  wraps `dashboard-frontend`'s `SystemBadgeDataProvider`). No new catalog-side
  workspace dep; run `bun run typecheck:references:generate` only if the filler
  pulls in a dep healthcheck-frontend does not already declare (it should not).
- **Test matrix:**

  | Test | Asserts |
  |---|---|
  | rollup logic | group rollup = worst member status derived from `SystemBadgeDataProvider` status data (NOT slot render output); all-healthy → success; mixed → warning/destructive with counts |
  | no-healthcheck path | slot unfilled → headers show counts only, no crash; absent provider data treated as "unknown", not "healthy" |
  | health filter | filtering by `degraded` hides healthy rows; "unknown" matches no-data systems |
  | a11y | rollup `Badge` carries text count, not colour alone |

- **Changeset:** `@checkstack/catalog-common` + `@checkstack/catalog-frontend` +
  `@checkstack/healthcheck-frontend` minor (beta). Because the new slot is a
  **platform contract**, the changeset notes it under the docs rule.

### Phasing notes

- Phases 1-3 are strictly additive to catalog and require **no** new cross-plugin
  dependency. Phase 4 introduces the one new contract (the slot) and the only
  cross-plugin wiring; it is last so the browse view ships useful (counts +
  per-system badges) even if Phase 4 slips.

---

## 9. Docs deliverables (same-PR, `docs/src/content/docs/`, `docs-style.md`)

- **Phase 2:** update / add the catalog user-guide page describing the browse view
  (search, filters, groups, density) under
  `docs/src/content/docs/user-guide/...catalog...`. Sentence-case headings,
  frontmatter `title`+`description`, no em-dashes, a runnable/illustrative example
  of the URL-state deep-link (`/?q=checkout&group=payments`).
- **Phase 4:** document the **`CatalogBrowseHealthSlot` platform contract**
  (reference page: the slot's context shape + how a plugin fills it), since it is
  a new slot contract (the architecture rule requires same-PR docs for new
  slots/contracts). Cross-link from the catalog architecture page.
- If a phase is intentionally undocumented (e.g. Phase 1 is an internal
  bugfix with no contract change), say so in the PR description per the
  architecture rule. Phase 1 likely qualifies as docs-exempt.

---

## 10. Cross-cutting & decision status

- **Repo rules:** no `any`, no `eslint-disable`; zod for the metadata schema; typed
  object args + destructuring; copy (don't unilaterally add) the debounce hook;
  match existing look-and-feel (mirror `SloOverviewPage`); `isLowPower` guards on
  all animation; mobile checked at the smallest viewport. Run `bun run typecheck`
  + `bun run lint` + `bun test` before declaring any phase done;
  `bun run typecheck:references:generate` only if a workspace dep changes (likely
  only Phase 4). Conventional commits; per-package **beta-minor** changesets with
  `BREAKING CHANGES:` notes only if a contract is removed (none here — the new
  slot is additive). Same-PR docs per §9.
- **All design decisions LOCKED (maintainer-approved 2026-06-01)** — no further
  sign-off needed to build:
  1. The **IA in §2-§5** (group-first collapsible grouped-list, the browse/manage
     split, inline health via the slot, density + URL-state model). — APPROVED
  2. **§6.1** keep split + share components (vs. converge). — APPROVED
  3. **§6.2** group-first grouped-list (vs. tree / board). — APPROVED
  4. **§6.3** health via the new slot, no hard dependency. — APPROVED
  5. **§6.4** detail cleanups ship first as Phase 1. — APPROVED
  6. The one **new platform contract**, `CatalogBrowseHealthSlot` (Phase 4). —
     APPROVED (ships with same-PR docs + changeset per §9).
- Everything else (component names, file layout, test names) is reversible
  implementation detail decided at build time.
