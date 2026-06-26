# create-checkstack-plugin

## 0.1.10

### Patch Changes

- @checkstack/scripts@0.6.5

## 0.1.9

### Patch Changes

- Updated dependencies [2e20792]
  - @checkstack/scripts@0.6.4

## 0.1.8

### Patch Changes

- @checkstack/scripts@0.6.3

## 0.1.7

### Patch Changes

- @checkstack/scripts@0.6.2

## 0.1.6

### Patch Changes

- Updated dependencies [56e7c75]
  - @checkstack/scripts@0.6.1

## 0.1.5

### Patch Changes

- Updated dependencies [fb705df]
  - @checkstack/scripts@0.6.0

## 0.1.4

### Patch Changes

- Updated dependencies [968c12f]
  - @checkstack/scripts@0.5.0

## 0.1.3

### Patch Changes

- @checkstack/scripts@0.4.2

## 0.1.2

### Patch Changes

- @checkstack/scripts@0.4.1

## 0.1.1

### Patch Changes

- 4c6722c: Fix `Cannot find module '@checkstack/scripts/scaffold'` when running `bun create checkstack-plugin`. The `0.1.0` release pinned `@checkstack/scripts@0.3.4`, which predates the `./scaffold` subpath export (first shipped in `0.4.0`). This release pins a version of `@checkstack/scripts` that exposes `./scaffold`. `0.1.0` has been deprecated on npm.

## 0.1.0

### Minor Changes

- 9dcc848: Add a standalone plugin scaffolder and extract a monorepo-decoupled scaffolding engine.

  A new published package `create-checkstack-plugin` bootstraps a complete, standalone Checkstack plugin workspace (a `common` contract package, a `backend` implementing it, and a `frontend` consuming it) outside the monorepo, so `bun create checkstack-plugin <dir>` / `bunx create-checkstack-plugin <dir>` produce a repo where `bun install && bun run dev` works on first boot. It generates a local Bun workspace (private root `package.json`, root tsconfig, self-contained eslint config, `.gitignore`, quickstart README, changeset config), `git init`s the result (opt out with `--no-git`), and resolves concrete published `@checkstack/*` versions via `npm view` against the registry's `latest` dist-tag (overridable with `--version-tag` / `--registry` / `CHECKSTACK_SCAFFOLD_REGISTRY`); each `@checkstack/*` dep is resolved independently (versions are 0.x and not lockstepped), while the local trio siblings stay `workspace:*`. Sensible defaults: synthetic dev auth, a single local Postgres, one `items` table with CRUD at `/api/<pluginId>/*`, and one frontend list page. `create-checkstack-plugin` declares `@checkstack/scripts` as a runtime production dependency (by design - it imports the scaffolding engine from `@checkstack/scripts`'s published `src/`).

  `@checkstack/scripts`: the plugin-scaffolding logic is extracted into a reusable `scaffold/` engine (`scaffoldPlugin`, `refreshMonorepoReferences`, `resolveTargetDir`) parameterized by a `ScaffoldMode` (`monorepo` | `standalone`) instead of reading `process.cwd()`. The `workspace:*`-to-concrete rewrite is extracted into `rewriteWorkspaceVersions` with an injectable `VersionResolver` seam (now async, `Promise<string | undefined>`) so the standalone resolver resolves each dependency from the registry concurrently; `plugin-pack` and the in-monorepo `create` command are updated and behave identically. New exports: `scaffoldStandaloneRoot`, a scope-aware `scoped` Handlebars helper + `packageScope` template field (defaults to `checkstack`), and a `./scaffold` subpath export. The scaffolded backend template emits `checkstack.bundle`. No breaking change for existing consumers; the in-monorepo `create` output is unchanged.

  This is a beta minor.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/scripts@0.4.0
