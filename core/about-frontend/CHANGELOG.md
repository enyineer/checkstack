# @checkstack/about-frontend

## 0.5.8

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
  - @checkstack/about-common@0.3.8

## 0.5.7

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/about-common@0.3.7
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0

## 0.5.6

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1

## 0.5.5

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/about-common@0.3.7
  - @checkstack/common@0.22.0

## 0.5.4

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
  - @checkstack/about-common@0.3.6

## 0.5.3

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2
  - @checkstack/about-common@0.3.5

## 0.5.2

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ui@1.26.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/about-common@0.3.4

## 0.5.1

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/ui@1.25.1
  - @checkstack/about-common@0.3.3

## 0.5.0

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

## 0.4.2

### Patch Changes

- a83bcc2: Move the assistant memory UI onto a system's About sidebar.

  The **Assistant Memories** button now lives in the About card of a system's
  detail page (catalog `SystemMetaSlot`), where it belongs, instead of on the
  platform "About Checkstack" page. Clicking it opens a Sheet listing the memories
  the assistant has saved about that specific system. As before, the button hides
  entirely - and fires no `listMemories` request - for users without
  `ai.memory.read`; delete and always-apply remain server-enforced
  (`ai.memory.manage`).

  The platform `AboutSectionsSlot` (`plugin.about.sections`) remains available as
  a general extension point for plugins to contribute self-gating section cards to
  the About page; it just no longer hosts the memory button, and its About-page
  comment no longer references the memory feature.

  The `@checkstack/ai-backend` bundled docs index is regenerated to reflect the
  updated `ai/memory.md` and `frontend/extension-points.md` content.

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/about-common@0.3.2
  - @checkstack/frontend-api@0.13.2

## 0.4.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/about-common@0.3.1
  - @checkstack/frontend-api@0.13.1

## 0.4.0

### Minor Changes

- 3047ed2: Move the assistant's saved memories into a permission-gated Sheet opened from the
  About page, and drop the oversized always-open memory card.

  - `@checkstack/about-common` now exports a new `AboutSectionsSlot` render slot
    (with an optional `priority` metadata, like `DashboardSlot`). Plugins
    contribute self-contained, self-gating section cards to the platform About
    page without the general About page depending on any specific plugin.
  - `@checkstack/about-frontend` renders `AboutSectionsSlot` on the "About
    Checkstack" page.
  - `@checkstack/ai-frontend` contributes a compact "Assistant memory" section with
    a **Memories** button that opens a Sheet listing every memory the caller can
    see (their preferences plus `system` memories for systems they can read). The
    section is hidden entirely, and fires no `listMemories` request, for users
    without `ai.memory.read`.

  BREAKING CHANGE (behavior): the per-system "Assistant memory" card previously
  shown on a catalog system's detail page (the `SystemDetailsSlot` contribution) is
  removed. Memories are still viewable and prunable from the About-page Sheet and
  the existing "Assistant memory" workspace page; in-context per-system viewing on
  the system detail page is no longer available. This also supersedes the earlier
  patch that gated that card on `ai.memory.read` (the card no longer exists).

### Patch Changes

- Updated dependencies [3047ed2]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/about-common@0.3.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0

## 0.3.13

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0

## 0.3.12

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/about-common@0.2.15
  - @checkstack/frontend-api@0.12.1

## 0.3.11

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
  - @checkstack/about-common@0.2.14
  - @checkstack/common@0.17.0

## 0.3.10

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0

## 0.3.9

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
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/about-common@0.2.13

## 0.3.8

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/ui@1.16.2

## 0.3.7

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
  - @checkstack/common@0.16.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/about-common@0.2.12

## 0.3.6

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0

## 0.3.5

### Patch Changes

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/about-common@0.2.11

## 0.3.4

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
  - @checkstack/about-common@0.2.10
  - @checkstack/common@0.14.1

## 0.3.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/about-common@0.2.10
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2

## 0.3.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/about-common@0.2.10
  - @checkstack/frontend-api@0.7.2
  - @checkstack/ui@1.13.2

## 0.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/about-common@0.2.9
  - @checkstack/frontend-api@0.7.1
  - @checkstack/ui@1.13.1

## 0.3.0

### Minor Changes

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
  - @checkstack/about-common@0.2.8

## 0.2.23

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

## 0.2.22

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
  - @checkstack/about-common@0.2.7

## 0.2.21

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/ui@1.10.0
  - @checkstack/about-common@0.2.6

## 0.2.20

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0

## 0.2.19

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3

## 0.2.18

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2

## 0.2.17

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/about-common@0.2.5
  - @checkstack/frontend-api@0.5.1
  - @checkstack/ui@1.8.1

## 0.2.16

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
  - @checkstack/about-common@0.2.4

## 0.2.15

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
  (including private GitHub Enterprise instances), or tarball uploads at
  runtime, with multi-package bundles, dependency-derived compatibility checks,
  multi-instance coordination via a Postgres artifact store, and
  single-coordinator destructive cleanup.

  Highlights:

  - New `PluginSource` discriminated union and `PluginInstaller` /
    `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
    GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
    GitHub Enterprise can install from `https://ghe.example.com/api/v3`
    instead of `api.github.com`.
  - New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
    every plugin's `package.json` at install time. Required fields: `name`,
    `version`, `description`, `author`, `license`, `checkstack.type`,
    `checkstack.pluginId`. Optional: `checkstack.bundle`,
    `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
  - New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
    `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
    `events` procedures.
  - New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
    with per-row uninstall (typed-confirmation modal, schema/configs/cascade
    toggles), install page with NPM / Tarball Upload / GitHub Release tabs
    (Catalog tab disabled — coming soon), and an events page surfacing the
    install/uninstall audit log.
  - New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
    per-package mode produces an npm-shaped tarball; `--bundle` mode produces
    an outer tarball containing every sibling declared in
    `package.json#checkstack.bundle`. Published to npm so external authors
    can `bunx` it directly without a workspace checkout.
  - Compatibility derived from `package.json#dependencies` ranges
    (`semver.satisfies` against the platform's loaded `@checkstack/*`
    versions) — no separate `compatibility` field.
  - Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
    install/uninstall; receiving instances do in-process register/unregister
    only. Destructive ops (drop schema, delete plugin_configs, delete
    artifacts, delete `plugins` rows) run exactly once on the originator.
  - Fresh-instance bootstrap: `loadPlugins()` hydrates any
    `is_uninstallable=true` plugin missing from `node_modules` from the
    artifact store before normal Phase 1 register.
  - New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
    (audit/error log). `plugins` extended with `version`, `metadata`,
    `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
    `version` from each plugin's `package.json` so the admin UI shows real
    versions instead of `—`.
  - Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
    the install UI; access-gated by `pluginmanager.plugin.manage`.
  - Plugin Manager menu link added to the user menu (main grid, alongside
    Profile / Notification Settings / etc.).

  Cross-cutting changes:

  - Backend request/response logging now flows through `rootLogger` (winston)
    instead of `hono/logger`. 5xx responses include the response body inline
    so swallowed early-return errors are visible in the log.
  - The `/api/:pluginId/*` dispatcher now logs which core service is missing
    or which `pluginId` had no metadata when it 500s.
  - New `registerCorePluginMetadata` on `PluginManager` for core routers
    (like the plugin manager itself) that need their metadata visible to the
    RPC dispatcher without going through the full plugin lifecycle.
  - ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
    between `null` (writes a real SQL NULL) and `undefined` (skip the column
    on insert), so treating them as interchangeable produced latent bugs at
    the persistence boundary. The bulk of the patch-bumped packages above
    reflect lint-fix touches that landed when this rule was relaxed.
  - Workspace-wide license normalization to `Elastic-2.0` (matches
    `LICENSE.md`). Every `package.json` in the workspace now declares the
    same SPDX identifier; the patch bumps capture this.

  Plugin packages (every `plugins/*`): added a `pack` npm script
  (`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
  `pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
  so install-time validation passes, stubbed any missing required metadata
  fields (`description`, `author`, `license`), and added
  `checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
  jira, queue-bullmq, queue-memory, cache-memory).

  Breaking changes:

  - The legacy single-method `PluginInstaller` interface (`install(packageName)`)
    is removed. Callers must use `coreServices.pluginInstallerRegistry`.
  - The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
    Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
    and `createPluginManagerRouter` in `core/backend`.
  - `@checkstack/test-utils-backend` no longer exports
    `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
    it shimmed is gone).

  Note: bumps are limited to `minor` (for packages with new public API
  surface) and `patch` (for downstream consumers, license normalization,
  and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
  the legacy interface had no third-party consumers in the wild before this
  runtime plugin system landed, and the contract surface is the same shape
  modulo the rename.

- Updated dependencies [50e5f5f]
  - @checkstack/common@0.8.0
  - @checkstack/ui@1.7.1
  - @checkstack/about-common@0.2.3
  - @checkstack/frontend-api@0.4.2

## 0.2.14

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/frontend-api@0.4.1
  - @checkstack/ui@1.7.0

## 0.2.13

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/frontend-api@0.4.0
  - @checkstack/ui@1.6.1

## 0.2.12

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/about-common@0.2.2
  - @checkstack/frontend-api@0.3.11

## 0.2.11

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1

## 0.2.10

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0

## 0.2.9

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0

## 0.2.8

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6

## 0.2.7

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5

## 0.2.6

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4

## 0.2.5

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3

## 0.2.4

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2

## 0.2.3

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0

## 0.2.1

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
  - @checkstack/about-common@0.2.1

## 0.2.0

### Minor Changes

- 3589199: Add About page with platform information, license, contact details, and version information

  - New `about-common` package with plugin metadata
  - New `about-frontend` package with the About page and user menu item
  - New `/api/about` backend endpoint exposing core version and loaded plugin versions
  - Accessible via "About Checkstack" in the user menu dropdown

### Patch Changes

- Updated dependencies [3589199]
  - @checkstack/about-common@0.2.0
