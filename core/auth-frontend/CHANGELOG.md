# @checkstack/auth-frontend

## 0.16.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/catalog-common@2.8.3
  - @checkstack/healthcheck-common@1.19.2
  - @checkstack/incident-common@1.11.1
  - @checkstack/maintenance-common@1.11.1

## 0.16.0

### Minor Changes

- 88f4333: Role editor: alphabetised categories, bulk select, and role cloning

  Access-rule categories in the role dialog are now sorted alphabetically (by their
  rendered label, at both the category and the rule level) instead of following
  plugin registration order, so a category can be found by scanning rather than by
  reading the whole list.

  Each category gained **Select all** / **Clear** actions. They respect the same
  guards the individual checkboxes do - the anonymous role still cannot be granted
  rules no public endpoint uses, and a locked role stays read-only.

  Roles can be **cloned**: a new role seeded from an existing one's access rules,
  saved as a create. The dialog now takes an explicit `mode` rather than inferring
  "editing" from the presence of a role, which is what made the third state
  expressible at all.

  Adds a shared `buildClonedName` helper to `@checkstack/common` so every clone
  affordance in the product produces the same name shape.

- 56e5375: Migrate the frontend from react-router-dom v7 to react-router v8

  Resolves GHSA-qwww-vcr4-c8h2 (HIGH): React Router before 8.3.0 has an RSC-mode
  CSRF bypass that lets an action execute before the 400 response. Checkstack runs
  a client-side SPA (`<BrowserRouter>`) and does not use RSC mode, so the platform
  was not exploitable through it - but the advisory kept the dependency-graph
  security gate red on every pull request, and the fix is only available in the 8.x
  line, which the auto-remediation deliberately will not reach (it refuses major
  bumps).

  `react-router-dom` has no v8: it was folded into `react-router` in v7 and v8
  ships as `react-router` only. So this is a package swap rather than a range bump:

  - 31 packages now depend on `react-router@^8.3.0` instead of
    `react-router-dom@^7.16.0`, and 97 source files import from `react-router`.
  - The Module Federation host share, `optimizeDeps` and `dedupe` entries move to
    `react-router` (shared singleton `requiredVersion` `^8.0.0`). Remotes never
    shared the router, so the remote contract is unchanged.
  - The syncpack unified-range group tracks `react-router`, keeping the enforced
    single-range guarantee that a past four-range regression motivated.

  The API surface Checkstack uses is unchanged between v7 and v8 - `BrowserRouter`,
  `MemoryRouter`, `Routes`, `Route`, `Link`, `NavLink`, `useLocation`,
  `useNavigate`, `useParams` and `useSearchParams` are all exported by v8 with the
  same signatures - so no routing code changed beyond the import specifier. v8
  requires React >= 19.2.7, which the workspace already pins.

- 88f4333: Clarify the team-access editor and guard against locking yourself out

  Four fixes to the "Who can change this" editor and the team member picker, from
  user feedback:

  - **The "Manage" checkbox read as "manage the team".** It sets the selected
    team's grant on THIS resource, but the label plus a gear icon suggested it
    would open the team itself. It is now labelled **"Can edit"** (with no gear),
    naming its effect on the resource.
  - **The team name is now a link** to that team (`/teams?team=<id>`), which opens
    its members dialog directly. That gives "take me to the team" its own
    affordance instead of overloading the checkbox. The Teams page consumes the
    `team` query param once and then clears it.
  - **Revoking your own team's access now asks first.** A team-scoped user could
    remove (or downgrade) their own team's only edit grant and afterwards be unable
    to change the resource _or_ restore the permission. That case now shows a
    confirmation explaining the consequence. Global `auth.teams.manage` admins are
    not warned - they can always restore it. The decision is a pure, unit-tested
    `isSelfRevokingChange`.
  - **The add-member field explained.** Its placeholder ("Add a user by name or
    email") and new helper text state that it adds a NEW member from the whole
    directory rather than filtering current members, and that a user is only
    findable after their first sign-in (SSO/LDAP accounts materialise on login).

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/auth-common@0.17.0
  - @checkstack/incident-common@1.11.0
  - @checkstack/maintenance-common@1.11.0
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/catalog-common@2.8.2

## 0.15.0

### Minor Changes

- be74b01: Let teams that manage a resource administer its team access (delegation)

  Editing a resource's team access on the "Who can change this" editor (add/remove
  teams, toggle Manage, toggle Private) was gated on the GLOBAL `auth.teams.manage`
  rule on both the frontend and backend, so only a platform admin could do it -
  even a member of a team that already manages the resource saw the editor
  read-only.

  `writeRelation`, `removeRelation` and `setObjectPublic` now authorize per-object:
  the caller may edit a resource's team access when they can MANAGE that specific
  resource - a global `auth.teams.manage` admin, a holder of the resource's own
  `<type>.manage` rule (e.g. `catalog.system.manage`), or a member of a team that
  holds an editor/owner grant on it. A team that only reads the resource (viewer
  grant), or has no grant and no global rule, is read-only and CANNOT elevate its
  own or another team's access. The check reuses the existing ReBAC engine
  (`tupleStore.check({ action: "manage" })`), so team-only (private) resources are
  respected: a global resource-manager who is not on a granted team cannot reach a
  private resource - only a `teams.manage` admin or a granted team can. The first
  grant on an otherwise-unscoped resource still requires one of the global rules.

  A new `canManageObjectAccess` query runs the SAME authorization, and the
  `TeamAccessEditor` gates its write controls on it instead of the global rule, so
  the UI shows exactly the controls a write would accept (no frontend/backend
  drift). The backend re-checks on every write, so it remains the security
  boundary.

  BREAKING CHANGE: granting/revoking a team's access to a resource is no longer
  admin-only - it is delegated to whoever can manage that resource. If you relied
  on only `auth.teams.manage` holders being able to change resource team-access,
  note that members of a team that manages the resource can now do so too (a
  read-only team still cannot).

- be74b01: Let team members and managers see and manage their own team without a global rule

  Opening the "Who can change this" team-access modal (e.g. on a system) as a
  team manager failed with "Couldn't load team access. Retry or reopen the
  editor.", because the backend 403'd `getTeams` and denied `listObjectRelations`.
  The team-read procedures were gated on the GLOBAL `auth.teams.read` rule, which
  a team-scoped user (a per-team ReBAC grant, no global rule) does not hold - so
  managers and members were locked out of their own team, and managers who tried
  to add / remove / promote members would have been 403'd too.

  The read/metadata procedures (`getTeams`, `getTeam`, `listObjectRelations`,
  `listObjectRelationsBulk`, `listSubjectRelations`, `listTeamCreateGrants`,
  `searchUsers`, `resolveResourceNames`, `getResourceKinds`) are no longer gated
  on the global rule. Each now scopes in the handler:

  - A caller holding global `auth.teams.read` (or a trusted service) still sees
    every team.
  - Everyone else sees ONLY the team(s) they are a member or manager of.
    `getTeams` returns just those teams, `getTeam` returns `undefined` for a team
    the caller has no stake in (no existence leak), and `listObjectRelations` /
    `listObjectRelationsBulk` hide an object's team grants from a caller with no
    stake while still returning the public flag - a successful, empty response,
    never a 403.
  - `searchUsers` keeps its own guard: the directory is still searchable only by a
    global team-manager or a manager of at least one team.

  Team WRITE procedures (`updateTeam`, `addUserToTeam`, `removeUserFromTeam`,
  `addTeamManager`, `removeTeamManager`) already enforced
  `assertTeamManagementAccess` (service, global `teams.manage`, or manager of the
  specific team) and now pass the middleware so a team manager can actually manage
  their own team. Creating and deleting whole teams stays admin-only
  (`auth.teams.manage`).

  Frontend: the standalone Teams page and its nav entry are now shown to a global
  `auth.teams.read` holder OR any user who is a member/manager of at least one
  team - not unconditionally to every authenticated user, and no longer requiring
  the global rule. A user in no team (and holding no global rule) does not see it.
  This is driven by a new `isInAnyTeam` flag on the app-wide `accessRules` query
  (member OR manager, so manager-only teams count), threaded into the sidebar's
  nav-visibility model and exposed to every route's `isVisible` predicate via a
  new `isInAnyTeam` context field (`@checkstack/frontend-api`). The page
  self-scopes via the now-scoped `getTeams`, and per-team management affordances
  stay gated on managing that team.

  BREAKING CHANGE: `auth.teams.read` no longer gates the team read procedures at
  the middleware. If you relied on that rule to hide team existence from
  authenticated users, note that a user now sees the teams they belong to
  regardless; access to a specific team's data is still limited to its
  members/managers or a global-rule holder.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- be74b01: Migrate the automation surfaces onto the shared filter bar, and dedupe useDebouncedValue

  Follows the native `DataTable` facet API with the first wave of migrations.

  - `DataTableFacet` gains `kind: "select" | "pills"`. A segmented pill row is the
    right control for two or three short options a reader benefits from seeing at
    a glance, and several surfaces had independently built one - so the shared bar
    renders that variant rather than forcing every list into a dropdown. Both
    variants share one state, sentinel and URL round-trip, and the pills set
    `aria-pressed`, which two of the hand-rolled groups they replace had omitted.
  - `parsedFacetValue` reads a facet's selection back as a domain value by parsing
    it against the schema that defines it. Facet state is stringly-typed because
    it round-trips through the URL, but a server-side filter needs the narrow union
    its query input declares; parsing rather than casting means a stale link
    degrades to unconstrained instead of smuggling an unknown value into a request.
  - The automation list and run-history pages drop their hand-rolled status pill
    rows for the shared bar. Their filters now persist to the URL, so a link to
    "the failed runs of this automation" reopens filtered. The run-history table
    also gains the `surface={false}` it was missing, fixing a panel-in-panel.
  - `useDebouncedValue` had been copied verbatim into six plugin packages, each
    with a comment noting no shared version existed. All six now import the one in
    `@checkstack/ui` and the copies are deleted.

- Updated dependencies [be74b01]
- Updated dependencies [be5c907]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/ui@1.30.0
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/auth-common@0.16.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/catalog-common@2.8.1
  - @checkstack/incident-common@1.10.5
  - @checkstack/maintenance-common@1.10.5

## 0.14.0

### Minor Changes

- 6c8b36b: Catalog manage tabs: per-row owner badge, de-bloated membership chips, and a
  reusable batched ownership lookup.

  - New batched auth primitive `listObjectRelationsBulk({ objectType, objectIds })`
    resolves the owning team(s) and privacy for MANY resources of one type in a
    single query (mirrors the per-object `listObjectRelations`). Backed by a new
    `RelationTupleStore.listObjectRelationsBulk`. This is the table-friendly
    counterpart any plugin can use to render an owner indicator per row without an
    N+1.
  - New `@checkstack/auth-frontend` helpers built on it: `useResourcesManagedBy`
    (batched hook, gated on `auth.teams.read`) and the compact `ResourceOwnerBadge`
    presentational pill. The catalog Groups and Environments manage tabs now show a
    per-row "owned by <team>" badge and a one-line note that these are shared,
    globally-visible objects only the owning team can rename/delete.
  - Membership chips on the Systems / Groups / Environments manage tabs collapse to
    a single count pill ("N systems") whose popover holds the members plus a
    name-sorted, searchable add list, instead of wrapping a full chip wall that
    made rows tall. Attaching/detaching a system to a group/environment is offered
    and enabled only for systems the caller can manage (matching the backend, which
    authorizes membership per `catalog.system` manage).
  - Groups and Environments manage rows gain the same per-row "Scope to team"
    quick action Systems already had, so an owner can grant a team Manage/Read on a
    group or environment straight from the table. The action is a reusable
    `ScopeToTeamAction` (any team-scoped resource type) exported from
    `@checkstack/auth-frontend`; `ScopeSystemToTeamAction` is now a thin adapter
    over it. It self-gates on `auth.teams.manage` and defers mounting its dialog
    until first use.
  - The Groups and Environments manage tabs gain row selection and a bulk-action
    bar, matching Systems: select the rows you manage, then bulk **Scope to team**
    (grant a team on many at once), bulk **Add system** (attach one system to every
    selected group/environment), or bulk **Delete**. Rows you cannot manage render
    a disabled checkbox and are excluded from "select all". The bulk scope button
    is a reusable `BulkScopeToTeamAction` exported from `@checkstack/auth-frontend`
    (the multi-select counterpart of `ScopeToTeamAction`); the systems bulk filler
    is now a thin adapter over it. Attaching a system to many environments is a
    single desired-set write, so the writes cannot race.
  - Consistency polish across the three manage tabs: all row **Edit** actions now
    use the same pencil icon (Systems previously used a different one); **Groups**
    now edit through the same dialog editor as Systems and Environments (with a
    per-row Edit action) instead of an inline name field that had no matching Edit
    button; and the Systems **Health** column keeps its state badges on one row
    (side by side) instead of wrapping a second badge onto its own line.
  - `@checkstack/ui` `DataTable` gains a per-column `truncate` option: the column
    absorbs the table's spare width and ellipsizes overflowing free-text (a long
    name/description) instead of letting one long value force the whole table to
    scroll horizontally. Cell content is vertically centered by default.

- 6c8b36b: Catalog **Groups** and **Environments** are now team-manageable. Their reads
  stay public (they are shared browse facets everyone can see), but creating,
  renaming, and deleting them is team-scoped exactly like Systems: a create
  writes an owning-team grant, and edit/delete require a per-instance manage
  grant. A team that can create Systems can also create Groups and Environments
  (and attach them to systems it manages) with no extra grant.

  New reusable platform seam `instanceAccess.create.alsoAcceptCreatorOf: string[]`:
  a create procedure can declare sibling types whose `creator` (create-capability)
  grant also authorizes the create - strictly the type-level creator grant, so it
  stays orthogonal to `create.parent` (which is instance-manage). It is backed by a
  new strict-creator auth primitive `hasCreateCapability({ objectType })` consumed
  by BOTH the create middleware and the frontend `canCreate` verdict (extended with
  an optional `alsoAcceptCreatorOf`), so the button gate and the backend can never
  drift. The boot conformance check now also verifies every `alsoAcceptCreatorOf`
  type is a real team-scoped type, and `catalog.group` / `catalog.environment` gain
  resource-name resolvers so their team grants render by name.

  BREAKING: `catalog.deleteGroup` input reshaped from a bare `string` to
  `{ id: string }` (mirrors the earlier `deleteSystem` reshape) so the per-group
  manage check can resolve the target id. `catalog.reorderGroups` stays a
  global-admin operation (it rewrites the single global sort order for all groups).
  Existing ownerless (global) groups and environments remain editable only by
  global catalog admins until re-owned; no data migration is required (team grants
  live in the auth relation store).

### Patch Changes

- 6c8b36b: Edit forms stay stable while you are typing. Previously, editing a system's
  description (and many other edit dialogs/settings pages) would reset the field
  mid-edit whenever a webhook update or realtime signal refetched the underlying
  query: the form re-seeded its local state from the fresh query result on every
  refetch. Forms now seed their local state ONCE - on the dialog's open
  transition, or once per record via a stable key - and ignore background
  refetches while you are editing.

  New shared primitive `useSeedFormOnOpen(open, onInit)` in `@checkstack/ui`
  (alongside the existing `useInitOnceForKey`) seeds a dialog form once per
  open transition, StrictMode-safe. Fixed surfaces include the catalog
  system/environment/group editors, the healthcheck platform-defaults dialog,
  the SLO / gitops-provider / telemetry-source / satellite / announcement /
  role edit dialogs, and the cache / queue / notification / secrets / anomaly /
  profile / strategies settings pages (query-seeded pages also drop their loader
  cache via `gcTime: 0` so a warm cache cannot race the one-shot seed).

- 6c8b36b: Speed up the catalog manage Systems tab and unify its per-row actions.

  - The per-row `SystemHealthCheckAssignment` no longer runs two allocation-heavy
    access hooks (`useCanAccessType` + `useResourceAccess`) plus a counts query
    PER ROW - profiling showed this as the dominant, GC-bound cost of opening the
    Systems tab. A new `CatalogSystemHealthCheckDataProvider`, folded around the
    catalog tree via `CatalogBrowseDataBoundarySlot`, resolves the gate + counts
    once for the whole visible list; the row action reads them from context (the
    heavy standalone path is only rendered on surfaces without the provider, e.g.
    the system detail page).
  - The per-row `SystemAnomalyBadge` no longer instantiates two live query
    observers (and scans up to 500-element arrays) per row. A new
    `AnomalyBadgeDataProvider`, folded around the catalog browse/manage tree via
    `CatalogBrowseDataBoundarySlot`, fetches the active + suspicious anomaly sets
    once and exposes an O(1) per-system lookup - matching the SLO / incident /
    health / dependency badges. Without the provider the badge falls back to its
    own (deduped) queries, so the system detail page is unchanged.
  - `ScopeSystemToTeamAction` and `SystemHealthCheckAssignment` now render through
    the shared `RowAction`, so a system row's action cluster looks uniform.
    `ScopeSystemToTeamAction` additionally defers mounting its Radix dialog until
    first use, so a table of rows no longer mounts an idle dialog per row.
  - `@checkstack/ui` `RowAction` gains an optional `badge` (e.g. an assigned-count
    indicator) rendered next to the icon, so a count action stays a normal
    `RowAction` instead of a bespoke button.

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/ui@1.29.0
  - @checkstack/auth-common@0.15.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/incident-common@1.10.4
  - @checkstack/maintenance-common@1.10.4

## 0.13.6

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/auth-common@0.14.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/incident-common@1.10.3
  - @checkstack/maintenance-common@1.10.3

## 0.13.5

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1

## 0.13.4

### Patch Changes

- a74fa01: Opaque card surfaces and a heading opt-out for dialog-hosted editors:

  - `TeamAccessEditor`'s compact container now carries its own `bg-card`
    background. It was a bordered box with no background - fine inside the old
    opaque dialog, but transparent when mounted on a page with a decorative
    backdrop (the detail pages' grid bled through the content). Card-like
    containers must always declare their own opaque background.
  - `LinksEditor` gains an optional `hideTitle` prop so hosts whose own title
    already names the surface (e.g. a "Manage links" dialog) can suppress the
    built-in heading; the description still renders. Default behavior is
    unchanged.

- a74fa01: Fix the catalog manage page render storm: with many visible systems, every
  parent render (typing in the filter, any query refresh, opening a dialog)
  re-rendered every row's slot fillers - rows x fillers x auth/query hook trees

  - profiling as a GC-dominated main thread.

  - `ExtensionSlot` now renders each extension through a memoized component
    that bails out on SHALLOW slot-context equality (`slotContextEquals`,
    regression-tested): inline context objects keep working, but an unchanged
    row no longer re-runs its fillers. Call sites must keep context VALUES
    referentially stable - primitives are free, memoize arrays/objects (the
    catalog already memoizes `visibleSystemIds`).
  - `useCanAccessType`/`useSurfaceAccess` (`useTypeSurface`) now resolve the
    global rule and the authenticated gate from ONE `useAccessRules` call
    instead of two, halving the session/rules query observers each gated
    control allocates - noticeable when the gate is mounted once per row.

- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/auth-common@0.14.0
  - @checkstack/common@0.22.0
  - @checkstack/incident-common@1.10.3
  - @checkstack/maintenance-common@1.10.3

## 0.13.3

### Patch Changes

- 5e704cd: fix(frontend): de-clutter the navbar and move Help into the user menu

  The navbar carried six tap targets (hamburger, logo, search, help, avatar +
  chevron, bell) in a bar barely wide enough for four on mobile, and the `?` icon
  sat in the right-hand rail as a peer of the notification bell and the avatar
  despite being neither a stateful indicator nor an identity control.

  - **Help moves into the user menu**, at both breakpoints, contributed by
    `tips-frontend` to `UserMenuItemsBottomSlot`. Its Documentation link is
    dropped rather than reproduced: the sidebar's Documentation group already
    renders a `Docs` external link on both the desktop rail and the mobile drawer.
    What remains ("Show tips again" plus the lightbulb/tooltip legend) are tips
    concepts that `tips-frontend` already owns, so the shell no longer needs a
    `HelpMenu` component at all - it is deleted, along with `core/frontend`'s now
    unused dependency on `@checkstack/tips-frontend`.
  - **The search trigger** is hidden below `md`; the mobile drawer already has a
    "Search..." entry that opens the same palette. It is hidden with CSS rather
    than unmounted, because `NavbarSearch` owns the palette's open state and the
    ⌘K listener that `openSearchPalette()` re-dispatches into.
  - **The user-menu chevron** and name label are dropped below `md`, and the
    trigger's horizontal padding tightens so the tap target is centred on the bare
    avatar rather than an off-centre pill.

  The mobile navbar is now hamburger, logo, avatar, bell.

  Two defects found on the way:

  - `UserMenu`'s trigger had **no accessible name**. The avatar is decorative and
    the name label is hidden on small screens, so the button was announced as just
    "button". It now carries an `aria-label`.
  - User-menu contributions were ordered by plugin load order, because the slot
    declared no metadata type and `ExtensionSlot` sorts on an optional `priority`.
    Every contributor now declares one, so the menu renders Help, appearance
    toggles, About, Logout deterministically, with Logout pinned last.

  The two user-menu slots are also collapsed into one. `UserMenuItemsSlot` had not
  been rendered by anything since navigation moved to the sidebar - its render site
  was removed and the definition left behind - so every real contribution went to
  `UserMenuItemsBottomSlot`, and a "bottom" section existed with no top section
  above it. The docs additionally described a `group`-based system for the top slot
  (canonical `Workspace` / `Reliability` / `Configuration` headers, alphabetized
  custom groups) that was never implemented: nothing read `metadata.group`. The
  surviving slot is `UserMenuItemsSlot`, ordering is expressed with `priority`, and
  the fictional grouping is gone from the docs.

  BREAKING CHANGE: `useIsMobile()` now matches `(max-width: 767px)` instead of
  `(max-width: 640px)`. It must agree with the app shell's layout breakpoint - the
  hamburger is `md:hidden` and the sidebar rail is `hidden md:flex`, so "the shell
  is in its mobile layout" means below `md`. Previously the 641-767px range
  rendered the mobile hamburger while `useIsMobile()` still reported `false`, so
  the user and notification menus opened as desktop popovers inside a mobile
  layout. Consumers outside the shell (`HealthCheckHistoryDetailPage`,
  `SloTrendChart`) now switch to their mobile presentation 128px earlier.

  BREAKING CHANGE: `UserMenuItemsBottomSlot` is removed. Contribute to
  `UserMenuItemsSlot` instead - it is now the menu's only item slot and is actually
  rendered. `UserMenuItemsMetadata` loses its never-implemented `group` key and
  gains `priority?: number`, which orders items ascending (lower first). A
  contribution registered through the type-strict `createSlotExtension` helper must
  now pass a `metadata` object; plain-object `extensions` entries may omit it and
  default to priority 0.

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/catalog-common@2.7.2
  - @checkstack/healthcheck-common@1.16.2
  - @checkstack/incident-common@1.10.2
  - @checkstack/maintenance-common@1.10.2

## 0.13.2

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/auth-common@0.14.0
  - @checkstack/frontend-api@0.14.2
  - @checkstack/catalog-common@2.7.1
  - @checkstack/healthcheck-common@1.16.1
  - @checkstack/incident-common@1.10.1
  - @checkstack/maintenance-common@1.10.1

## 0.13.1

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/catalog-common@2.7.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/ui@1.26.0
  - @checkstack/incident-common@1.10.0
  - @checkstack/maintenance-common@1.10.0
  - @checkstack/frontend-api@0.14.1

## 0.13.0

### Minor Changes

- f93ee7a: Derive frontend authorization gates from the RPC contract instead of hand-picking
  a hook per call site. The backend contract already declares, per procedure, both
  the access rule (`access`) and how it is instance-scoped (`instanceAccess`); the
  frontend gate was a hand re-encoding of that, which is how the "global-only
  team-grant" drift shipped (nothing enforced that the hook a page chose matched
  the mode the contract declared).

  New `resolveProcedureGate` (`@checkstack/common`) reads a contract procedure's
  metadata and returns the single gate the backend will enforce - classifying
  `global` / `idParam` / `create` / `typeScoped` / post-filtered `open`, deriving
  the object type from the rule and resolving the resource id from the input via
  the contract's declared path. `parentScope` is normalized into an `idParam`/`open`
  gate on a reconstructed parent rule + the parent type (the parent grant string the
  backend checks is exactly `${resourceType}.${action}`, so no contract change was
  needed). New `accessApi.useProcedureAccess(procedure, input)`
  (`@checkstack/frontend-api` / `@checkstack/auth-frontend`) dispatches on the
  derived gate; a call site can no longer gate on the wrong thing.

  Fix a latent `create.parent` gap: the create gate's global-RBAC path only checked
  the procedure's own manage rule, so a user with GLOBAL manage on the PARENT type
  (e.g. a global system manager creating an incident/maintenance/SLO "for" a system,
  which the backend authorizes via the parent gate) was not offered the create
  affordance. The derived create gate now also ORs global manage on the parent type.

  Migrate every `useCanCreate` create-button gate (catalog systems, health checks,
  incidents, maintenance, SLOs, automations, status pages) to `useProcedureAccess`
  on the owning create procedure, which also delivers the `create.parent` fix to
  each, then remove `useCanCreate` from the `AccessApi`.

  BREAKING CHANGES: `accessApi.useCanCreate(...)` is removed from
  `@checkstack/frontend-api`. Replace it with
  `accessApi.useProcedureAccess(SomeApi.contract.createX)` - the create procedure's
  `instanceAccess.create` supplies the object type and parent gate, so no more
  hand-passed `objectType` / `parentType`. The remaining hooks (`useAccess`,
  `useCanAccessType`, `useResourceAccess`, `useRouteAccess`, `useIsAuthenticated`)
  are unchanged: they gate surfaces/rows/routes that are not tied to a single
  procedure. No gate became more restrictive; the create fix makes global
  parent-managers correctly see create controls they were wrongly denied.

  Patch-level adaptations to the `AccessApi` interface change (no behavior change of
  their own): the host app's fallback `AccessApi` stubs (`@checkstack/frontend`) and
  Storybook's mock (`@checkstack/ui`) drop `useCanCreate` and add the new
  `useProcedureAccess` / `useSurfaceAccess` members so they match the interface, and
  a `@checkstack/catalog-common` doc comment now names `useProcedureAccess` instead
  of the removed hook.

- f93ee7a: Fuse authorization into the RPC call so a frontend gate can't drift from - or be
  forgotten alongside - the procedure it guards. This is the structural endpoint of
  the contract-derived gating work: instead of pairing `client.X.useMutation()` with
  a separate `useProcedureAccess(X)`, the gate is welded to the call.

  - `useGatedMutation` / `useGatedQuery` (`@checkstack/frontend-api`): the plugin
    client's mutation/query hooks now have gate-fused variants that derive the
    authorization verdict from the SAME contract procedure and input the call uses
    and return it as `{ allowed, accessLoading }` on the result. A control cannot
    obtain `mutate` without the verdict, and a gated query stays disabled until the
    caller is authorized (no guaranteed-403 fetch). The id a mutation gates on is
    passed as `gateInput` (e.g. `{ id }`), the same id `mutate` will send.
  - `accessApi.useSurfaceAccess(procedure)` (`@checkstack/auth-frontend`): the
    coarse "can the user reach this management surface" gate, DERIVED from a
    representative procedure of the page (its access rule + object/parent type from
    the contract) instead of hand-passed `objectType`/`parentType` that can drift.
    Generalizes the hand-authored `useCanAccessType` surface gate.
  - Runtime gating-drift detector (`@checkstack/backend-api`): the auth middleware
    logs, in dev/e2e only (no-op in production), when a real user is denied a
    global-only gate - a candidate for the "shown-but-denied" drift class. A
    belt-and-suspenders net for hand-rolled/dynamic call paths the fused hooks
    don't cover.

  The automation editor is the reference surface: its create/update gates are fused
  directly into the create/update mutations, so there is no separate gate hook to
  keep in sync, and its surface gate uses `useSurfaceAccess`. The run-detail page's
  "Cancel run" control is also fused onto
  `cancelRun` - a real drift fix: it previously gated on a bare
  `useAccess(automation.manage)` (the GLOBAL rule), so a team-scoped manager with a
  grant on the automation but no global rule saw no Cancel button even though the
  `parentScope`d backend would authorize them; the fused gate derives the verdict
  from the page's `automationId`, so they now see it. A
  `checkstack/prefer-gated-mutation` lint rule (dev tooling, scoped, `warn`) nudges
  raw `.useMutation()` toward the fused variant so fusion is the default and raw
  mutations become the deliberate, greppable exception (the remaining raw automation
  mutations - per-row toggle/delete gated via `useResourceAccess`, and the
  stateless `renderTemplate` utility - carry a documented suppression).

  No behavior change for existing call sites: `useMutation` / `useQuery` /
  `useCanAccessType` are unchanged and remain for per-row arrays, non-procedure
  gates, and compound controls.

### Patch Changes

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/incident-common@1.9.0
  - @checkstack/maintenance-common@1.9.0
  - @checkstack/auth-common@0.13.0

## 0.12.0

### Minor Changes

- b218e3e: Migrate every list table to the shared `DataTable`, so columns can now be
  sorted by clicking their headers (name, status, severity, timestamps, counts,
  ...) and tables that had no search gain a global search box. Tables render on
  an opaque `bg-card` surface, fixing the previously transparent, hard-to-read
  tables (e.g. Catalog Management). Existing per-page filters, bulk selection,
  access gating, extension slots, provenance locks, row-click drawers, and
  mobile card layouts are preserved. Incident/maintenance severity and status
  sort by impact rank (most urgent first), not alphabetically. Server-paginated
  tables keep server-side ordering and do not add a misleading page-local search.

  Row action buttons are now standardized on the shared `RowActions`/`RowAction`
  primitive, so every table's edit/delete/etc. look identical (a subtle ghost
  icon button; destructive tinted red, confirmatory tinted green, never a loud
  filled button). Redundant section headings that merely echoed the page title on
  single-table pages (Incidents, Maintenances, SLO Objectives, Installed Plugins,
  Satellite Nodes) were removed. The Infrastructure Settings tab rail gained an
  accessible `Infrastructure settings` navigation label so its tab buttons stay
  distinguishable from the new sortable column-header buttons in each tab's table.

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/incident-common@1.8.0
  - @checkstack/ui@1.25.0

## 0.11.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-common@0.12.2
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/incident-common@1.7.2
  - @checkstack/maintenance-common@1.8.2

## 0.11.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/ui@1.23.0
  - @checkstack/auth-common@0.12.1
  - @checkstack/catalog-common@2.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/incident-common@1.7.1
  - @checkstack/maintenance-common@1.8.1

## 0.11.1

### Patch Changes

- 0cac684: Stop firing the authenticated-only capability RPCs (`canCreate`,
  `myManageableTypes`, `listMyAccessibleResources`) for anonymous sessions. The
  `AccessApi` capability hooks fell through to the team-derived path whenever the
  global rule was absent - including for guests, whose requests can only fail and
  spam the backend log with 401 "Authentication required" errors. The queries are
  now additionally gated on `isAuthenticated`; anonymous callers resolve from the
  global (anonymous-role) rules alone, which is also the only access they can
  hold.
- 0cac684: Redirect anonymous visitors from `/auth/profile` to the login page instead of
  rendering the profile skeleton and firing the authenticated-only
  `getCurrentUserProfile` query into a guaranteed 401. The profile query now
  only runs once a signed-in session is resolved.
- Updated dependencies [0cac684]
  - @checkstack/healthcheck-common@1.11.0

## 0.11.0

### Minor Changes

- d9f4654: Add `useManageableResources` to `@checkstack/auth-frontend` so a RLAC-aware
  resource picker no longer re-derives its filter. Given the candidate items and
  the write rule, it returns the exact list to offer - the shared "offer all when
  entitled, else filter to accessible, keep the current selection" policy
  (`selectManageable`), with `allowAllOverride` for a higher rule that authorizes
  any instance - so a picker never offers a resource the submit would reject.

  The incident, maintenance, and SLO "affected systems" pickers now use it instead
  of duplicating that logic. Capability gating of buttons/pages stays on the
  existing `accessApi` hooks + `PageLayout` (the pages consume the verdict
  compoundly, which a wrapper component cannot express).

- d9f4654: Fix team-scoped health-check management being invisible. Health-check
  configuration team grants are keyed on `healthcheck.healthcheck` (the RPC
  middleware derives the grant key from the configuration access rule's
  `resource`, and that rule is `accessPair("healthcheck", ...)`), but the frontend
  capability gate, the route `manageCapability`, and the Teams grant-name resolver
  all declared `healthcheck.configuration`. Because the two never matched, a user
  who could manage a health check via a team grant (without the global manage
  rule) saw none of the health-check management surfaces, and health-check grant
  names did not resolve in the Teams admin UI.

  `healthCheckResourceTypes.configuration` now resolves to `healthcheck.healthcheck`
  (with a regression test pinning it to the middleware's grant key), the resolver
  registers under the same type, and the create/edit/assignments routes gain the
  `manageCapability` they were missing so team-scoped health-check managers (and,
  for create/assign, system managers) can reach them. This is a non-breaking fix:
  no stored access-rule id or grant key changes.

- 0d912a3: Make the frontend fully RLAC-aware so team-scoped users see and can use exactly
  what the backend already authorises - no more, no less. Previously every nav
  entry, route, management page, create button, per-row action, and resource
  picker gated purely on a user's GLOBAL access rule, so a user whose team manages
  a system saw none of the surfaces the backend would happily let them use, and
  (where a page did render) could select systems they don't manage and only fail
  after submit.

  Platform primitives (on `AccessApi`, from `@checkstack/frontend-api`, implemented
  in `@checkstack/auth-frontend`). Each ORs the global RBAC rule with team-derived
  (ReBAC) grants, so a global-rule holder always sees everything:

  - `useCanCreate({ accessRule, objectType, parentType? })` - may the user create
    this type (global rule, a team `creator` grant, or managing a parent resource).
  - `useCanAccessType({ accessRule, objectType, parentType? })` - may the user
    reach a management SURFACE for this type at all (create capability OR managing
    any existing object of the type / its parent). Powers route guards, sidebar
    entries, and a management page's top-level `allowed`.
  - `useResourceAccess({ accessRule, objectType, resourceIds })` - a `canAccess(id)`
    predicate for per-row controls and for filtering resource pickers.

  Backed by three authenticated `auth` RPC procedures - `canCreate`,
  `myManageableTypes`, and `listMyAccessibleResources` - the frontend-facing
  mirrors of the existing S2S authorization endpoints, resolved against the
  caller's own team grants.

  Route/nav gating is now capability-aware: a route may declare
  `manageCapability: { objectType, parentType? }`; the route guard and sidebar then
  show/allow it for team-scoped users via `myManageableTypes`. Applied to the
  catalog, incident, maintenance, SLO, healthcheck, automation, and status-page
  management routes. The route guard resolves this through a single
  `useRouteAccess` hook with a constant hook count, since the guard is reconciled
  in place as the URL changes (a conditional hook there would trip the rules of
  hooks).

  Resource types are now typed, plugin-qualified constants. A new
  `resourceType(pluginMetadata, localType)` factory in `@checkstack/common` mints a
  nominal `ResourceType`, and each `*-common` package exports its constants (e.g.
  `catalogResourceTypes.system`, `incidentResourceTypes.incident`). The capability
  APIs accept `ResourceType`, so a mistyped `"catalog.system"` string now fails
  typecheck instead of silently breaking a gate.

  Resource pickers now offer only what the backend will accept:

  - Incident and maintenance "Affected Systems" pickers show only systems the user
    manages (or all with the global rule), matching the backend's requirement of
    MANAGE on every referenced system.
  - SLO creation is now system-scoped end to end: `createObjective` gains a
    `catalog.system` parent gate (managing the target system authorises creating an
    SLO for it, like incident/maintenance), and the SLO editor's system picker is
    filtered to manageable systems.
  - Catalog group and environment membership (add-to-group / add-to-environment,
    per-row and bulk) is gated on managing the system being (re)assigned.
  - The health-check assignment surface (Assignment IDE + the system-detail
    "Health Checks" action) requires MANAGE on the target system.

  Catalog membership chips only render a removable "x" for systems the user
  manages (removing a group/environment membership requires managing the system),
  and the Dependency Map only lets a user originate an edge from a system they
  manage (the source is access-checked; the target is not).

  Owning-team correctness: a parent-gated creator (team member, no global rule)
  who left the owning team unset previously created an object with no team grant -
  which they then could not edit. The `authorizeCreate` parent-gate path now
  resolves an owning team instead of silently orphaning the object (auto-assigns
  when the caller belongs to exactly one team, requires an explicit choice when
  several), and the `TeamOwnershipPicker` marks the field required and
  auto-selects the sole eligible team.

  Dependency writes are fixed to authorize on the SOURCE system. `createDependency`
  / `updateDependency` / `deleteDependency` previously used `instanceAccess:
{ idParam: "systemId" }`, which made the middleware look for a `dependency` grant
  keyed by the system id - a grant that never exists - so every team-scoped source
  manager was denied ("Access denied to resource dependency:<systemId>"). They now
  `parentScope` on `catalog.system` manage, so managing the source system
  authorises editing its dependencies (the target is not access-checked), matching
  health-check assignment.

  The backend authorization changes are limited to: the new read-only capability
  procedures (`canCreate` / `myManageableTypes` / `listMyAccessibleResources`), the
  SLO create parent gate, the `authorizeCreate` owning-team resolution, and the
  dependency source-scope fix. Everything else only aligns the UI with
  authorization the backend already enforced.

### Patch Changes

- 0d912a3: Let platform admins configure roles they belong to. The self-role guard (you
  cannot edit or delete the access rules of a role you currently have) exists to
  prevent access elevation, but a wildcard (`*`) admin already holds every access
  rule, so there is nothing to elevate - and the guard locked them out of
  configuring roles they were automatically added to. `updateRole` and
  `deleteRole` now exempt wildcard admins, and the role editor no longer disables
  the access-rule checkboxes (or shows the self-lockout notice) for them. The
  admin role itself stays non-editable (its access is the wildcard), and system
  roles remain undeletable.
- 0d912a3: Fix a rules-of-hooks violation on initial load. The inert `defaultAuthApi`
  (registered before the auth plugin loads) had a `useSession` that returned a
  static object and called NO hooks, while the real implementation calls
  `useSessionContext()` (one hook). When the API registry swapped the default for
  the real implementation mid-load, shell components that read
  `authApi.useSession()` (via `useAccessRules` / the help menu) changed their hook
  count between renders, producing "Rendered fewer/more hooks than expected" /
  "change in the order of Hooks" errors (e.g. in `NavList` and `HelpMenu`). The
  default now reads the same `SessionProvider` context as the real one, so the
  hook signature is identical across the swap.
- Updated dependencies [52c55bf]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/incident-common@1.7.0
  - @checkstack/maintenance-common@1.8.0
  - @checkstack/auth-common@0.12.0
  - @checkstack/catalog-common@2.6.0

## 0.10.2

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0

## 0.10.1

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/ui@1.20.0
  - @checkstack/incident-common@1.6.4
  - @checkstack/maintenance-common@1.7.4
  - @checkstack/auth-common@0.11.2
  - @checkstack/frontend-api@0.12.1

## 0.10.0

### Minor Changes

- 2e20792: Serve public status pages from the lean bundle, and stop the SPA entry pulling the whole UI kit

  Public status pages used to render inside the full admin app on same-origin
  paths, so opening one booted every plugin (and its eager slot components) and the
  entire `@checkstack/ui` barrel.

  - **Lean public bundle for public paths.** New platform extension point
    `publicPathExtensionPoint` lets a plugin declare same-origin public path
    prefixes; the backend advertises them via `/api/config` and the inlined boot
    blob. The SPA entry now loads the minimal public bundle (no admin app, no
    plugin loader, no eager plugin components) for those paths, driving the slug
    from the URL. A status page no longer loads any admin frontend code.
  - **Entry no longer imports the `@checkstack/ui` barrel.** `ThemeProvider` /
    `DensityProvider` moved from `main.tsx` into each bundle's root (`App` and
    `public-app`), cutting the critical-path preload from ~280 KB to ~0.5 KB gz on
    both bundles (the barrel now loads only inside the bundle that needs it).
  - **public-app provider fix.** Added the missing `ToastProvider` (required by
    `PerformanceProvider`) so the public bundle renders standalone.
  - **Local plugins load as parallel chunks.** The bundled plugins moved from one
    eager `import.meta.glob` chunk to per-plugin lazy chunks downloaded in
    parallel. They are still registered before first render (the shell chrome
    depends on plugin-contributed APIs such as the auth plugin's `auth.api`), and
    remote plugins continue to load after first paint and register reactively.
  - **Tree-shakeable barrels.** `@checkstack/ui`, `auth-frontend`,
    `command-frontend`, `signal-frontend`, and `announcement-frontend` now declare
    `sideEffects` (CSS only), so importing one provider/hook no longer drags a
    whole package's components into the shell. `AnnouncementBanner` also lazy-loads
    its Markdown renderer, keeping ~98 KB of react-markdown out of first paint.

  BREAKING CHANGE: status-page route ids now match the `statuspage` plugin id (the
  frontend route registry requires this). URLs change: the admin builder moves from
  `/status-pages` to `/statuspage` (and `/status-pages/:id` to `/statuspage/:id`),
  and the public page moves from `/status/:slug` to `/statuspage/view/:slug`. Update
  any bookmarks or external links to published status pages.

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/ui@1.19.0
  - @checkstack/auth-common@0.11.1
  - @checkstack/catalog-common@2.4.3
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/incident-common@1.6.3
  - @checkstack/maintenance-common@1.7.3
  - @checkstack/common@0.17.0

## 0.9.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0

## 0.9.0

### Minor Changes

- 8cad340: Improve form quality in auth dialogs (role, scope-to-team, create application).

  The Role and Scope-to-team dialog bodies are now wrapped in `<form onSubmit>`
  with a `type="submit"` primary button, so pressing Enter submits the dialog
  (matching the catalog System editor and Create User dialog). Mandatory fields
  carry the `Label required` affordance and native `required`, the first field of
  each dialog auto-focuses on open, and the scope-to-team Team / Access level
  selects are now associated with their labels via `htmlFor`/`id`.

  The Create Application dialog gains native `required` on the name input, a
  disabled-until-`name.trim()`-is-non-empty Create button (aligning with the
  Create User / System editor pattern), and an auto-focused name field; its body
  is wrapped in `<form onSubmit>` so Enter submits. No behavioral change to the
  underlying mutations or role/team logic.

- 8cad340: Add point-of-use coaching across the feature config pages and onboarding.

  - The deep-link registry (`@checkstack/common`'s `APP_DOC_SLUGS`) now exposes
    the core-concept docs pages (systems and groups, health checks, SLOs,
    incidents). Each is verified against the real docs content by the existing
    `docs-links.test.ts` rename guard.
  - The catalog, health-check, SLO and incident config pages now carry a
    one-time, dismissable `TipBanner` with a concise orientation sentence and an
    inline "Learn more" deep-link to the matching concept page, so first-time
    visitors get oriented and returning users keep a persistent header
    subtitle plus a replayable banner. The same "Learn more" link is also added
    inside each page's existing concept `<Tip>` popover (catalog has no `<Tip>`,
    so it gains only the banner).
  - The first-run onboarding form now shows a LIVE per-criterion password
    checklist that ticks green as you type, replacing the static rules text and
    the submit-only destructive error list. The criteria live in
    `@checkstack/auth-common` (`PASSWORD_CRITERIA` / `evaluatePasswordCriteria`),
    kept in lock-step with `passwordSchema` and covered by a unit test.
  - The AI chat empty state now leads with orientation-style example prompts
    ("Explain SLOs and how they relate to health checks", "How do I add a system
    to the catalog?") alongside the existing task prompts; clicking one seeds the
    composer for editing. The prompts only appear when an AI integration is
    configured.

- 8cad340: Make data-dense tables mobile-friendly and align status colors with semantic tokens.

  - Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
  - Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
  - Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.

- 8cad340: Improve sidebar navigation and information architecture:

  - Split the overloaded "Configuration" group into focused sections: "Settings"
    (Auth Settings, Teams, Secrets, Notification Settings), "Platform" (Plugins,
    GitOps, Integrations, Infrastructure), and "Developer" (Script Packages,
    Script Sandbox).
  - Unify nav active-state on a single shared `isNavRouteActive` helper so the
    sidebar rail and the shared `NavItem` both prefix-match section roots
    (child/detail routes now highlight the parent entry consistently).
  - Mark the external Docs entry with an external-link icon so it is clear which
    entries leave the app.
  - Add an "Expand all" affordance to recover from a fully-collapsed sidebar.
  - Flatten single-entry groups (e.g. Automation) into top-level items, skipping
    the redundant group header.
  - Add an in-drawer search entry to the mobile navigation (opens the Cmd+K
    palette) and auto-expand the group containing the active route when the
    drawer opens.

### Patch Changes

- 8cad340: Fix accessibility labeling defects on status-page and auth forms.

  Radix `SelectTrigger` renders a `combobox` whose accessible name comes from
  `aria-label`/`aria-labelledby`, not from its `SelectValue` placeholder child, so
  screen readers previously announced several comboboxes as unnamed. Every such
  trigger in the status-page builder (system, heading level, group, visibility) and
  in the auth team/scope/ownership/resource-grant pickers now carries an
  `aria-label` matching its visible intent.

  Form labels that were rendered as detached `<label>`/`<Label>` elements (no
  `htmlFor`/`id` pairing) are now associated with their inputs, so clicking a label
  focuses its field and assistive tech announces the field name. This covers the
  "Create Application" dialog (Name, Description) in auth, and the status-page
  builder fields (Title, Slug, Brand color, Logo URL, uptime Days, event-feed max
  updates / max age). No visual or behavioral change beyond the added accessible
  names and label associations.

- 8cad340: Design-system rework: a premium, consistent UI language across the platform.

  Foundation (`@checkstack/ui` + the shared Tailwind preset):

  - A token system wired into the shared preset so it generates app-wide: a
    surface elevation ramp (`surface` / `surface-2` / `surface-inset`), the
    aurora gradient stops, a colorblind-safe `status` triad, and `grid-line`.
  - A density model (`comfortable` / `compact`) via `--d-*` vars + `DensityProvider`
    / `useDensity`, with a user-menu density toggle, plus the polished
    skeleton / empty / error state set.
  - Honest, token-driven chart primitives (`TimeSeriesChart`, `Sparkline`,
    `RadialGauge` / aurora hero, `RequestWaterfall`, `UptimeRibbon`).
  - A signature aurora moment per page: `PageHeader` paints its icon strokes with
    the aurora gradient and adds a hairline; `Card` gains soft layered depth.

  Shell + surfaces:

  - The app shell adopts the elevation ramp (header `surface-2`, sidebar
    `surface`, content on the ambient base).
  - The system-health dashboard, health-check latency / single-run views, and the
    SLO dashboard are reskinned onto the primitives (aurora confidence gauge,
    honest p50/p95 latency, request waterfall, number-led status cards).

  App-wide adoption + premium rework:

  - Every plugin frontend adopts the tokens, status triad, density, and elevation.
  - The highest-impact surfaces in each plugin are then redesigned to a premium
    bar: real depth, number-led hierarchy, multi-encoded status (pill + dot +
    accent stripe), and refined list/table density. Several plugins extract pure
    tone/label/format logic into unit-tested modules.

  Alerts:

  - Every alert/callout is unified onto a single premium `Alert` (depth surface +
    status-accent stripe + toned icon chip, variant-driven).

  BREAKING CHANGE: the duplicate `InfoBanner` component (and its sub-components)
  is removed; use `Alert` instead - it is a drop-in replacement with the same
  variants and composable parts.

- 8cad340: Gate three feature-module animations behind the low-power performance tier so
  they respect `.claude/rules/performance.md`. The SLO streak flame
  (`StreakCounter`) and ongoing-downtime dot (`DowntimeTimeline`) no longer
  `animate-pulse`, and the auth "Reload Authentication" refresh icon
  (`StrategiesTab`) no longer `animate-spin`, when `usePerformance().isLowPower`
  is true. The icons render statically in that case; high-power devices are
  unchanged.
- 8cad340: fix: make data tables responsive on narrow viewports

  The users, teams, and roles management tables (auth-frontend), the automation
  run-history table (automation-frontend), and the integration provider
  connections table (integration-frontend) previously overflowed horizontally on
  phone-width (~375px) viewports. Each now uses the `ResponsiveTable` +
  `MobileCardList` dual-layout primitive from `@checkstack/ui`: the existing table
  renders unchanged on `sm` and up, with a stacked per-row card surfacing the key
  fields and action buttons below `sm`. Shared per-row rendering (role checkboxes,
  team/role/connection action buttons, connection status) was lifted into small
  local components so both layouts stay in sync.

- 8cad340: Adopt the canonical `toastError` helper from `@checkstack/ui` for error toasts.

  Error toasts that previously called `toast.error(extractErrorMessage(error, "Failed to X"))`
  (or interpolated `Failed to X: ${extractErrorMessage(error)}` strings) now use
  `toastError(toast, "Failed to X", error)`. This centralizes the
  "Failed to <action>: <message>" voice and applies the shared 100-character
  truncation. Error toasts that did not previously prefix the action now gain the
  canonical prefix; success toasts and terse validation one-liners are unchanged.

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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ui@1.17.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/auth-common@0.11.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/incident-common@1.6.2
  - @checkstack/maintenance-common@1.7.2

## 0.8.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/catalog-common@2.4.1
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/incident-common@1.6.1
  - @checkstack/maintenance-common@1.7.1
  - @checkstack/ui@1.16.2

## 0.8.0

### Minor Changes

- d2077bd: Platform-wide team-scoped access control on a unified relation-tuple store.

  Admins can scope any resource to teams, and the **platform** (not each plugin)
  enforces it. A plugin opts in declaratively by adding `instanceAccess` to a
  procedure's contract; the auth middleware does the rest, so enforcement is
  consistent across catalog, health checks, incidents, maintenances, SLOs,
  automations, and the dependency map, and any third-party plugin gets it for free.

  Core model:

  - **Teams are optional.** A resource with no team grants behaves exactly as
    before.
  - **Team grants are additive and restrict who can CHANGE a resource, not who can
    SEE it.** Granting a team `Manage` lets its members view and change the
    resource; `Read-only` lets them view it. Either level grants access to team
    members **even when they lack the global permission**, and granting never
    removes read from anyone who already had it (e.g. a public status page stays
    readable). Privacy is a separate, explicit opt-in via the **Private** toggle,
    which removes the global read path so only the resource's teams can see it.
  - **Ownership at creation.** Create forms expose an **Owning team** picker. A
    non-admin can create a resource for a team they belong to that holds a
    create-capability grant for that type; the new resource is auto-granted to that
    team. Incidents and maintenances are **parent-gated**: anyone who can manage a
    system may open incidents/maintenances for it, no separate grant needed.
  - **Meaningful authorization errors.** A caller with neither the global rule nor
    any team grant for a resource type gets a `403` with a structured body instead
    of a silently-empty `200`. Anonymous callers on public endpoints are never
    `403`'d, so status pages keep rendering.

  Unified relation-tuple store:

  - The previously separate access primitives (`resource_team_access.canRead` /
    `.canManage`, ownership, `resource_access_settings.teamOnly`, and
    `resource_create_grant`) are collapsed onto ONE
    `relation_tuple(object, relation, subject)` store: "a team has
    `viewer`/`editor`/`owner` on an object, or `creator` on a type". Privacy is an
    explicit **`private` marker** tuple — its **presence** closes the global read
    path (team grants only), its **absence** is the readable-by-default state, so a
    private resource with zero grants is correctly inaccessible to everyone rather
    than silently globalized. The access decision is a pure, unit-tested function.
  - The auth API is generic: `writeRelation` / `removeRelation` / `setObjectPublic`
    / `listObjectRelations` / `listSubjectRelations` / `setCreateGrant` /
    `listTeamCreateGrants` (user-facing) and `check` / `listAccessibleObjectIds` /
    `hasAnyTypeGrant` / `authorizeCreate` / `setOwner` / `deleteObjectRelations`
    (service-to-service). Migration `0008` backfills tuples from the legacy tables
    and drops them.

  Explicit per-procedure scoping:

  - Access rules (`access()` / `accessPair()`) define only the rule (id, level,
    defaults); every procedure declares its own `instanceAccess`. This removes a
    "loaded gun" default that silently applied a shared `idParam` to any procedure
    which forgot its own override.
  - Modes: `idParam` (single-resource pre-check, fails **closed** if the id does
    not resolve), `listKey` / `recordKey` (post-filter a list/record to the
    accessible subset), `create` (authorize creation + write the owning-team
    grant), `parentScope` (scope by read/manage access to a PARENT type,
    cross-plugin single-hop: "you may see incidents/maintenances/SLOs/health for
    system S iff you may see S"), and `global: true` (the honest "intentionally not
    team-scoped" opt-out). A boot-time validator **rejects** any procedure gated on
    a team-scopable resource type that declares no `instanceAccess`, turning the
    previous fail-open into a boot error.

  Teams administration:

  - **Team managers** manage their own team's members and managers without the
    global `auth.teams.manage` rule; creating, deleting, and granting a team access
    remain admin-only.
  - A **standalone Teams page** (gated on `auth.teams.read`) lets managers reach
    team administration without the admin Auth Settings page; members are added via
    a debounced directory picker.
  - A **cross-plugin `ResourceResolverRegistry`** lets owning plugins register a
    name/search resolver for their resource types, so the Teams page lists a team's
    grants **by name** (grouped by type) and offers a resource picker — an admin can
    change a grant's level, revoke it, or add one, without auth depending on every
    plugin. Resolvers shipped for catalog systems, health-check configurations,
    incidents, maintenances, SLO objectives, and automations.

  Frontend:

  - The resource-side editor is **"Who can change this"** (one Manage checkbox per
    team; unticked = read-only), with an always-visible **Private** toggle
    (disabled until a team that can Manage exists, so a resource can't be stranded).
  - `TeamOwnershipPicker` explains _why_ there's nothing to pick (not a member of
    any team, or none of your teams manage the selected parent) instead of a bare
    "global resource" line.
  - Read-only **"who can change this"** indicators on resource detail pages expand
    to the actual people by name; bulk + per-row **Scope to team** actions in the
    catalog systems list; and the team-access copy spells out that grants are
    additive and that Read-only grants view (not change) even without the global
    permission.

  Security hardening:

  - Child deletes in catalog (`removeSystemContact` / `removeSystemLink`) are scoped
    to both the child id and its parent `systemId`, closing a cross-system IDOR for
    team-scoped managers.
  - `searchUsers` is restricted to team administrators, closing a directory/email
    enumeration path opened by the default `auth.teams.read` rule.
  - Grant setters reject unregistered resource types.

  BREAKING CHANGES (beta; shipped as minor bumps):

  - `access()` and `accessPair()` no longer accept `idParam` / `listKey` /
    `recordKey`; move instance config to the procedure's `instanceAccess`.
  - Boot fails if a procedure gated on a team-scopable resource type omits
    `instanceAccess`. Declare a scoping mode or `instanceAccess: { global: true }`.
  - The `AuthService` interface is reshaped: `check`, `listAccessibleObjectIds`,
    `hasAnyTypeGrant`, `authorizeCreate` (returns `isPrivate`), `setOwner`
    (`isPrivate`), and `deleteObjectRelations`. Custom `AuthService` implementations
    and mocks must update.
  - The auth RPC contract's per-concept resource-access endpoints are replaced by
    the generic tuple API above; external callers of the old
    `getResourceTeamAccess` / `setResourceTeamAccess` / `setResourceAccessSettings`
    / `grantResourceCreate` / etc. must move to the new procedures.
  - Several contract inputs changed from a bare `string` to an object so the
    middleware can resolve the resource id: catalog `deleteSystem` (`{ id }`),
    `removeSystemContact` / `removeSystemLink` (`{ id, systemId }`); health-check
    `deleteConfiguration` / `pauseConfiguration` / `resumeConfiguration` (`{ id }`).
    All in-tree callers are updated.
  - List/record endpoints that relied on returning an empty `200` to signal "no
    access" now return a `403` for categorically-unauthorized principals.
  - The mis-keyed bulk endpoints `getBulkIncidentsForSystems`,
    `getBulkMaintenancesForSystems`, and `getBulkObjectivesForSystems` no longer
    post-filter their (systemId-keyed) result; access is already gated by
    `catalog.system` upstream.
  - Team membership/manager mutations (`addUserToTeam`, `removeUserFromTeam`,
    `addTeamManager`, `removeTeamManager`) now require `auth.teams.read` instead of
    `auth.teams.manage` at the contract level (broadened to per-team managers).
  - The `resource_team_access`, `resource_access_settings`, and
    `resource_create_grant` tables are dropped (data backfilled into
    `relation_tuple` by migration `0008`). A previously inconsistent "team-only with
    zero grants" resource is now correctly inaccessible to global-access holders.

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/auth-common@0.10.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/incident-common@1.6.0
  - @checkstack/maintenance-common@1.7.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0

## 0.7.7

### Patch Changes

- Updated dependencies [6005271]
- Updated dependencies [4134ed9]
  - @checkstack/ui@1.16.0
  - @checkstack/auth-common@0.9.1

## 0.7.6

### Patch Changes

- Updated dependencies [ebef442]
  - @checkstack/auth-common@0.9.0

## 0.7.5

### Patch Changes

- 0626782: Guard the role editor against granting inert (and misleading) permissions to the
  anonymous role.

  RPC procedures carry two independent axes: `userType` (the hard authentication
  gate) and `access` rules (authorization). An admin can grant the anonymous role
  any access rule, but if the procedures needing that rule are `userType:
"authenticated"`/`"user"`, the grant does nothing - the auth middleware rejects
  unauthenticated callers BEFORE access rules are checked (so there is no security
  hole; the grant is simply inert). After anonymous users started seeing
  permission-gated UI, such a grant would surface as visible-but-broken controls.

  - The backend now computes, from contract metadata, the access rules an anonymous
    caller can actually use (a rule is "usable" iff at least one `public` procedure
    requires it) via `pluginManager.getAnonymousUsableAccessRuleIds()`, exposed to
    plugins through the plugin environment.
  - `auth.getAccessRules` annotates each rule with `anonymousUsable`.
  - `auth.updateRole` REFUSES to ADD a non-usable rule to the anonymous role
    (existing grants are untouched, so no configuration can be wedged). This is a
    guardrail, not an enforcement change - RPC authorization is unchanged.
  - The role editor disables non-usable rules (with an explanation) when editing
    the anonymous role.

  Verified live: `getAccessRules` reports 11 anonymous-usable vs 58 not; granting
  `incident.incident.manage` to the anonymous role returns HTTP 400 with a clear
  message.

- 56e7c75: Hide navigation, actions and links that the current user cannot use, so anonymous
  and read-only users no longer see entries that lead to "Access Denied" or to
  actions the server would reject.

  - **Sidebar**: a nav entry can now declare a dynamic `nav.isVisible({ accessRules, isAuthenticated })` predicate (in addition to the static `accessRule`). A group whose every entry is filtered out is no longer rendered. The filtering/grouping logic is extracted to a pure, unit-tested helper.
  - **Infrastructure**: its sidebar entry is shown only when the user can READ at least one contributed tab (queue, cache, …), instead of always (it previously had no static rule because tabs are contributed at runtime).
  - **Notification Settings**: hidden from anonymous users - notifications are per-user, so an anonymous visitor can't have any.
  - **Anomaly Mute / Suppress**: the "Mute" / "Mute all" controls (a per-user preference) are hidden from anonymous visitors; the "Suppress" control is gated on `anomalyAccess.feed.manage`. Both were previously always visible.
  - **Dashboard**: the "Open Catalog" actions (which open the manage-only Catalog config page) are hidden from users without `catalogAccess.system.manage`, and the "View catalog" link is gated on `catalogAccess.system.read`.
  - **Dashboard status signals**: the per-system status rows contributed by plugins (`SystemSignalsSlot`) now render as a LINK only when the user can open the target, and as plain text otherwise. `SystemSignal` gains an optional `accessRule`; the healthcheck, anomaly, and dependency fillers set it for their gated targets (check-history / assignments / dependency-map). Signals pointing at ungated pages (incident / maintenance / SLO detail) stay links.
  - **Plugin Manager**: the "Install plugin" button (which opens the install-gated page) is hidden from users with only `plugin` view access.
  - **Satellites**: the page is entirely manage-gated, but its route/sidebar entry was gated on `read`, so read-only users saw the nav item and hit "Access Denied" on click. The route and nav entry now require `satellite.manage`.

  The `@checkstack/ai-backend` bump is only the regenerated bundled docs index
  (the frontend routing guide gained the `nav.isVisible` section); no code change.

  **BREAKING (`@checkstack/frontend-api`):** the `AccessApi` interface gains a
  required `useIsAuthenticated()` method. Custom `AccessApi` implementations must
  add it (it returns `{ loading, isAuthenticated }`). The built-in auth
  implementation and the no-auth fallback already do. `NavEntry` also gains an
  optional `isVisible` predicate (purely additive).

- 56e7c75: Fix frontend access checks to use FULLY-QUALIFIED access-rule ids, and resolve
  the anonymous role on the frontend.

  Granted access-rule ids are stored fully-qualified as `{pluginId}.{ruleId}` (e.g.
  `incident.incident.read`) so two plugins defining the same short rule id never
  collide. The frontend, however, was checking the UNqualified id (`incident.read`)
  via `isAccessRuleSatisfied`, so every check failed for any user without the `*`
  (admin) grant - masked in development because dev-auth grants `*`. This silently
  broke ALL non-admin frontend gating (route guards, sidebar entries, and
  `useAccess`-based button/link gating).

  - **`@checkstack/common`**: `AccessRule` now carries a REQUIRED owning `pluginId`;
    `access()` / `accessPair()` require and stamp it; `isAccessRuleSatisfied`
    qualifies the rule (`{pluginId}.{id}`, plus the manage->read escalation) and
    matches ONLY the qualified form. There is intentionally NO unqualified fallback
    - matching a bare id would let one plugin's grant satisfy another plugin's
      identically-named rule (a cross-plugin privilege-escalation flaw). Every plugin
      that defines access rules now passes its own `pluginId`.
  - **`@checkstack/backend`**: `pluginManager.getAllAccessRules()` no longer strips
    the `pluginId` field (the rule `id` is already fully-qualified for the DB sync).
  - **Route guard** (`@checkstack/frontend` / `@checkstack/frontend-api`) now
    checks the FULL rule object (so it qualifies and escalates), not a bare id.
  - **Anonymous role on the frontend**: the `accessRules` procedure is now
    `public`, returning the configurable anonymous role's grants to unauthenticated
    callers; `useAccessRules` fetches them for guests instead of returning an empty
    set. So anonymous UI now reflects exactly what the anonymous role is allowed -
    which an admin can change (`isPublic` is only the seeded default).
  - Incident / maintenance / SLO detail routes are now read-gated (their read rule
    is an `isPublic` default, so the anonymous role holds it unless an admin
    revokes it); their dashboard status signals carry that rule and render as a
    link only when the viewer may open it.

  **BREAKING (`@checkstack/common`):** `AccessRule.pluginId` is now REQUIRED, and
  `access()` / `accessPair()` require a `pluginId` option. `isAccessRuleSatisfied`
  matches ONLY the fully-qualified `{pluginId}.{ruleId}` form - the previous
  unqualified fallback is removed, because it was a cross-plugin
  privilege-escalation flaw. Any code constructing an `AccessRule` or calling
  `access()`/`accessPair()` must supply the owning `pluginId`.

  Verified live against an anonymous caller: read pages resolve (qualified match),
  manage actions are denied, manage->read escalation and `*` still work.

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/auth-common@0.8.3
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0

## 0.7.4

### Patch Changes

- fb705df: Upgrade React 18 to React 19 across the platform.

  **BREAKING (runtime frontend plugins):** React is shared as a Module Federation
  singleton, so the host now provides **React 19** to every runtime plugin.
  Frontend plugins built against React 18 must be rebuilt against React 19
  (`react` / `react-dom` `^19`). The scaffold templates and the host/plugin MF
  `requiredVersion` are updated to `^19`. `react` (and now `react-dom`) are pinned
  to a single version across the workspace via syncpack so the singleton can never
  skew (react and react-dom must match exactly).

  The React 19 removed-API surface was audited - the codebase used only no-arg
  `useRef()` (now `useRef<T | undefined>(undefined)`); no `ReactDOM.render`,
  legacy context, string refs, or function-component `defaultProps`. This also
  clears the `IMPORT_IS_UNDEFINED` build warnings for `React.use` /
  `React.useOptimistic` (react-router 7 feature-detection), which React 19 exports.

  The downstream `*-frontend` packages (and `@checkstack/infrastructure-common`)
  receive only the mechanical `react` dependency bump (`patch`); the framework
  packages carrying the shared-singleton change are bumped `minor`.

- Updated dependencies [9d8961c]
- Updated dependencies [fb705df]
  - @checkstack/ui@1.15.0
  - @checkstack/frontend-api@0.8.0
  - @checkstack/auth-common@0.8.2
  - @checkstack/common@0.14.1

## 0.7.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/auth-common@0.8.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2

## 0.7.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/auth-common@0.8.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/ui@1.13.2

## 0.7.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/auth-common@0.8.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/ui@1.13.1

## 0.7.0

### Minor Changes

- 9dcc848: Add the AI platform: a transport-agnostic tool spine, an OAuth Authorization Server + read-only MCP server, a propose/apply flow with audit log, a streaming in-app chat agent, per-conversation permission modes, per-integration spend caps, and user-scoped tool authorization.

  Two new packages, `@checkstack/ai-common` (the `AiTool` contract, `read`/`mutate`/`destructive` effect classification, the `ai.*` access rules, the OpenAI-compatible connection shape, and the wire contracts) and `@checkstack/ai-backend` (the tool registry, extension points, principal-to-tool resolver, shared zod-to-JSON-Schema serializer, and all transports). The OpenAI-compatible integration provider registers through the existing integration provider extension point, so its API key is stored in the Secrets Vault and configured in the generic Connections UI.

  What ships:

  - Tool spine and extension points: `aiToolExtensionPoint.registerTool` (hand-authored composite tools) and `aiToolProjectionExtensionPoint.expose` (opt-in projections of existing oRPC procedures). Authorization mirrors `autoAuthMiddleware` exactly - a tool is surfaced only when every `requiredAccessRules` entry is satisfied, so a scope-narrowed principal can only ever see fewer tools.
  - OAuth + MCP: Checkstack can act as its own OAuth 2.1 Authorization Server (authorization code + PKCE, consent screen, Dynamic Client Registration) and expose a read-only MCP server over Streamable HTTP at `/api/ai/mcp`. Off by default, enabled by the admin `ai.mcp-oauth` setting. A Bearer OAuth-token branch is added to the auth strategy; token scopes are intersected live with the bound user's access rules on every call. A shared-Postgres rate limiter throttles the DCR endpoint per client IP. `getMcpOAuthSettings` / `setMcpOAuthSettings` contracts added to `@checkstack/auth-common`. A minimal OAuth consent page (`/auth/oauth-consent`) renders the requesting client and scopes.
  - Propose/apply + audit: a transport-agnostic two-step service - `propose` re-checks authz, runs the tool's `dryRun` without mutating, and returns a single-use proposal token (the `proposed` audit row IS the token store, 10-minute TTL, atomic single-use); `apply` re-parses the server-stored payload, re-checks authz, and atomically commits. The `ai_tool_calls` audit table records every call across both transports with a SHA-256 args hash (never raw arguments) and stamps who proposed and who applied. An `ai.toolCalled` event carries metadata only.
  - In-app chat: a server-side, provider-agnostic Vercel AI SDK agent loop (OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio, ...). The model provider is built on the backend from the integration credentials, so the API key never leaves the backend. The loop offers only resolver-allowed tools, auto-runs read tools (re-entering the live router as the logged-in user) and routes mutating / destructive tools through propose/apply. Durable conversation persistence (`ai_conversations`, `ai_messages`, owner-scoped RPCs) plus a streaming chat UI with a confirm-card component and per-integration model picker.
  - Per-conversation permission mode (Claude-Code-style approve/auto), a durable `permission_mode` column on `ai_conversations` (default `approve`). `read` always auto-runs in both modes; `mutate` inherits the mode (auto-applies server-side in `auto`, confirm-carded in `approve`); `destructive` ALWAYS requires the human `applyTool` in both modes. Security invariant (structural + tested): the mode is consulted only on the `mutate` branch, so no `(effect, mode)` pair routes a destructive tool to auto-apply.
  - Per-integration LLM spend cap (optional `spendCap` = `tokenBudget` + `windowMinutes`, default OFF). Spend is tracked in a shared-Postgres `ai_spend` ledger; enforcement is a rolling-window SUM run before each turn (HTTP 429 over budget). Per-principal tool rate-limit budgets are a rolling COUNT over `ai_tool_calls`, enforced on both transports. An absent / empty / incomplete `spendCap` is treated as "no cap" rather than rejected.
  - Full tool-call replay: `ai_messages.model_messages` (jsonb) persists the canonical AI-SDK `ResponseMessage[]` per turn and replays them verbatim on the next turn; legacy rows fall back to text-only replay.
  - Enforced no-secret-leak scrubbing: `appendMessage` runs `scrubContent` on every write, redacting credential-shaped keys and high-confidence credential values; a canary regression test asserts injected secrets are stripped. A hardening test suite asserts no secret appears in any AI-surface DTO and that handler-side authz holds when the model misbehaves.
  - Provider correctness: the chat provider uses `@ai-sdk/openai-compatible`'s `chatModel` (plain `/chat/completions`), so OpenAI-compatible gateways (OpenRouter, DeepSeek, Ollama, vLLM) no longer reject turns with `invalid_prompt`; `@ai-sdk/openai` is removed.

  BREAKING CHANGES:

  - The `AiTool` contract (`@checkstack/ai-common`) gained a `TRpc` type parameter, and both `dryRun` and `execute` now receive a USER-SCOPED `rpcClient` arg bound to the originating user. Every plugin procedure a tool calls re-enters the live router AS THAT USER, so handler-side authorization (access rules AND per-resource/team scope) is enforced exactly as a direct UI/RPC call - closing a prior privilege-escalation where tools captured a trusted service client at construction. A hand-authored tool MUST resolve its plugin client from this per-call arg and MUST NOT capture a trusted service client at factory scope. Tool factories that previously took `{ rpcClient }` should drop that parameter.
  - `AiToolProjectionExtensionPoint.expose` no longer takes a second `pluginMetadata` argument; the owning metadata lives on `input.sourcePluginMetadata`. Callers must drop the second argument.

  State and scale: conversations, messages, the audit log, proposal tokens, the rate-limit counter, and the spend ledger all live in shared Postgres, so every pod answers identically and the agent loop is resumable on any pod. The only pod-local state is the live MCP connection registry (bookkeeping, never a source of truth). Cross-pod conversation readback, the spend cap, and the tool budget are verified by env-gated two-pod integration tests.

  This is a beta minor.

- 9dcc848: Cut initial-load JS: lazy plugin contributions, a hardened lazy-by-default contribution contract, on-demand Monaco, and a lighter icon/chart load.

  - Lazy plugin route pages: each plugin's route `element` references a `React.lazy`-wrapped page rendered inside a shared `<Suspense>` boundary. Plugins still register synchronously, so nav, slots, commands, API factories, and `foreignSignals` are available on first paint. This moves ~37 route-page chunks (~600 KB) out of the entry; the entry chunk drops from ~2.4 MB to ~190 KB. Auth flow pages stay eager. The `@checkstack/scripts` scaffold template generates lazy route pages too.
  - Hardened contribution contract (BREAKING, frontend plugin contract): plugins declare contributions lazily and let the framework own code-splitting, Suspense, and per-plugin error isolation. Routes use `load: () => import("./Page").then((m) => ({ default: m.Page }))` instead of `element: <Page />` (`element` is still accepted for the rare page that must paint without a chunk fetch; provide exactly one). Slot extensions accept either an eager `component` or a lazy `load`; new `getLazyContribution` + `ExtensionComponent` exports from `@checkstack/frontend-api` render either kind. This also fixes runtime-installed plugins: `ExtensionSlot` subscribes to the plugin registry, and the API registry rebuilds when the plugin set changes (`getPlugins()` returns an immutable snapshot via `useSyncExternalStore`). A per-plugin error boundary contains a bad contribution.
  - On-demand Monaco: the `@checkstack/ui` barrel no longer pulls the `@codingame/*` / `monaco-languageclient` stack into the initial load. `CodeEditor` lazy-loads its Monaco-backed editor behind `React.lazy` + Suspense, `validateTypeScriptSources` imports the editor API via in-body `await import(...)`, and the "vscode services ready" signal moved to a Monaco-free module. The ~10 MB editor body loads only when a `CodeEditor` mounts. A `react-vendor` `manualChunks` split was added for stable vendor caching.
  - lucide-react 1.x + lighter icons/charts (BREAKING for icon consumers): lucide-react unified from three drifting ranges to `^1.17.0`. lucide v1 removed brand icons, so the GitHub/GitLab marks are vendored in `@checkstack/ui` (`GithubIcon`, `GitlabIcon`, `brandIcons`); a new `IconName` type (`LucideIconName | BrandIconName`) in `@checkstack/common` is canonical, accepted by `AuthStrategy.icon` and the card components, so data-driven brand names keep working. `DynamicIcon` no longer eagerly imports lucide's ~1600-icon map (~1 MB) - it lives in a `React.lazy` `iconRegistry` chunk fetched on first data-driven render, while statically named-imported icons tree-shake normally. The recharts-backed health-check charts (~300 KB) and the `HealthCheckSystemOverview` drawer leave the initial load.

  BREAKING CHANGES:

  - Frontend plugin contract: routes/slot contributions are lazy-by-default (`load` instead of `element`/eager elements) as described above.
  - Any external consumer importing a brand icon from `lucide-react` (e.g. `import { Github } from "lucide-react"`) must switch to the vendored `@checkstack/ui` brand icons or a custom SVG.

  This is a beta minor.

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Assorted bug fixes and small hardening across the platform.

  - announcement-backend: `updateAnnouncement` now invalidates the active-announcements and admin-list caches (it was missing the `invalidateAllActive` / `invalidateListAll` calls), so an edited announcement no longer stays stale up to the 45s TTL.
  - anomaly-backend: anomaly/drift state transitions (confirmations, recoveries, self-resolutions) now log at `debug` instead of info/warn - they are already surfaced via the `ANOMALY_STATE_CHANGED` signal, so logging them louder just added noise; genuine failure paths stay `warn`.
  - backend: the `/api/:pluginId/*` dispatcher now populates `requestHeaders` on the per-request RPC context, so a handler that re-enters the router as the originating user (e.g. an AI tool's user-scoped client) can forward the caller's session cookie / bearer - previously the loopback failed with "Authentication required". Guarded by a real end-to-end integration test. The HTTP server idle timeout is also raised (default 255s, configurable via `CHECKSTACK_SERVER_IDLE_TIMEOUT_SECONDS`, clamped 0-255, reset on each streamed chunk) so long AI chat SSE turns are not severed mid-stream.
  - backend: a request for an unknown plugin id (`/api/<unknown>/...`) now returns `404 Not Found` instead of `500` (and logs at warn, not error, since it is a client request) - an unknown _procedure_ on a known plugin already 404'd. The in-app docs namespace `/checkstack/*` now serves Starlight's own `404.html` with a real 404 status for a missing doc, instead of falling through to the SPA catch-all and 200-ing the app shell. Both guarded by tests.
  - automation-common: remove polynomial-time backtracking from `toShellEnvKey`'s underscore-trim (CodeQL `js/polynomial-redos`); a negative look-behind anchors the trailing run, keeping the trim linear.
  - common + script-packages-common: the pure transport-safe sandbox-policy schema (`sandboxPolicySchema` and its sub-schemas + inferred types) moved to `@checkstack/common` (the neutral base), removing two inverted deps that existed only to reach the shape; `@checkstack/backend-api` continues to re-export it. The schema is no longer exported from `@checkstack/script-packages-common`. Pure refactor, no behavior change.
  - catalog-backend: reject duplicate system names (a `CONFLICT` on create/rename, enforced by a pre-write check AND a new DB unique index on `systems.name`, migration 0004 which first resolves pre-existing duplicates by suffixing).
  - catalog-frontend: detail-page cleanups (use `<NotFound />` not `<AccessDenied />` on the not-found branch, a readable key/value metadata list via `normalizeMetadata`, runtime locale via `formatDate`); and stop the browse view re-rendering on every health report (adopt a new statuses report only when a value actually changed, via `healthStatusesEqual`, so rows stay stable and interactive).
  - healthcheck-backend: fix the daily-rollup retention step failing with an `ON CONFLICT` mismatch (SQLSTATE 42P10) after `environmentId` joined the `health_check_aggregates` unique constraint - the rollup now groups by (day, environmentId, sourceId) and uses a single exported conflict-target constant (`DAILY_AGGREGATE_CONFLICT_TARGET`) kept in lock-step with the schema by a unit test.
  - automation-frontend: the service-account picker's "Learn more" links are now absolute URLs to the deployed Astro docs site (they 404ed as in-app relative paths). The Monaco script editor double-init crash is fixed (serialized cold init, a guarded `monacoGuard` accessor, theme/type effects gated on `apiReady`).
  - auth-frontend: bound the desktop user-menu popover height (`max-h-[var(--radix-popover-content-available-height)]` + `overflow-y-auto`) so it no longer clips on short viewports, and fold the standalone `Account > Profile` item into a focusable name/email header (`profileHref` on `UserMenu`); the now-empty `Account` group no longer renders.
  - satellite-frontend: picked up via the sidebar-nav migration (account-only user menu).

  (Related UI fixes - the Monaco editor following the app theme, the `DynamicOptionsField` no-flash fix, the shared `Spinner`, GFM tables, and the user-menu popover bound - land their `@checkstack/ui` bump in the UI/perf changesets where `@checkstack/ui` is already minored.)

  This is a beta patch.

- 9dcc848: Guard component animations behind isLowPower, and add a shared inline Spinner.

  - `@checkstack/ui` shared components (`Tabs`, `ConfirmationModal`, `Accordion`, `CodeEditor` popout-button backdrop blur) now drop their `animate-*` / `backdrop-blur` classes when the device reports the low-power tier, matching `LoadingSpinner` / `Skeleton`. No public API change; normal-power rendering is unchanged.
  - A new shared inline `Spinner` (`@checkstack/ui`) renders a lucide `Loader2` whose `animate-spin` is gated internally behind `usePerformance().isLowPower`, so call sites inherit the low-power guard. Props: `size` (`sm`/`md`/`lg`), `className`, rest spread to the icon; decorative by default (`aria-hidden`), `role="status"` when given `aria-label`. The hand-rolled `Loader2` button/table spinners in `HealthCheckDrawer`, `HealthCheckRunsTable`, `IncidentEditor`, `IncidentUpdateForm`, `ProviderConnectionsPage`, `MaintenanceEditor`, `MaintenanceUpdateForm`, `UserChannelCard`, and `DynamicOptionsField` are migrated onto it.
  - Remaining unguarded `animate-*` / `animate-in` / blur classes across the auth, gitops, healthcheck, incident, integration, maintenance, and notification frontends are gated behind `usePerformance().isLowPower`, so effects degrade gracefully on low-power devices per the performance rule.

  Normal-power behavior is unchanged; low-power rendering drops the animations.

  This is a beta minor.

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
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/auth-common@0.8.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0

## 0.6.7

### Patch Changes

- b995afb: Tidy the user menu: move "Script packages" and "Secrets" into the **Configuration** group (the now-empty **Administration** group is gone), and display the user-menu groups in alphabetical order instead of a hardcoded canonical order.
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
  - @checkstack/ui@1.12.0

## 0.6.6

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
- Updated dependencies [c39ee69]
  - @checkstack/frontend-api@0.6.0
  - @checkstack/ui@1.11.0
  - @checkstack/common@0.12.0
  - @checkstack/auth-common@0.7.2

## 0.6.5

### Patch Changes

- f23f3c9: Phase 12 of the v1 polishing plan: three coordinated cleanup items that
  close out half-finished features ahead of v1.0.

  `@checkstack/incident-backend` adds focused unit-test coverage for
  `IncidentService.hasActiveIncidentWithSuppression` in
  `core/incident-backend/src/service.test.ts`. The new tests exercise the
  real query-builder logic against a programmable mock data source and
  pin down the active-only silencing contract: returns `true` only when
  an unresolved incident with `suppressNotifications=true` is associated
  with the queried `systemId`; returns `false` for resolved incidents,
  incidents with `suppressNotifications=false`, systems with no incident
  associations, and other systems' silenced incidents. No runtime
  changes; the service code was already correct end-to-end (write path
  through `IncidentEditor`, read path through the healthcheck queue
  executor and dependency notifications). A companion docs page,
  `docs/src/content/docs/architecture/alert-silencing.md`, documents the
  contract, the two read sites, and the dispatch paths silencing does
  NOT cover so users aren't surprised when an unaware channel keeps
  firing.

  `@checkstack/auth-frontend` surfaces inline role assignment inside the
  user-creation dialog so admins can pick role(s) atomically with the
  create call. `CreateUserDialog` now renders a checkbox list of
  assignable roles (those with `isAssignable !== false`); on submit,
  `UsersTab` awaits `createCredentialUser`, then immediately calls
  `updateUserRoles` with the selected role IDs. On partial failure
  (user created, role assignment failed) the UI surfaces a warning toast
  naming the recovery path rather than silently misreporting success. No
  new endpoints — reuses the existing `createCredentialUser` +
  `updateUserRoles` contract pair. A companion docs page,
  `docs/src/content/docs/architecture/users-and-teams.md`, documents the
  identity / role / team model, the two S2S endpoints
  (`checkResourceTeamAccess`, `getAccessibleResourceIds`) other plugins
  should call to honour team grants, and explicitly defers audit
  logging, CSV export, team-scoped resource-management UI, and deletion
  side-effect handling to v1.1.

  The third item — deleting the empty `core/status-frontend/` and
  `core/status-page-backend/` shells — is tooling-only and intentionally
  ships without a changeset; neither shell had a `package.json`, source
  file, or downstream importer.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/ui@1.10.0
  - @checkstack/auth-common@0.7.1

## 0.6.4

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0

## 0.6.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3

## 0.6.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2

## 0.6.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/auth-common@0.7.0
  - @checkstack/frontend-api@0.5.1
  - @checkstack/ui@1.8.1

## 0.6.0

### Minor Changes

- 950d6ec: Fix mobile UserMenu items rendering at zero height, group menu items by
  section, and unstack cramped card headers on small viewports.

  - **UserMenu mobile bug**: On mobile, the user-menu Sheet rendered every
    menu item as a grid row, which combined with `flex-shrink: 1` on each
    item collapsed the buttons whose internal layout uses `display: flex`
    (the items registered with `useNavigate` rather than `<Link>`) to zero
    content height. Switched the mobile container to a flex column with
    `[&>*]:shrink-0` and added `min-h-0` so the sheet scrolls correctly
    when the list overflows.

  - **UserMenu grouping**: Slot extensions now accept an optional `group`
    field. The user menu buckets `UserMenuItemsSlot` extensions by `group`
    and renders each group under a labeled header (`Workspace`,
    `Reliability`, `Configuration`, `Documentation`, `Account`). Existing
    core plugins are tagged with the appropriate group; third-party plugins
    can pick any of these or supply their own label. Untagged extensions
    render last with no header. `UserMenuItemsBottomSlot` is unaffected.

  - **Card header responsiveness**: `CardHeaderRow` (the primitive shared by
    Incident, Maintenance, Auth, Catalog, GitOps and other config cards) now
    stacks vertically on narrow viewports and only switches to a single row
    at the `sm` breakpoint, so titles and adjacent filter controls (e.g.
    status `Select`, "Show resolved" checkbox) no longer cram together on
    mobile. Refactored the Incident and Maintenance config pages to use the
    primitive instead of a hand-rolled `flex items-center justify-between`
    row, and made their `Select` triggers full-width on mobile.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/auth-common@0.6.6

## 0.5.33

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/auth-common@0.6.5
  - @checkstack/common@0.8.0
  - @checkstack/ui@1.7.1
  - @checkstack/frontend-api@0.4.2

## 0.5.32

### Patch Changes

- 32d52c6: Fix and improve password reset flow + email branding:

  - **Fix**: password reset emails were failing with "Malformed password reset URL: missing token parameter". Better-auth puts the reset token in the URL path (`/reset-password/{token}`), not as a `?token=` query param, so the previous URL-parsing logic always failed. Now uses the `token` argument better-auth passes to `sendResetPassword` directly.
  - **UX**: the reset password page now validates the token on load via a new anonymous `validateResetToken` endpoint, so users see "Invalid Link" / "Link Expired" before typing a password rather than after submitting. Tokens are 24-char nanoid-style values (~143 bits of entropy), so exposing validity does not enable enumeration.
  - **Fix**: transactional notifications were hardcoded to `importance: "critical"`, causing password reset emails to display a misleading "CRITICAL" badge. The `sendTransactional` contract now accepts an optional `importance` field that defaults to `"info"`.
  - **Branding**: redesigned the email layout (`wrapInEmailLayout`) with a Checkstack-style engineering aesthetic — dark header with grid pattern, monospace importance badge, hardened CTA button (Outlook VML fallback + explicit text color), and force-light color scheme to prevent client auto-inversion from breaking text legibility.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-common@0.6.4
  - @checkstack/ui@1.7.0

## 0.5.31

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/frontend-api@0.4.0
  - @checkstack/ui@1.6.1

## 0.5.30

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/auth-common@0.6.3
  - @checkstack/frontend-api@0.3.11

## 0.5.29

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1

## 0.5.28

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-common@0.6.2

## 0.5.27

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0

## 0.5.26

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0

## 0.5.25

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6

## 0.5.24

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5

## 0.5.23

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4

## 0.5.22

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3

## 0.5.21

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2

## 0.5.20

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1

## 0.5.19

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0

## 0.5.18

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
  - @checkstack/ui@1.2.1
  - @checkstack/frontend-api@0.3.9
  - @checkstack/auth-common@0.6.1

## 0.5.17

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0

## 0.5.16

### Patch Changes

- e01945b: Reduce excessive /api/auth/get-session requests

  - Enable better-auth's `cookieCache` on the server (5-minute TTL) so repeated session
    checks verify a signed cookie instead of querying the database. Compatible with
    horizontal scaling since validation uses the shared `BETTER_AUTH_SECRET`.

  - Introduce a `SessionProvider` React context that fetches the session exactly once
    at the top of the component tree. All 7+ components that previously called
    `useSession()` independently now read from this shared context — eliminating
    duplicate HTTP requests on every page load.

  - Remove the `useAuthClient()` hook which created per-component better-auth client
    instances via `useMemo`, causing separate nanostore atoms and independent fetches.
    All imperative usages (signIn, signUp, resetPassword, etc.) now use the singleton
    `getAuthClientLazy()` instead.

## 0.5.15

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5

## 0.5.14

### Patch Changes

- c0c0ed2: Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.
- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-common@0.6.0
  - @checkstack/ui@1.1.4

## 0.5.13

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-common@0.5.7
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/ui@1.1.3

## 0.5.12

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/ui@1.1.2

## 0.5.11

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/auth-common@0.5.6
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/frontend-api@0.3.6

## 0.5.10

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0

## 0.5.9

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-common@0.5.5
  - @checkstack/frontend-api@0.3.5

## 0.5.8

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/ui@0.5.3

## 0.5.7

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-common@0.5.4
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/ui@0.5.2

## 0.5.6

### Patch Changes

- Updated dependencies [090143b]
  - @checkstack/ui@0.5.1

## 0.5.5

### Patch Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

- Updated dependencies [223081d]
  - @checkstack/ui@0.5.0

## 0.5.4

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-common@0.5.3
  - @checkstack/frontend-api@0.3.3

## 0.5.3

### Patch Changes

- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0

## 0.5.2

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/auth-common@0.5.2
  - @checkstack/common@0.5.0
  - @checkstack/frontend-api@0.3.2
  - @checkstack/ui@0.3.1

## 0.5.1

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-common@0.5.1
  - @checkstack/frontend-api@0.3.1

## 0.5.0

### Minor Changes

- d94121b: Add group-to-role mapping for SAML and LDAP authentication

  **Features:**

  - SAML and LDAP users can now be automatically assigned Checkstack roles based on their directory group memberships
  - Configure group mappings in the authentication strategy settings with dynamic role dropdowns
  - Managed role sync: roles configured in mappings are fully synchronized (added when user gains group, removed when user leaves group)
  - Unmanaged roles (manually assigned, not in any mapping) are preserved during sync
  - Optional default role for all users from a directory

  **Bug Fix:**

  - Fixed `x-options-resolver` not working for fields inside arrays with `.default([])` in DynamicForm schemas

### Patch Changes

- 10aa9fb: Add SAML 2.0 SSO support

  - Added new `auth-saml-backend` plugin for SAML 2.0 Single Sign-On authentication
  - Supports SP-initiated SSO with configurable IdP metadata (URL or manual configuration)
  - Uses samlify library for SAML protocol handling
  - Configurable attribute mapping for user email/name extraction
  - Automatic user creation and updates via S2S Identity API
  - Added SAML redirect handling in LoginPage for seamless SSO flow

- Updated dependencies [d94121b]
  - @checkstack/auth-common@0.5.0
  - @checkstack/ui@0.2.4

## 0.4.1

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3

## 0.4.0

### Minor Changes

- df6ac7b: Added onboarding flow and user profile

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-common@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/ui@0.2.2

## 0.3.0

### Minor Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-common@0.3.0
  - @checkstack/ui@0.2.1

## 0.2.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- 95eeec7: # Auto-login after credential registration

  Users are now automatically logged in after successful registration when using the credential (email & password) authentication strategy.

  ## Changes

  ### Backend (`@checkstack/auth-backend`)

  - Added `autoSignIn: true` to the `emailAndPassword` configuration in better-auth
  - Users no longer need to manually log in after registration; a session is created immediately upon successful sign-up

  ### Frontend (`@checkstack/auth-frontend`)

  - Updated `RegisterPage` to use full page navigation after registration to ensure the session state refreshes correctly
  - Updated `LoginPage` to use full page navigation after login to ensure fresh permissions state when switching between users

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/auth-common@0.2.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/ui@0.2.0

## 0.1.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

### Patch Changes

- 97c5a6b: Fix Radix UI accessibility warning in dialog components by adding visually hidden DialogDescription components
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/auth-common@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4

## 0.0.4

### Patch Changes

- f5b1f49: Improved BASE_URL handling with fallback defaults for local development.
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/auth-common@0.0.3
  - @checkstack/frontend-api@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/ui@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-common@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/ui@0.0.2

## 0.3.0

### Minor Changes

- 52231ef: # Auth Settings Page Refactoring

  ## Auth Frontend

  Refactored the `AuthSettingsPage` into modular, self-contained tab components:

  - **New Components**: Created `UsersTab`, `RolesTab`, `StrategiesTab`, and `ApplicationsTab` components
  - **Dynamic Tab Visibility**: Tabs are now conditionally shown based on user permissions
  - **Auto-Select Logic**: Automatically selects the first available tab if the current tab becomes inaccessible
  - **Self-Contained State**: Each tab component manages its own state, handlers, and dialogs, reducing prop drilling

  ## UI Package

  - **Responsive Tabs**: Tabs now use column layout on small screens and row layout on medium+ screens

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

### Patch Changes

- 54cc787: ### Fix Access Denied Flash on Page Load

  Fixed the "Access Denied" screen briefly flashing when loading permission-protected pages.

  **Root cause:** The `usePermissions` hook was setting `loading: false` when the session was still pending, causing a brief moment where permissions appeared to be denied.

  **Changes:**

  - `usePermissions` hook now waits for session to finish loading (`isPending`) before determining permission state
  - `PageLayout` component now treats `loading=undefined` with `allowed=false` as a loading state
  - `AuthSettingsPage` now explicitly waits for permission hooks to finish loading before checking access

  **Result:** Pages show a loading spinner until permissions are fully resolved, eliminating the flash.

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/auth-common@0.2.1
  - @checkstack/frontend-api@0.1.0

## 0.2.1

### Patch Changes

- 1bf71bb: Hide "Change Password" menu item for non-credential users

  The change password feature now only appears in the user menu for users who have
  a credential-based account (email/password). Users who authenticated exclusively
  via OAuth providers (e.g., GitHub, Google) will no longer see this option since
  they don't have a password to change.

## 0.2.0

### Minor Changes

- e26c08e: Add password change functionality for credential-authenticated users

  - Add `changePassword` route to auth-common
  - Create `ChangePasswordPage.tsx` component with password validation, current password verification, and session revocation option
  - Add "Change Password" menu item in User Menu
  - Reuses patterns from existing password reset flow for consistency

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-common@0.2.0

## 0.1.1

### Patch Changes

- 0f8cc7d: Add runtime configuration API for Docker deployments

  - Backend: Add `/api/config` endpoint serving `BASE_URL` at runtime
  - Backend: Update CORS to use `BASE_URL` and auto-allow Vite dev server
  - Backend: `INTERNAL_URL` now defaults to `localhost:3000` (no BASE_URL fallback)
  - Frontend API: Add `RuntimeConfigProvider` context for runtime config
  - Frontend: Use `RuntimeConfigProvider` from `frontend-api`
  - Auth Frontend: Add `useAuthClient()` hook using runtime config

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/ui@0.1.1

## 0.1.0

### Minor Changes

- 32f2535: Refactor application role assignment

  - Removed role selection from the application creation dialog
  - New applications now automatically receive the "Applications" role
  - Roles are now manageable inline in the Applications table (similar to user role management)
  - Added informational alert in create dialog explaining default role behavior

- b354ab3: # Strategy Instructions Support & Telegram Notification Plugin

  ## Strategy Instructions Interface

  Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

  - **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
  - **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

  ### Updated Components

  - `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
  - `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
  - `UserChannelCard` renders `userInstructions` when users need to connect

  ## New Telegram Notification Plugin

  Added `@checkstack/notification-telegram-backend` plugin for sending notifications via Telegram:

  - Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
  - Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
  - Includes comprehensive admin instructions for bot setup via @BotFather
  - Includes user instructions for account linking

  ### Configuration

  Admins need to configure a Telegram Bot Token obtained from @BotFather.

  ### User Linking

  The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [32f2535]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/auth-common@0.1.0
  - @checkstack/frontend-api@0.0.2
