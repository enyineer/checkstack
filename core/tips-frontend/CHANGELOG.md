# @checkstack/tips-frontend

## 0.5.6

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
- Updated dependencies [88f4333]
  - @checkstack/auth-frontend@0.16.0
  - @checkstack/common@0.24.0
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/tips-common@0.3.13

## 0.5.5

### Patch Changes

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
  - @checkstack/ui@1.30.0
  - @checkstack/auth-frontend@0.15.0
  - @checkstack/frontend-api@0.17.0

## 0.5.4

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
  - @checkstack/auth-frontend@0.14.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/tips-common@0.3.12

## 0.5.3

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/auth-frontend@0.13.6
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/tips-common@0.3.11

## 0.5.2

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/auth-frontend@0.13.5

## 0.5.1

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/common@0.22.0
  - @checkstack/tips-common@0.3.11

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/auth-frontend@0.13.3

## 0.4.12

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2
  - @checkstack/auth-frontend@0.13.2

## 0.4.11

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ui@1.26.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/auth-frontend@0.13.1

## 0.4.10

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/auth-frontend@0.13.0
  - @checkstack/ui@1.25.1
  - @checkstack/tips-common@0.3.11

## 0.4.9

### Patch Changes

- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/auth-frontend@0.12.0
  - @checkstack/ui@1.25.0

## 0.4.8

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-frontend@0.11.3
  - @checkstack/frontend-api@0.13.2
  - @checkstack/tips-common@0.3.10

## 0.4.7

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/auth-frontend@0.11.2
  - @checkstack/frontend-api@0.13.1
  - @checkstack/tips-common@0.3.9

## 0.4.6

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/auth-frontend@0.11.1

## 0.4.5

### Patch Changes

- Updated dependencies [0d912a3]
- Updated dependencies [0d912a3]
- Updated dependencies [d9f4654]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/auth-frontend@0.11.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/tips-common@0.3.8

## 0.4.4

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/auth-frontend@0.10.2

## 0.4.3

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/auth-frontend@0.10.1
  - @checkstack/frontend-api@0.12.1
  - @checkstack/tips-common@0.3.7

## 0.4.2

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
  - @checkstack/auth-frontend@0.10.0
  - @checkstack/tips-common@0.3.6
  - @checkstack/common@0.17.0

## 0.4.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/auth-frontend@0.9.1

## 0.4.0

### Minor Changes

- 8cad340: Add persistent in-app help and a fresh-install getting-started checklist.

  - A persistent help affordance now lives in the navbar: a "?" icon button
    (accessible name "Help and documentation") opens a popover (sheet on mobile)
    containing a Documentation link to the user guide, a "Show tips again" action,
    and a one-line legend explaining the lightbulb (concept tip) vs tooltip
    (affordance hint) convention. Help is now reachable from every page rather
    than only via the sidebar's Docs link.
  - The documented "replay onboarding" capability is now wired: a new
    `useResetAllTips` hook in `@checkstack/tips-frontend` calls `TipsApi.reset`
    with no ids (clearing every dismissed tip for the user, server + localStorage),
    surfaced as the help menu's "Show tips again" action with a confirmation toast.
  - The dashboard now shows a dismissable "Getting started" checklist on fresh
    installs (zero catalog systems, derived from the existing entities query - no
    new queries). It links the next three steps: add a system, attach a health
    check, connect a notification channel. Dismissal persists per-user via the
    tips dismissal mechanism and is restorable from the help menu. The existing
    "Nothing to show on the dashboard yet" empty state is unchanged.

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

- 8cad340: Map the lightbulb tip trigger's hardcoded amber accent to the semantic
  `--warning` token so it follows the theme (consistency finding 06-9).
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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/auth-frontend@0.9.0
  - @checkstack/ui@1.17.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/tips-common@0.3.5

## 0.3.9

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/auth-frontend@0.8.1
  - @checkstack/ui@1.16.2

## 0.3.8

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/tips-common@0.3.4

## 0.3.7

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/auth-frontend@0.7.7

## 0.3.6

### Patch Changes

- @checkstack/auth-frontend@0.7.6

## 0.3.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/auth-frontend@0.7.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/tips-common@0.3.3

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
  - @checkstack/auth-frontend@0.7.4
  - @checkstack/common@0.14.1
  - @checkstack/tips-common@0.3.2

## 0.3.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/auth-frontend@0.7.3
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/tips-common@0.3.2

## 0.3.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/auth-frontend@0.7.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/tips-common@0.3.2
  - @checkstack/ui@1.13.2

## 0.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/auth-frontend@0.7.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/tips-common@0.3.1
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
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/auth-frontend@0.7.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/tips-common@0.3.0

## 0.2.7

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
- Updated dependencies [b995afb]
  - @checkstack/ui@1.12.0
  - @checkstack/auth-frontend@0.6.7

## 0.2.6

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
  - @checkstack/auth-frontend@0.6.6
  - @checkstack/tips-common@0.2.3

## 0.2.5

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/ui@1.10.0
  - @checkstack/tips-common@0.2.2

## 0.2.4

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/auth-frontend@0.6.4

## 0.2.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3

## 0.2.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2

## 0.2.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/tips-common@0.2.1
  - @checkstack/ui@1.8.1

## 0.2.0

### Minor Changes

- 3547670: Redesign `<Tip>` to be user-triggered instead of auto-opening.

  A small lightbulb icon is now rendered immediately after the wrapped
  element. The popover only opens when the user clicks the lightbulb.
  Once the user explicitly dismisses the tip (X, "Got it", or the action
  button), the lightbulb disappears for that user (per-user when signed
  in, per-browser when anonymous) and only the underlying element is
  rendered.

  This replaces the previous auto-open behaviour, which was racing with
  focus management whenever multiple tips on a page mounted at once
  (e.g. the Catalog "Add System" + "Add Group" tips would flash open and
  instantly self-close as Radix's outside-focus handler fired). It also
  fixes the bug where clicking the anchored button would silently dismiss
  the tip — the lightbulb model has no implicit dismissal at all.

  The default `align` for the popover changed from `"start"` to `"end"`
  so the popover hangs off the lightbulb rather than the larger anchor
  to its left. New optional `triggerClassName` prop on `<TipProps>` lets
  callers restyle the lightbulb when needed.

- 3547670: Add `@checkstack/tips-*` — first-run tip and onboarding infrastructure for
  the frontends.

  Three new packages:

  - `@checkstack/tips-common` — RPC contract (`tipsContract`), `TipsApi`
    client definition, and zod schemas. Fully-qualified tip IDs have shape
    `<pluginId>.<localTipId>` and are produced exclusively by
    `qualifyTipId(plugin, localId)` — plugins never write the namespace
    themselves, and a local id with a leading or trailing `.` is rejected,
    so one plugin cannot forge or dismiss a tip in another plugin's
    namespace.
  - `@checkstack/tips-backend` — Postgres-backed dismissal store
    (`user_tip_dismissal` with composite PK on `(user_id, tip_id)`),
    `listDismissed` / `dismiss` / `reset` endpoints scoped to the
    requesting user via the auto-auth middleware, and a
    `auth.userDeleted` hook that cleans up dismissals when a user is
    deleted.
  - `@checkstack/tips-frontend` — `<Tip>` (anchored popover) and
    `<TipBanner>` (inline callout) components plus the `useTipState`
    hook. All three accept `{ plugin, id }` (where `plugin` is the
    caller's `pluginMetadata`) and route through `qualifyTipId` so the
    namespace prefix is enforced at the boundary. Persists per-user on
    the server when logged in, and per-browser in `localStorage`
    (`checkstack.tips.dismissed`) when anonymous, with cross-tab sync via
    the `storage` event.

  `@checkstack/ui`'s `<EmptyState>` gains optional `steps` and `actions`
  props for richer empty-state coaching (numbered onboarding lists +
  primary CTA), and accepts `ReactNode` for `description`. Existing
  callers continue to work unchanged.

  `@checkstack/test-utils-backend`'s `createMockDb` now also mocks
  `insert().values().onConflictDoNothing()` so routers using upsert-or-skip
  semantics can be unit-tested.

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
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/tips-common@0.2.0
