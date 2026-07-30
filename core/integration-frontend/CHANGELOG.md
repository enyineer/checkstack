# @checkstack/integration-frontend

## 0.9.0

### Minor Changes

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
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/tips-frontend@0.5.6
  - @checkstack/integration-common@0.9.11
  - @checkstack/signal-frontend@0.3.8

## 0.8.9

### Patch Changes

- be74b01: Converge the status-tone exceptions that turned out to be drift

  Reviewing the four "deliberate exceptions" left by the tone de-duplication, three
  were drift wearing a comment, and one was genuine.

  - **`neutralToneStyle` is now exported from `@checkstack/ui`.** Three plugins had
    each written out the same three muted strings by hand. It sits beside
    `pillToneStyles` rather than in it, because the absence of a tone is not a
    tone; `StatusPill`'s `tone="neutral"` renders it.
  - **Dashboard signals use the status ladder's blue.** In one record `error` and
    `warn` came from the ladder while `info` reached for the general-purpose
    `--info` accent - so the same "Watch" signal rendered in two different blues
    depending on whether you looked at the problem card, its chip, or the fleet
    header bar. All three now use `--status-info`, which is also the darker L45
    blue chosen precisely so its text stays readable on a light card.
  - **The system incident panel borders at `/20`** like every other tinted border,
    removing the last class-string divergence in the tone system along with the
    one-off map that documented it.
  - **The queue's neutral pills use the shared neutral.** Its KPI tile and its job
    state pill each carried a slightly softer private variant, so "carries no
    signal" looked like two different things on one page.

  The one genuine exception kept: `--info` and `--status-info` remain separate
  tokens. The first is the general semantic palette (alongside `--success` /
  `--warning`), the second the colourblind-safe status ladder with its own
  contrast rationale. Non-status surfaces - the `Alert` component, plugin-type
  chips - keep the general accent.

- be74b01: Source every status tone from the one shared table

  Nineteen plugin modules each re-declared the tone-to-class table verbatim
  (`pill: "bg-status-ok/10 text-status-ok"`, `dot: "bg-status-ok"`, ...), some
  reproducing every field of the shared one. They now take those classes from
  `pillToneStyles` in `@checkstack/ui` while keeping their own domain mapping -
  which value means which tone - since that is real domain knowledge and is unit
  tested. A repo-wide search for a hand-written triad row now returns only the
  shared table.

  Several hand-rolled pills went with them, onto the shared `StatusPill`: the
  automation run pill, the satellite status badge, the notification channel pill,
  the SLO objective pill and both AI tool-card pills.

  Four rows are deliberately still local, each with a comment saying why, because
  they are NOT the shared tone despite looking like it:

  - The dashboard's `info` uses the `--info` token, a different hue from
    `--status-info` (light: `217 91% 60%` vs `214 90% 45%`).
  - Integrations' and notifications' `unknown`/`neutral` use the muted treatment -
    the ABSENCE of a tone - not the shared grey.
  - The queue's "processing" uses opacity-softened muted classes that match
    neither the shared table nor the pill's neutral.

  One genuine class divergence was found and NOT normalised: the system incident
  panel draws its borders at `/30` where the shared table uses `/20`. It is now a
  single documented map instead of a full private table.

  Pills whose geometry has no shared equivalent (the dependency canvas node with
  its animated halo, the incident panel's compact chips, the dashboard's
  non-triad signal tone) keep their markup and now only share the classes.

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
  - @checkstack/ui@1.30.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/tips-frontend@0.5.5

## 0.8.8

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/ui@1.29.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/tips-frontend@0.5.4
  - @checkstack/integration-common@0.9.10
  - @checkstack/signal-frontend@0.3.7

## 0.8.7

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/tips-frontend@0.5.3
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/integration-common@0.9.9
  - @checkstack/signal-frontend@0.3.6

## 0.8.6

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/tips-frontend@0.5.2

## 0.8.5

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/tips-frontend@0.5.1
  - @checkstack/common@0.22.0
  - @checkstack/integration-common@0.9.9
  - @checkstack/signal-frontend@0.3.6

## 0.8.4

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/tips-frontend@0.5.0

## 0.8.3

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2
  - @checkstack/tips-frontend@0.4.12

## 0.8.2

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ui@1.26.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/tips-frontend@0.4.11

## 0.8.1

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/ui@1.25.1
  - @checkstack/integration-common@0.9.8
  - @checkstack/tips-frontend@0.4.10
  - @checkstack/signal-frontend@0.3.5

## 0.8.0

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

- Updated dependencies [b218e3e]
  - @checkstack/ui@1.25.0
  - @checkstack/tips-frontend@0.4.9

## 0.7.8

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/tips-frontend@0.4.8
  - @checkstack/frontend-api@0.13.2
  - @checkstack/integration-common@0.9.7
  - @checkstack/signal-frontend@0.3.4

## 0.7.7

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/frontend-api@0.13.1
  - @checkstack/integration-common@0.9.6
  - @checkstack/tips-frontend@0.4.7
  - @checkstack/signal-frontend@0.3.3

## 0.7.6

### Patch Changes

- @checkstack/tips-frontend@0.4.6

## 0.7.5

### Patch Changes

- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/tips-frontend@0.4.5
  - @checkstack/integration-common@0.9.5
  - @checkstack/signal-frontend@0.3.2

## 0.7.4

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/tips-frontend@0.4.4

## 0.7.3

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/frontend-api@0.12.1
  - @checkstack/integration-common@0.9.4
  - @checkstack/tips-frontend@0.4.3
  - @checkstack/signal-frontend@0.3.1

## 0.7.2

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/ui@1.19.0
  - @checkstack/signal-frontend@0.3.0
  - @checkstack/integration-common@0.9.3
  - @checkstack/tips-frontend@0.4.2
  - @checkstack/common@0.17.0

## 0.7.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/tips-frontend@0.4.1

## 0.7.0

### Minor Changes

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

- 8cad340: Add a stacked card layout to the provider documentation HTTP headers table on
  narrow viewports. Below the `sm` breakpoint the Header/Description table renders
  as a `MobileCardList` instead of relying on horizontal scroll; the desktop table
  is unchanged.
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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ui@1.17.0
  - @checkstack/tips-frontend@0.4.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/integration-common@0.9.2
  - @checkstack/signal-frontend@0.2.6

## 0.6.10

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/tips-frontend@0.3.9
  - @checkstack/ui@1.16.2

## 0.6.9

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
  - @checkstack/common@0.16.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/tips-frontend@0.3.8
  - @checkstack/integration-common@0.9.1
  - @checkstack/signal-frontend@0.2.5

## 0.6.8

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/tips-frontend@0.3.7

## 0.6.7

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/integration-common@0.9.0
  - @checkstack/tips-frontend@0.3.6

## 0.6.6

### Patch Changes

- Updated dependencies [c4bebbb]
  - @checkstack/integration-common@0.8.0

## 0.6.5

### Patch Changes

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/integration-common@0.7.3
  - @checkstack/tips-frontend@0.3.5
  - @checkstack/signal-frontend@0.2.4

## 0.6.4

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
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.4
  - @checkstack/common@0.14.1
  - @checkstack/integration-common@0.7.2

## 0.6.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/tips-frontend@0.3.3
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/signal-frontend@0.2.2

## 0.6.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/tips-frontend@0.3.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.6.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/frontend-api@0.7.1
  - @checkstack/integration-common@0.7.1
  - @checkstack/tips-frontend@0.3.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.6.0

### Minor Changes

- 9dcc848: Surface integration connection validation errors inline, and fix blank secrets clearing stored credentials on edit.

  `@checkstack/ui` `DynamicForm` gains opt-in, backward-compatible props plus pure DOM-free helpers:

  - `showInlineErrors` (default `false`): renders a concise per-field error under each touched required field; the `onValidChange` validity boolean derives from the same per-field error map.
  - `fieldErrors`: an externally-supplied `{ [fieldPath]: message }` map (dot-joined for nested fields) for surfacing SERVER validation inline; nested paths flag their parent.
  - `keepExistingSecretFields`: in EDIT mode, lists `x-secret` keys already stored server-side - a blank input means "keep existing" and is treated as VALID (CREATE mode omits it). New exported helpers: `deriveClientFieldErrors`, `deriveServerFieldErrors`, `parseServerValidationData`, `omitKeepExistingSecrets`, `listSecretFieldKeys`. `DynamicForm` also no longer shows a required (`*`) marker on the child fields of an OPTIONAL nested object while that object is empty (e.g. the OpenAI-compatible `spendCap`); required nested objects are unchanged.

  `@checkstack/integration-backend`: connection-config validation failures attach the structured zod issues to `ORPCError.data` under a `CONFIG_VALIDATION` discriminator; the human-readable message is unchanged.

  `@checkstack/integration-frontend` `ProviderConnectionsPage`: validation failures appear inline on the offending fields (the toast remains a fallback); Create/Save stays disabled while invalid; on edit a blank `x-secret` field is treated as "keep existing" (no required error, omitted from the update so the stored secret is not cleared).

  BREAKING CHANGES: none. The new `DynamicForm` props are optional and default to previous behavior.

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

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

  This is a beta minor.

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
  - @checkstack/ui@1.13.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/integration-common@0.7.0
  - @checkstack/signal-frontend@0.2.0

## 0.5.1

### Patch Changes

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
  - @checkstack/tips-frontend@0.2.7

## 0.5.0

### Minor Changes

- e2d6f25: feat(automation): connection picker for integration actions + restore Integrations menu

  Connection-backed automation actions (Jira, Teams, Webex) now render a
  working connection picker plus cascading provider dropdowns in the
  visual editor, and the Integrations entry is back in the user menu.

  **Contract.** `ActionDefinition` gained an optional
  `connectionProviderId` (and it is surfaced on `ActionInfoSchema` and
  mapped in the `listActions` router). It carries the integration
  provider's fully-qualified id, derived from the provider plugin's own
  `pluginMetadata.pluginId` (never a hardcoded string), so the editor
  knows which provider backs an action's dropdowns and it matches the
  `qualifiedId` the integration provider registry assigns.

  **Providers.** Jira, Teams and Webex each export
  `*_PROVIDER_LOCAL_ID` / `*_PROVIDER_QUALIFIED_ID`, register their
  provider with the local id, and add a `CONNECTION_OPTIONS`
  (`"connectionOptions"`) resolver name. Their `post_message` /
  issue actions set `connectionProviderId` and expose `connectionId`
  as an `x-options-resolver` dropdown instead of a hidden field.

  **Frontend bridge.** A new `useConnectionOptionResolvers` hook
  (`@checkstack/automation-frontend`, which now depends on
  `@checkstack/integration-common`) turns an action's
  `x-options-resolver` schema fields into live data: the
  `connectionOptions` resolver lists the provider's connections via
  `listConnections`, and every other resolver name is forwarded to
  `getConnectionOptions` for the selected `connectionId`, passing the
  live form values as `context` for dependent fields. `ProviderActionBody`
  now passes this map to `DynamicForm` (it was previously missing
  entirely, so connection-backed actions had no working dropdowns).

  **frontend-api.** `usePluginClient` procedures now also expose a typed
  imperative `.call(input)` alongside `.useQuery` / `.useMutation`, for
  async callbacks that cannot host a hook (such as a `DynamicForm`
  options resolver). Additive, non-breaking.

  **Integrations menu.** Re-added `IntegrationMenuItem` and a new
  `IntegrationsLandingPage`, wired into `integration-frontend` as a list
  route and a `UserMenuItemsSlot` entry under the "Configuration" group.

  **Action card polish.** The action editor's secondary metadata (id,
  description, failure behaviour) is now grouped into one quiet settings
  panel with consistent small uppercase "eyebrow" labels, so the action's
  own configuration stays the focal point. The raw failure checkbox was
  replaced with the standard `Checkbox` control, and the provider action
  picker / configuration sections gained consistent section headers and a
  divider. The per-step "type" dropdown was removed: an action's kind is
  fixed at creation, so changing it now means adding a new step and
  deleting the old one (avoids the surprising full-config reset that
  switching kinds used to trigger).

  **Add-step picker.** Adding a step now opens a Home-Assistant-style
  dialog where the operator decides the step type up front: an "Actions"
  tab lists the registered provider actions grouped by category
  (searchable; picking one presets the step's `action`), and a "Blocks"
  tab lists the structural building blocks (choose / parallel / repeat /
  etc.). Because the concrete action is chosen here, the in-card action
  switcher was removed - a step's action is fixed once created. Composite
  blocks now start with an empty child list (filled via the nested
  add-step picker) instead of seeding an unconfigurable empty action.

- 41c77f4: feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

  **BREAKING CHANGES** (platform is in BETA — no major bump):

  - `IntegrationProvider` no longer carries `config` (subscription
    config) or `deliver`. The interface now models a connection provider
    only: connection schema + `getConnectionOptions` + `testConnection`.
  - The legacy subscription / delivery-log / event endpoints
    (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
    `listEventTypes`, …) are removed from `integrationContract`.
  - `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
    `integrationEventExtensionPoint` are deleted. Plugins that
    previously called `integrationEvents.registerEvent(...)` now
    register their hooks as automation triggers via
    `automationTriggerExtensionPoint.registerTrigger(...)`.
  - Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
    the integration plugin's only remaining UI is connection
    management. Subscription management lives under `/automation/...`.
  - `webhook_subscriptions` and `delivery_logs` tables stay in the
    database for one release as a safety net (no code reads or writes
    them), and will be dropped in a follow-up migration.

  **New**:

  - `jira.create_issue`, `teams.post_message`, `webex.post_message`,
    `webhook.send`, `integration-script.run_shell`, and
    `integration-script.run_script` actions registered against the
    Automation Platform with matching `*.message`, `*.delivery`,
    `shell.result`, and `script.result` artifact types. The script
    plugin exposes **two** actions — `run_shell` runs bash via the
    shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
    runs an ESM module in a Bun subprocess via `EsmScriptRunner`
    (Monaco `typescript` editor + `defineIntegration` helper) — to
    preserve the legacy provider split. `jira.create_issue` keeps the
    dynamic field-mapping dropdown (driven by
    `JIRA_RESOLVERS.FIELD_OPTIONS`).
  - One-time data migration runs on boot in
    `automation-backend.afterPluginsReady`. It reads
    `webhook_subscriptions` via a new service RPC
    `IntegrationApi.listLegacySubscriptions`, translates each row into
    a single-trigger / single-action automation (marked with
    `managed_by = "migrated-subscription:<id>"`), and is idempotent
    across restarts.
  - Failed translations are recorded in a new
    `automation_migration_failures` table and surfaced via
    `AutomationApi.listMigrationFailures` /
    `acknowledgeMigrationFailure` so admins can review and re-create
    failed entries by hand.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
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
  - @checkstack/integration-common@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/signal-frontend@0.1.5

## 0.4.5

### Patch Changes

- f23f3c9: Retrofit the highest-traffic configuration list tables
  (`HealthCheckList`, `SloConfigPage`, and the integration
  `DeliveryLogsPage`) onto the `ResponsiveTable` + `MobileCardList`
  primitives from `@checkstack/ui`. On `sm` and up each page still
  renders the unchanged 5- to 7-column table; below that breakpoint a
  sibling stacked-card layout surfaces the same data with the resource
  name + status badge at the top, secondary columns in a muted line, and
  the existing action buttons in a right-aligned footer. The
  `HealthCheckListSkeleton` placeholder mirrors both branches so the page
  no longer jumps when data resolves. No business logic, column order,
  or query inputs changed.
- f23f3c9: Sweep every paginated `*-common` contract onto the canonical
  `PaginationInput` / `PaginatedResult` from `@checkstack/common` and
  remove the now-unused legacy exports.

  **BREAKING CHANGE** - `@checkstack/common` drops the deprecated
  `PaginationInputSchema`, `paginatedOutput`, and `PaginatedResponse`
  symbols. Callers must consume `PaginationInput` (input) and
  `PaginatedResult(itemSchema)` (output) instead. The canonical input is
  `{ limit (1-100, default 20), offset (>= 0, default 0) }`; the
  canonical output envelope is
  `{ items, total, limit, offset }`.

  **BREAKING CHANGE** - `@checkstack/notification-common` migrates
  `getNotifications` off the legacy `PaginationInputSchema`
  (`{ limit, offset, unreadOnly }` with output `{ notifications, total }`)
  onto `ListNotificationsInputSchema =
PaginationInput.extend({ unreadOnly })` and
  `PaginatedResult(NotificationSchema)`. The output key changes from
  `notifications` to `items`, and `limit` / `offset` are now echoed on
  the response. The `PaginationInput` type alias previously exported
  from `notification-common` is removed - use `ListNotificationsInput`
  or the canonical `PaginationInput` from `@checkstack/common`.

  **BREAKING CHANGE** - `@checkstack/integration-common` migrates
  `listSubscriptions` (inline `{ page, pageSize, ... }` -> output
  `{ subscriptions, total }`) and `getDeliveryLogs` (via
  `DeliveryLogQueryInputSchema` `{ subscriptionId?, eventType?, status?,
page, pageSize }` -> output `{ logs, total }`) onto the canonical
  `PaginationInput.extend({...})` input and
  `PaginatedResult(itemSchema)` output. External callers must switch
  from `{ page, pageSize }` to `{ limit, offset }` and read response
  items from `data.items` (no more `data.subscriptions` / `data.logs`).

  The matching `*-backend` handlers were updated to consume the new
  input shape (`offset` arithmetic in lieu of `(page - 1) * pageSize`)
  and to echo `limit` / `offset` on the response. The `*-frontend` call
  sites in `NotificationsPage`, `NotificationBell`, `IntegrationsPage`,
  and `DeliveryLogsPage` were updated to send the new input shape and
  read `data.items`.

- f23f3c9: Gate decorative motion and blur effects behind
  `usePerformance().isLowPower` on a focused set of high-traffic plugin
  pages (Dashboard, Dependency map, System node, Notification bell,
  Announcement banner / cards, Anomaly field overrides editor, SLO
  attribution chart, Catalog droppable group). Hover scales, backdrop
  blurs, `animate-pulse`/`animate-ping` accents, and entry transitions
  now drop to static states on low-power devices; functional UX
  transitions (Drawer/Dialog open-close, colour transitions) are left
  alone.

  Standardise the post-mutation error-toast voice on plugin pages by
  migrating multi-clause `toast.error(extractErrorMessage(error, "Failed
to X"))` call sites onto the `toastError(toast, "Failed to X", error)`
  helper from `@checkstack/ui`. The helper applies the canonical
  `"action: message"` prefix and 100-character truncation in one place,
  and the now-orphaned `extractErrorMessage` imports are dropped from
  the affected files. No business logic or component APIs changed.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/integration-common@0.5.0
  - @checkstack/ui@1.10.0
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.4.4

### Patch Changes

- a06b899: Render integration provider `setupGuide` content as markdown instead of plain text. The `ProviderDocumentation` panel was wrapping `setupGuide` in a `whitespace-pre-wrap` div, so markdown syntax (headings, links, lists, bold) shipped by providers (e.g. Jira) showed up raw in the subscription dialog. Now uses `MarkdownBlock` from `@checkstack/ui` so the same formatting providers author renders correctly.
- a06b899: Overhaul shell + inline-script health checks with real shell semantics, real ESM execution, and upstream Node/Bun IntelliSense.

  **BREAKING CHANGES**

  - **Shell collector** — the `Execute Script` collector now takes a single `script` string instead of `{ command, args }`. Existing configs are auto-migrated to v2: `command` + `args` are joined with POSIX single-quote escaping into the new `script` field, so behaviour is preserved. Custom UIs that hard-coded `command`/`args` field names need to switch to `script`.
  - **Inline collector** — scripts are now executed as real ES modules in a Bun subprocess (was: `new Function()` inside a Web Worker). The legacy `return X;` style still works (it's auto-wrapped in an async IIFE), but mixed scripts that `import` _and_ `return` at the top level need to use `export default` for their result.

  **FIXES**

  - Shell scripts containing pipes, redirects, `awk`, command substitution, conditionals etc. no longer fail with `ENOENT`. The collector now runs through `sh -c <script>` instead of passing the full expression as `Bun.spawn`'s argv[0]. This was the original `awk … failed with ENOENT` regression.
  - Inline scripts can now `import { loadavg } from "node:os"` (and any other `node:*` or `bun` import). They could not before, because the executor wrapped user code inside `new Function(...)` and ran it in a Web Worker that had no Node module access; the wrapper also made top-level `import` syntactically invalid (`Unexpected token '{'`).
  - Healthcheck editor fields no longer reset while you're editing. The page was re-running its form-state init `useEffect` on every refetch of the configuration query — and that query is invalidated on every realtime `HEALTH_CHECK_RUN_COMPLETED` signal across the platform, so in-progress edits got wiped within seconds. Replaced the naive `useEffect([existingConfig])` with a new `useInitOnceForKey` hook from `@checkstack/ui` that initialises the form only on first load per healthcheck id and ignores background refetches. The hook's decision logic is a pure function (`shouldInitForKey`) and is unit-tested in `useInitOnceForKey.test.ts`.
  - Switching between healthcheck collectors no longer mis-applies the previous collector's tokenizer / language service to the new editor. `MultiTypeEditorField` was reusing the same React instance across collector switches (same `key="script"` in both `DynamicForm` renders) and `selectedType` was initialised from `useState` only once on first mount. After a shell→typescript switch the new collector's TS content rendered through the shell branch (no TS highlighting, no IntelliSense); the reverse direction tokenised shell content through TS and surfaced nonsense errors like `2304 "Cannot find name 'and'"` on shell comments. Now a `useEffect` re-derives `selectedType` whenever `editorTypes` changes to a set that doesn't contain the current selection.
  - Monaco workers are now bundled locally via Vite `?worker` imports and wired up through `MonacoEnvironment.getWorker` in a new `monacoWorkers.ts` module. The default `@monaco-editor/loader` CDN path silently failed CORS on worker scripts in some browsers, leaving Monaco's TS service with only the generic `editorWorkerService` — which is enough for tokenizer-only languages like shell but breaks TypeScript's semantic features entirely. Same module configures the TS service singleton (compiler options, eager-model-sync, diagnostics-options-ignore-1108) at module load instead of inside per-editor `onMount`, so the service starts pre-configured regardless of which language opens first. Migrated from the deprecated `monaco.languages.typescript.*` path to `monaco.typescript.*` (the old path is marked `{ deprecated: true }` in monaco-editor 0.55).
  - `defineIntegration` / `defineHealthCheck` callback parameters are now typed against the schema. Previously the virtual module declared them as `(ctx: unknown) => …`, so writing `defineIntegration(async (context) => { console.log(context.event.eventId) })` produced `'context' is of type 'unknown'. (18046)`. The result type and the shared `IntegrationScriptContext` / `HealthCheckScriptContext` interfaces are now generated together in `scriptContext.ts`, so both the function-arg form and the ambient `declare const context` reference the same schema-typed shape.
  - The shell starter template no longer uses Linux-only `/proc/loadavg` (which fails on macOS satellites with `awk: can't open file /proc/loadavg`). It now reads the 1-minute load average via `uptime` and parses both the Linux (`load average: 0.00, 0.01, 0.05`) and macOS (`load averages: 0.45 0.55 0.65`) output formats with a portable `sed`/`awk`/`tr` pipeline.
  - Starter-template seeding is now self-healing. `DynamicForm`'s schema-defaults `useEffect` fires AFTER child seed effects in React's child-before-parent order, so the previous one-shot seed got clobbered back to `""` by the defaults call on first mount and never re-fired. Replaced the `[]`-deps effect with a two-effect pattern: an observer that latches `hasSeededRef = true` the first time `value` is observed non-empty, and a seed effect that keeps re-installing the starter while the latch is open. Once the seed sticks the latch closes; subsequent edits and realtime refetches don't re-trigger.

  **NEW**

  - The Monaco editor for inline scripts now mounts the real upstream `@types/node` + `bun-types` declarations as a virtual filesystem (lazy-loaded as its own JS chunk), so IntelliSense covers the full Node/Bun stdlib, the `Bun` global, `process.env`, `Buffer`, etc. DOM types are deliberately excluded so suggestions stay focused on the backend surface. `context.config` is typed from the collector's own JSON Schema.
  - New `healthcheckScriptContext` / `integrationScriptContext` helpers (exported from `@checkstack/ui`) build a complete editor bundle in one call: TS declarations (`context.config` / `context.event.payload` + the virtual `@checkstack/healthcheck` / `@checkstack/integration` result-type modules), starter templates per language, and the shell env-var list (with platform-injected `EVENT_ID` / `DELIVERY_ID` / `PAYLOAD_*` for integrations). Both call sites — `CollectorSection.tsx` and `CreateSubscriptionDialog.tsx` — were rewired to use them, fixing a long-standing wiring gap where IntelliSense for injected values silently never reached the editor.
  - Inline scripts can now `import { defineHealthCheck } from "@checkstack/healthcheck"` (or `defineIntegration` for integrations) for a typed return-shape assertion. The editor catches `{ success: "yes" }` as a type error against `HealthCheckScriptResult`. The runtime is just an identity function — the collector rewrites the import to a sibling helper file in the temp dir before executing.
  - Shell editors now autocomplete env-vars after `$` and `${`. The completion list is supplied by `healthcheckScriptContext` (safe-vars whitelist) and `integrationScriptContext` (whitelist + `EVENT_ID` etc. + `PAYLOAD_*` flattened from the event's payload schema). The matcher is pure and unit-tested in `shellEnvVarMatcher.test.ts` so regex regressions are caught locally.
  - Empty editor fields are now seeded with a working starter template per language (inline TS uses `defineHealthCheck`, inline shell does the `awk` load-average check, integration TS shows `defineIntegration` with `context.event`, integration shell lists the `$EVENT_ID` / `$PAYLOAD_*` env vars). Users see a runnable example instead of a blank canvas; once they edit, we leave their content alone.
  - Hardened concurrency + cleanup model documented and tested: each invocation gets its own `mkdtemp` directory + UUID result marker; the `finally` block clears the timeout handle, kills any surviving subprocess (idempotent), and removes the temp directory on success, throw, _and_ timeout. New `concurrency.test.ts` proves 20 parallel inline scripts don't cross wires and that the temp-dir count returns to baseline after throws and timeouts.

  **TESTING**

  Tight unit tests added so changes to the editor surface don't need smoke testing:

  - `scriptContext.test.ts` — 18 tests covering the generated type declarations (including explicit regression guards for `defineIntegration` / `defineHealthCheck` callback params being typed against the shared context interface rather than `unknown`), starter templates (including a guard that the shell starter doesn't depend on Linux-only `/proc/loadavg`), shell env-vars for both healthcheck + integration flavours, plus the schema-flattening utility.
  - `shellEnvVarMatcher.test.ts` — 12 tests covering the bare `$` / braced `${` / partial-name / case-insensitive matching logic that powers Monaco's shell completion.
  - `inline-script-normaliser.test.ts` — 13 tests covering the legacy `return X;` → IIFE wrap path, the ESM-passthrough path, and the `@checkstack/healthcheck` import rewriter.
  - `inline-script-collector.test.ts` — 18 tests including ones that actually execute a script importing `defineHealthCheck` (named-import form) AND using the global `defineHealthCheck` (no import) to prove both code paths resolve at runtime.
  - `concurrency.test.ts` — 4 tests proving 20 parallel runs don't collide and that the temp-dir count returns to baseline after success, throw, and timeout.
  - `useInitOnceForKey.test.ts` — 10 tests proving the healthcheck-editor form state isn't reset when react-query refetches in the background (the original "fields reset while I'm typing" regression).
  - `starterTemplateSelector.test.ts` — 7 tests for the pure decision function powering empty-field seeding.
  - `security.test.ts` — added an integration test that actually executes the portable load-average pipeline through `Bun.spawn` on the current OS, catching `/proc/loadavg`-style regressions at CI time on macOS runners.

  **SECURITY**

  - Same env-var whitelist as before (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`). Backend secrets in the satellite process's environment remain invisible to user scripts.

  See `docs/src/content/docs/backend/script-healthchecks.md` for the full user-facing guide.

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/tips-frontend@0.2.4

## 0.4.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/tips-frontend@0.2.3

## 0.4.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/tips-frontend@0.2.2

## 0.4.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/integration-common@0.4.0
  - @checkstack/frontend-api@0.5.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.4.0

### Minor Changes

- 3547670: Wire the new tips infrastructure across the frontends:

  **Empty-state coaching.** Replace generic "no items" copy with onboarding
  guidance — short description, three numbered steps and a primary CTA — on
  every EmptyState that has a meaningful next action. Affects: catalog
  (systems + groups), dashboard, health-check page, integrations (subscriptions

  - provider connections), GitOps providers + secrets, GitOps provenance,
    SLO config + overview, maintenance config, satellites, plugin manager,
    incident config, announcements. Read-only EmptyStates (incident history,
    maintenance history, plugin events) get clearer descriptions explaining
    what would populate them.

  **First-run anchored tips.** Add `<Tip>` popovers to the most important
  "Create" affordances so first-time users see a one-line explanation of
  what they're about to make and why it matters: catalog “Add System” /
  “Add Group”, healthcheck “Create Check”, integrations “New Subscription”,
  GitOps “Add Provider”, SLO “Create SLO”, maintenance “Create Maintenance”,
  satellite “Create Satellite”, plugin-manager “Install plugin”, incident
  “Report Incident”, announcement “New Announcement”. Each tip is dismissed
  per user (server-backed when signed in, localStorage otherwise) and
  namespaced through `qualifyTipId(plugin, …)` so it cannot escape the
  plugin's own namespace.

  **Welcome banner on the dashboard.** A `<TipBanner>` at the top of the
  dashboard introduces Checkstack's main flow ("add a system, then a health
  check") with a one-click jump into the catalog.

### Patch Changes

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

- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/integration-common@0.3.2
  - @checkstack/signal-frontend@0.1.2

## 0.3.3

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/common@0.8.0
  - @checkstack/integration-common@0.3.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/frontend-api@0.4.2

## 0.3.2

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/frontend-api@0.4.1
  - @checkstack/ui@1.7.0

## 0.3.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.4.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/ui@1.6.1

## 0.3.0

### Minor Changes

- 8d1ef12: ## Anomaly Detection & UI Improvements

  ### Anomaly Detection Enhancements (Phase 2)

  - **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
  - **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
  - **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
  - **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
  - **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
  - **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

  ### Notification Identifiers

  - **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
  - **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

  ### UI Experience

  - **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
  - **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
  - **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/frontend-api@0.3.11
  - @checkstack/integration-common@0.2.9
  - @checkstack/signal-frontend@0.0.16

## 0.2.30

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1

## 0.2.29

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0

## 0.2.28

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0

## 0.2.27

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6

## 0.2.26

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5

## 0.2.25

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4

## 0.2.24

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3

## 0.2.23

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2

## 0.2.22

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1

## 0.2.21

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0

## 0.2.20

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
  - @checkstack/integration-common@0.2.8
  - @checkstack/signal-frontend@0.0.15

## 0.2.19

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0

## 0.2.18

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5

## 0.2.17

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/ui@1.1.4

## 0.2.16

### Patch Changes

- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/integration-common@0.2.7
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3

## 0.2.15

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/ui@1.1.2

## 0.2.14

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/frontend-api@0.3.6
  - @checkstack/integration-common@0.2.6
  - @checkstack/signal-frontend@0.0.13

## 0.2.13

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0

## 0.2.12

### Patch Changes

- f676e11: Improve subscription creation UX by requiring event selection before showing provider configuration

  The provider configuration section now waits for an event to be selected before rendering, preventing template validation errors when no payload properties are available yet.

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/frontend-api@0.3.5
  - @checkstack/integration-common@0.2.5
  - @checkstack/signal-frontend@0.0.12

## 0.2.11

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/ui@0.5.3

## 0.2.10

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/integration-common@0.2.4
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.2.9

### Patch Changes

- Updated dependencies [090143b]
  - @checkstack/ui@0.5.1

## 0.2.8

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

## 0.2.7

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/frontend-api@0.3.3
  - @checkstack/integration-common@0.2.3
  - @checkstack/signal-frontend@0.0.10

## 0.2.6

### Patch Changes

- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0

## 0.2.5

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/frontend-api@0.3.2
  - @checkstack/integration-common@0.2.2
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.2.4

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/frontend-api@0.3.1
  - @checkstack/integration-common@0.2.1
  - @checkstack/signal-frontend@0.0.8

## 0.2.3

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/ui@0.2.4

## 0.2.2

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3

## 0.2.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/ui@0.2.2

## 0.2.0

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
  - @checkstack/integration-common@0.2.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

## 0.1.0

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

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

## 0.0.5

### Patch Changes

- 97c5a6b: Fix Radix UI accessibility warning in dialog components by adding visually hidden DialogDescription components
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/integration-common@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/integration-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/integration-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.0

### Minor Changes

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

### Patch Changes

- 4b463ff: Fixed webhook subscriptions list to show fully qualified event names and aligned the action button to the right
- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/integration-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
