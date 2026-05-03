---
"@checkstack/backend": minor
"@checkstack/frontend": minor
"@checkstack/scripts": minor
---

Add `bunx @checkstack/scripts dev` — a local Checkstack dev server for
plugin authors that runs from the plugin's own repo without a monorepo
checkout.

Mechanics:

- The dev command spawns `core/backend`'s production entry as a child
  process with three env vars wired in:
  - `CHECKSTACK_DEV_PLUGIN_PATH=<cwd>` — backend skips filesystem
    discovery and imports the plugin at this path as a manual plugin.
  - `CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS=<JSON array>` — additional
    backend plugins co-loaded as manual plugins. The dev command walks
    the plugin under dev's `package.json#dependencies` recursively to
    discover every `@checkstack/*-backend` package and pass their
    module paths through. Auto-includes
    `@checkstack/queue-memory-backend` +
    `@checkstack/cache-memory-backend` when no other queue/cache
    provider is in the dep graph, so `coreServices.queueManager` /
    `coreServices.cacheManager` always have a registered strategy on
    boot. Without this co-loading, plugins that depend on
    `healthcheck-backend`, `notification-backend`, etc. would hit
    unregistered services and the boot would deadlock.
  - `CHECKSTACK_DEV_AUTH=true` — backend registers a synthetic
    `AuthService` that auto-grants every registered access rule.
    Refused when `NODE_ENV=production` so accidental misuse is loud.
- A file watcher under the plugin's `./src` triggers a full backend
  restart (debounced) on save. Bun's startup is sub-second for a single
  plugin, so the loop stays tight.
- For frontend plugins (or bundle primaries with a `-frontend`
  sibling), the dev command additionally spawns a Vite dev server on
  port 5173 (configurable via `--frontend-port`). Vite serves
  `core/frontend`'s new `dev-main.tsx` shell — the same App.tsx,
  loadPlugins(), ThemeProvider, etc. that ship in production. The
  plugin module is mounted via a `virtual:checkstack-dev-plugin` alias
  Vite resolves at config time. React Fast Refresh works for component
  edits.
- On boot, the dev command validates the plugin's `package.json`
  against the same `installPackageMetadataSchema` the runtime install
  pipeline uses, so missing required fields fail fast.

Reuses 100% of the production boot code path — no parallel dev backend
to drift from. New code surfaces:

- `core/backend/src/services/dev-auth.ts` — the synthetic auth service.
  Inert unless `CHECKSTACK_DEV_AUTH=true`.
- `core/scripts/src/commands/dev-server.ts` — the CLI command.
- `core/scripts/src/commands/dev-deps-resolver.ts` — pure function that
  walks the plugin's deps and resolves the co-load set; covered by 8
  unit tests.
- `core/scripts/src/commands/dev-frontend.ts` — Vite spawn helper.
- `core/frontend/src/dev-main.tsx` — frontend dev-shell entry.

`@checkstack/scripts` now depends on `@checkstack/backend`,
`@checkstack/frontend`, `@checkstack/frontend-api`, `@checkstack/ui`,
`vite`, and `@vitejs/plugin-react` so a `bunx` invocation pulls in
everything needed for the dev server in one shot.

Replaces the previous "three patterns" plugin-development guide with a
single `bun run dev` workflow.

A new ESLint rule branch in `no-extraneous-runtime-deps` ignores
`virtual:` module specifiers (resolved by bundler aliases at runtime,
not installed from npm).

Scaffold templates updated for one-click compatibility — `bun run create`
now produces plugin packages that pass the dev-server's
`installPackageMetadataSchema` gate and ship `dev` / `pack` scripts plus
`@checkstack/scripts` in devDependencies, so a freshly scaffolded plugin
runs `bun run dev` without any further file edits. Required metadata
(`description`, `author`, `license: "Elastic-2.0"`, `checkstack.pluginId`)
is filled in by the scaffold; `@checkstack/scripts plugin-pack
--validate-only` accepts the rendered package.json directly. Templates
also reformatted from one-line JSON-in-handlebars to readable
multi-line.

New scaffold tests in `core/scripts/src/templates.test.ts` render each
template type and assert: dev-server validation passes, `dev` script
present (backend/frontend), `pack` script present, `@checkstack/scripts`
in devDependencies.

In addition, the new `dev-internals.ts`, `dev-lifecycle.ts`,
`dev-deps-resolver.ts`, and refactored `dev-frontend.ts` ship 58
unit tests covering arg parsing, package.json validation, backend
entry resolution, frontend-spawn decision, child env construction,
the debounce watcher, the spawn → restart → shutdown lifecycle (with
hard-kill SIGKILL fallback), the dev-auth service, and the bundle
sibling resolver — all driven through injectable seams so no real
process / Postgres / Vite is needed at test time.
