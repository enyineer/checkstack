# External plugin scaffolder + published-tarball integration test

> **Status:** planned (design locked 2026-06-01, not started)
> **Tracking issue:** #251 — "First-class external plugin DX — standalone
> scaffolder (common+backend+frontend) and end-to-end integration test"
> **Branch:** off `main`
> **Goal:** make external (third-party) plugin authoring a **first-class,
> well-tested** experience. Two committed deliverables: (a) build a real
> **standalone scaffolder** that bootstraps a complete `common`+`backend`+
> `frontend` plugin repo outside the monorepo, with concrete published
> `@checkstack/*` versions (never `workspace:*`), sensible defaults, and
> `git init`, so `bun install && bun run dev` works on first boot; and
> (b) an **automated CI integration test** that scaffolds from **published
> tarballs**, boots `@checkstack/dev-server`, runs `plugin-pack`, and
> asserts the plugin loads and serves `/api/<pluginId>/*` — so the path
> cannot silently rot.

Self-contained handoff. Pick up from this document alone. Every
current-state claim carries a `file:line` anchor (verified against the
tree at plan time) so the implementer never has to guess.

---

## 1. Why

- **The bootstrap half of the external story does not exist.** Wants #3
  (dev server, `@checkstack/dev-server`) and #4/#5 (`plugin-pack`, CI
  release) are built and published. Wants #1 (repo bootstrap) and #2
  (full skeleton from templates) only ever ran **inside the monorepo**.
  An external author today must hand-author `package.json`s or clone the
  monorepo — bad first-run DX, and **bad first-run DX loses external
  developers** (issue rationale, locked).
- **The scaffolder is structurally monorepo-coupled.**
  - `core/scripts/src/commands/create.ts:134` reads `process.cwd()` as
    `rootDir` and writes into `<cwd>/core/<name>` or `<cwd>/plugins/<name>`
    (`create.ts:194-199`), then runs `bun run typecheck:references:generate`
    against the repo root (`create.ts:224-235`). From an external dir the
    target path and the references script don't exist.
  - The `create` dispatch in `core/scripts/src/cli.ts:32-41` resolves the
    command module at `path.join(rootDir, "core/scripts/src/commands/create.ts")`
    with `rootDir = process.cwd()` (`cli.ts:19`). `bunx @checkstack/scripts
    create` from outside the monorepo points at a path that does not exist.
  - Every generated `package.json.hbs` pins `@checkstack/*` deps to
    `workspace:*`: `core/scripts/src/templates/backend/package.json.hbs:25-37`,
    `common/package.json.hbs:23-30`, `frontend/package.json.hbs:25-41`.
    These only resolve inside the workspace.
- **`workspace:*` is rejected at install.** The runtime compatibility
  checker flags any `@checkstack/*` dep whose declared range begins with
  `workspace:` as a `version-mismatch` issue
  (`core/backend/src/services/compatibility-checker.ts:85-94`). So an
  externally scaffolded plugin that ships `workspace:*` cannot install —
  the scaffolder MUST emit concrete versions.
- **The published path has never been integration-tested.** There are
  surgical real-services `*.it.test.ts` lanes
  (`.github/workflows/pr-checks.yml:158-222`, gated by `CHECKSTACK_IT=1`),
  but none exercises the external authoring lifecycle against published
  tarballs. Nothing proves `@checkstack/dev-server`'s and
  `@checkstack/scripts`'s published bins boot from a clean install.
- **Docs claim a bootstrap that the tooling can't deliver.**
  `plugin-development.md:59-118` shows a hand-written `package.json` with
  invented version ranges (`@checkstack/backend-api: "^1.0.0"` etc. — the
  real published versions are 0.x, see §3.5). `plugin-templates.md:133`
  has a dangling plain-text `CLI Scaffolding` list item (no link target).

---

## 2. Locked decisions (from the issue) + decisions taken here

Locked in the issue (do not relitigate):

1. **Build a real standalone scaffolder** — full `common`+`backend`+
   `frontend` skeleton, sensible defaults, concrete published versions,
   `git init`. Not a "copy this `package.json`" doc workaround.
2. **Automated integration test against published tarballs** — scaffold,
   boot dev server, run `plugin-pack`, assert the plugin loads and serves
   `/api/<pluginId>/*`. First-class deliverable, not a manual walkthrough.

DECIDED by the maintainer (2026-06-01 — both open sub-questions resolved
in favor of this plan's recommendations; do not relitigate):

3. **DECIDED: ship the scaffolder as a separate `create-checkstack-plugin`
   package** (new package under `core/`) — NOT a `--standalone` flag on
   `@checkstack/scripts create`. (Rationale in §4.1.) The shared,
   monorepo-decoupled scaffolding engine is extracted into
   `@checkstack/scripts` and consumed by both the new package and the
   existing in-monorepo `create` command.
4. **DECIDED: add the Verdaccio end-to-end integration lane to CI, with the
   fixture scaffolded on the fly, in-repo** — not a separate canonical
   reference repo. (Rationale in §7.) This makes the one test exercise the
   scaffolder, the published tarballs, the dev server, AND `plugin-pack` in
   a single lane.
5. **Sensible defaults** for the generated skeleton (§5): dev-auth mode
   (synthetic, the dev server's existing default), a single local Postgres
   (the dev server's existing default `DATABASE_URL`), and one example
   CRUD procedure set over one example `items` table — the same shape the
   current backend template already ships
   (`core/scripts/src/templates/backend/src/router.ts:25-45`,
   `schema.ts.hbs:10-16`). No reactive `defineEntity` in the default
   skeleton (kept minimal; offered as a commented pointer).

---

## 3. Current-state facts (file:line-anchored)

### 3.1 The scaffolder (`core/scripts/src/commands/create.ts`)

- Interactive `inquirer` flow: location (`core` | `plugins`,
  `create.ts:32-43`), plugin type (`backend|frontend|common|node|react`,
  `create.ts:45-71`), base name (`create.ts:119-131`), description
  (`create.ts:155-164`).
- `rootDir = process.cwd()` (`create.ts:134`); existence checks via
  `pluginExists` / `packageExists`
  (`core/scripts/src/utils/validation.ts:65-94`) which join `rootDir` with
  `plugins/` / `core/`.
- Writes a **single** package type at a time into
  `path.join(rootDir, packageLocation, pluginName)`
  (`create.ts:194-199`) from `templates/<pluginType>`
  (`create.ts:194`). It does NOT emit the `common`+`backend`+`frontend`
  trio in one run — want #2 needs that.
- After write, runs `bun run typecheck:references:generate`
  (`create.ts:224-235`) — a **monorepo-root** script
  (`package.json` root `typecheck:references:generate` →
  `scripts/generate-tsconfig-references.ts`). No `git init`. No standalone
  path.
- Template engine (`core/scripts/src/utils/template.ts`):
  `copyTemplate` recurses a template dir, strips `.hbs`, runs Handlebars
  over `.hbs` files and over `{{...}}` filenames
  (`template.ts:61-121`); `prepareTemplateData` derives
  `pluginName`/`pluginNamePascal`/`pluginNameCamel`/`pluginId`
  (`template.ts:126-154`); helpers `pascalCase`/`camelCase`/`kebabCase`/
  `year` (`template.ts:25-48`). **None of this is monorepo-coupled** — it
  takes a `templateDir` + `targetDir` + `data`. This is the reusable core.

### 3.2 CLI dispatch (`core/scripts/src/cli.ts`)

- `command = process.argv[2]` (`cli.ts:5`); `rootDir = process.cwd()`
  (`cli.ts:19`).
- `create` (`cli.ts:32-41`) and `sync` (`cli.ts:21-30`) dispatch via
  `path.join(rootDir, ...)` → **broken outside the monorepo**.
- `generate` (`cli.ts:43-53`) is monorepo-only too.
- `plugin-pack` (`cli.ts:55-67`) resolves the module relative to
  `import.meta.url` (`cli.ts:60-62`) — **works from a published install**.
- **No `dev` subcommand exists** in `cli.ts`, yet
  `core/dev-server/src/dev-server.ts:168` help text says
  `Usage: checkstack-scripts dev`. The published dev server is a
  **separate package** (`@checkstack/dev-server`, bin `checkstack-dev`),
  so that help string is stale — fix in this PR (§9).

### 3.3 Templates (`core/scripts/src/templates/`)

- Trio package.json templates all use `workspace:*`
  (`backend/package.json.hbs:25-37`, `common/package.json.hbs:23-30`,
  `frontend/package.json.hbs:25-41`). Backend deps:
  `@checkstack/backend-api`, `@checkstack/common`,
  `@checkstack/<base>-common` + dev: `@checkstack/scripts`,
  `@checkstack/dev-server`, `@checkstack/backend`, `@checkstack/tsconfig`,
  `@checkstack/drizzle-helper`, `@checkstack/test-utils-backend`.
- Scripts already correct for external use:
  `"dev": "checkstack-dev"`, `"pack": "bunx @checkstack/scripts plugin-pack"`
  (`backend/package.json.hbs:17-18`).
- `tsconfig` extends `@checkstack/tsconfig/backend.json`
  (`backend/tsconfig.json:2`) — that package is published, so it resolves
  externally **once added as a dep** (it is, as a devDep).
- Source skeletons are already external-friendly (import only from
  `@checkstack/*` published packages): `backend/src/index.ts.hbs:1-35`,
  `backend/src/router.ts.hbs:1-46`, `backend/src/schema.ts.hbs:1-19`,
  `common/src/rpc-contract.ts.hbs:1-70`, `common/src/index.ts.hbs:1-14`,
  `common/src/plugin-metadata.ts.hbs:1-6`, `frontend/src/index.tsx.hbs:1-26`.
- **Gap:** the trio templates are not *wired together for a standalone
  repo* — there is no root `package.json` (workspace), no root `tsconfig`,
  no root lint config, no `.gitignore`, no lockfile-friendly version pins.

### 3.4 `plugin-pack` (`core/scripts/src/commands/plugin-pack.ts`)

- Validates `installPackageMetadataSchema`
  (`plugin-pack.ts:48-55`), `--validate-only` returns early
  (`plugin-pack.ts:57-60`).
- Non-bundle runs `typecheck` + `lint` if present
  (`plugin-pack.ts:62-66`, `runScriptIfPresent` `:228-244`).
- Workspace rewrite: `buildWorkspaceMap` walks the nearest ancestor
  `package.json` with a `workspaces` field (`findWorkspaceRoot`
  `:283-294`); returns an **empty map for a standalone repo**
  (`buildWorkspaceMap:252-281`). `packPackage` only rewrites a dep when
  its range `startsWith("workspace:")` (`:331-347`) — so for a standalone
  repo with concrete versions, **rewrite is a no-op** (confirm in the
  test, want #4). If a `workspace:` range survives and no map entry
  exists, it **throws** (`:334-339`) — which is why the scaffolder must
  never emit `workspace:*`.
- Bundle mode requires `checkstack.bundle` (`:71-77`), packs primary +
  siblings, emits `<name>-<version>-bundle.tgz` + `bundle.json`
  (`:120-158`).
- Module-relative entry (`import.meta.main`, `:394-397`) → published bin
  works.

### 3.5 dev-server (`core/dev-server/src/*`) — published `@checkstack/dev-server@2.0.0`

- `runDevServer` (`dev-server.ts:45-165`): validate package.json
  (`:53-69` → `validatePluginPackageJson` in
  `dev-internals.ts:104-126`, same `installPackageMetadataSchema` as
  install), resolve `@checkstack/backend` from the plugin's own
  node_modules (`:75-81` → `resolveBackendEntry` `dev-internals.ts:141-173`),
  co-load `@checkstack/*-backend` deps (`:85-92` →
  `resolveCorePluginDeps` `dev-deps-resolver.ts:67-165`), build child env
  (`:95-99` → `buildBackendChildEnv` `dev-internals.ts:205-225`), spawn the
  real `core/backend` entry, watch `./src` (`:123-130`), Vite for frontend
  (`:136-151` → `startFrontendDevServer` `dev-frontend.ts:33-135`).
- Dev env contract: `CHECKSTACK_DEV_PLUGIN_PATH=<cwd>`,
  `CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS=<JSON paths>`,
  `CHECKSTACK_DEV_AUTH=true`, `PORT`, `DATABASE_URL` (default
  `postgresql://checkstack:checkstack@localhost:5432/checkstack`),
  `BASE_URL`, `AUTH_SECRET` (default `checkstack-dev-secret`), `NODE_ENV`
  (`dev-internals.ts:214-224`, `parseDevArgs:36-86`).
- Backend consumes them: `core/backend/src/index.ts:621-689` —
  `skipDiscovery: !!devPluginPath` (`:688`), imports extra plugin paths
  (`:649-666`), imports the dev plugin last (`:671-684`), refuses dev auth
  when `NODE_ENV=production` (`:624-629`).
- `resolveCorePluginDeps` auto-includes `@checkstack/queue-memory-backend`
  + `@checkstack/cache-memory-backend` when no queue/cache provider is in
  the graph (`dev-deps-resolver.ts:144-162`) — so a default plugin boots
  without Redis. **The scaffolded plugin needs no queue/cache dep.**

### 3.6 Published-version baseline (read from the tree at plan time)

`@checkstack/common@0.12.0`, `backend-api@0.20.0`, `backend@0.15.0`,
`frontend@0.6.7`, `frontend-api@0.6.0`, `ui@1.12.0`, `drizzle-helper@0.0.5`,
`test-utils-backend@0.1.33`, `dev-server@2.0.0`, `scripts@0.3.4`. All are
0.x/early — confirming the docs' invented `^1.0.0` ranges
(`plugin-development.md:81-88`) are **wrong** and must be corrected.
Packages are published independently via changesets + a custom
`scripts/publish-packages.ts` (`bun publish`, resolves `workspace:*`) on
merge to `main` (`.github/workflows/release.yml:44-56`). **Versions are
not lockstepped** across `@checkstack/*` — the scaffolder must resolve each
package's `latest` dist-tag at scaffold time (§4.3), not hardcode a single
shared version.

### 3.7 Docs + release template

- `docs/src/content/docs/developer-guide/getting-started/plugin-development.md`
  — dev loop (good) but the bootstrap section
  (`:59-118`) hand-authors a `package.json` with invented `^1.0.0` ranges.
- `docs/src/content/docs/developer-guide/architecture/plugin-distribution.md`
  — pack/bundle/CI (accurate; verify against tarballs in want #5).
- `docs/src/content/docs/developer-guide/examples/plugin-templates.md:133`
  — dangling `CLI Scaffolding` plain-text item.
- The CI release template the issue calls `docs/examples/plugin-release.yml`
  actually lives at **`docs/public/examples/plugin-release.yml`** (served
  as a Starlight static asset; the doc links `../examples/plugin-release.yml`).
  Its header comment references the **legacy** path
  `docs/architecture/plugin-distribution.md` (line ~13) which no longer
  exists (canonical is `docs/src/content/docs/developer-guide/architecture/
  plugin-distribution.md`, per `.agent/rules/architecture.md`). Fix the
  comment in this PR. `docs/examples/` does NOT exist — the issue's path is
  imprecise; the file to touch is under `docs/public/examples/`.

---

## 4. Design — the standalone scaffolder

### 4.1 DECIDED (maintainer, locked): separate `create-checkstack-plugin` package

**Decision (locked): ship a new published package `create-checkstack-plugin`**
(unscoped, so `bunx create-checkstack-plugin` and `bun create
checkstack-plugin <dir>` both work), with the **scaffolding engine
extracted into `@checkstack/scripts`** and reused by both it and the
in-monorepo `create` command.

Rationale:

- **`bun create` / `bunx` ergonomics.** `bun create foo` resolves the
  unscoped package `create-foo`; this is the idiomatic "one command,
  no install" bootstrap users expect. A `--standalone` flag on
  `@checkstack/scripts create` would still require the user to know the
  `@checkstack/scripts` package name and the `create` subcommand —
  worse discoverability for a first-run tool.
- **Clean separation of audiences.** `@checkstack/scripts` is a
  *devDependency of an existing plugin* (`plugin-pack`, codegen).
  `create-checkstack-plugin` is a *one-shot bootstrapper* run **before**
  any repo exists. Different lifecycles, different blast radius.
- **No new monorepo coupling.** The existing in-monorepo `create`
  (`create.ts`) stays working by importing the extracted engine from
  `@checkstack/scripts` and passing monorepo paths + `workspace:*` mode;
  the new package passes a standalone target dir + concrete-version mode.
  Both call the same code → the integration test (§7) guards the same
  engine the maintainers use daily.

Trade-off accepted: one more published package to version. Mitigated by
keeping `create-checkstack-plugin` a thin shell (arg parse + prompts +
`git init`); all logic lives in `@checkstack/scripts`.

### 4.2 Decoupling the engine from `process.cwd()` / monorepo root

Extract a pure, mode-parameterized scaffolding engine into
`@checkstack/scripts` (e.g. `core/scripts/src/scaffold/`):

```ts
// core/scripts/src/scaffold/scaffold-plugin.ts
export type ScaffoldMode =
  | { kind: "monorepo"; rootDir: string; location: "core" | "plugins" }
  | { kind: "standalone"; targetDir: string };

export interface ScaffoldOptions {
  mode: ScaffoldMode;
  baseName: string;            // e.g. "widget"
  description: string;
  /** Which package types to emit. Standalone default: all three. */
  packageTypes: ("common" | "backend" | "frontend")[];
  /** Resolve a concrete version for an @checkstack/* dep name. */
  resolveVersion: (pkgName: string) => Promise<string>;
  /** Injected for tests (fs, spawn, logger). */
  io?: ScaffoldIo;
}
```

- **No `process.cwd()` inside the engine.** The caller supplies
  `targetDir` (standalone) or `rootDir` (monorepo). `create.ts` keeps
  reading `process.cwd()` and passes it in; the new package resolves
  `targetDir` from its CLI arg.
- **No root references-generate in standalone mode.** The
  `bun run typecheck:references:generate` call (`create.ts:224-235`)
  moves behind `mode.kind === "monorepo"`. Standalone repos don't use
  TS project references (single-package or local workspace), so per the
  `.agent/rules/typecheck.md` rule it's a no-op there.
- **Version rewriting is a render step, not a post-process.** The engine
  renders `package.json.hbs` then, in standalone mode, **rewrites every
  `workspace:*` range to the concrete version** from `resolveVersion`
  before writing to disk. (The templates keep `workspace:*` so the
  monorepo path is unchanged; only standalone mode rewrites.) This reuses
  the proven `workspace:`-detection shape already in
  `plugin-pack.ts:331-347` — extract it into a shared
  `core/scripts/src/scaffold/rewrite-workspace-versions.ts` and have BOTH
  `plugin-pack` and the scaffolder import it (DRY, per CLAUDE.md).

### 4.3 Concrete version resolution

`resolveVersion(pkgName)` resolves each `@checkstack/*` dependency to a
concrete published version at scaffold time:

- Default impl in `create-checkstack-plugin`: query the registry's
  `latest` dist-tag (`npm view <pkg> version`, mirroring
  `scripts/publish-packages.ts:86`), with a small concurrency cap and a
  single in-process cache. Pin as a **caret** range (`^<version>`) so the
  generated repo tracks compatible patches, matching how
  `plugin-pack` rewrites (`^${targetPkg.version}`, `plugin-pack.ts:343`)
  and the compatibility checker's `semver.satisfies`
  (`compatibility-checker.ts:98`).
- `--version-tag <tag>` flag (default `latest`) so a user on a `next`
  channel can scaffold against pre-releases.
- `--registry <url>` flag (env: `CHECKSTACK_SCAFFOLD_REGISTRY`, default the
  configured npm registry) so `resolveVersion` can be pointed at any
  registry. This is what the integration test (§7) sets to the local
  Verdaccio. The default `resolveVersion` impl threads it into the
  `npm view` call (`npm view <pkg> --registry <url> version`); the engine
  itself stays registry-agnostic because `resolveVersion` is an injected
  `ScaffoldOptions` field (§4.2), so the test supplies its own resolver.
- `--offline` / network-failure fallback: if the registry is unreachable,
  fail loudly with the list of packages that couldn't resolve (do NOT
  silently emit `workspace:*` — the install would be rejected,
  §3.4/`compatibility-checker.ts:85-94`). The integration test (§7) runs
  against a **local registry** so it never hits the public network.
- **Versions are per-package** (§3.6 — not lockstepped). Resolve each dep
  independently; never assume one shared version.

### 4.4 Standalone repo layout the scaffolder emits

For `create-checkstack-plugin widget` (trio default), emit a local Bun
workspace so the dev server and `plugin-pack` resolve siblings the same
way they do in the monorepo:

```
widget/
  package.json                 # private root: workspaces ["packages/*"], scripts
  tsconfig.json                # solution-style or simple; references the 3 pkgs
  .gitignore                   # node_modules, dist, .tsbuild, *.tgz
  eslint.config.js             # extends the shared config the templates assume
  README.md                    # generated quickstart
  .changeset/                  # config + initial changeset (so `pack` versioning works)
  packages/
    widget-common/             # from templates/common, versions rewritten
    widget-backend/            # from templates/backend, checkstack.bundle set
    widget-frontend/           # from templates/frontend
```

Key wiring:

- **Root `package.json`** is `private: true`, `workspaces:
  ["packages/*"]`, and forwards scripts to the backend package so a single
  top-level `bun run dev` / `bun run pack` works:
  - `"dev": "bun run --filter '@<scope>/widget-backend' dev"`
  - `"pack": "bun run --filter '@<scope>/widget-backend' pack -- --bundle"`
  - `"typecheck"`, `"lint"`, `"test"` fan out via `--filter '*'`.
  The local `workspaces` field also makes `plugin-pack --bundle`'s
  `buildWorkspaceMap` resolve siblings (`plugin-pack.ts:252-281`) — but
  because versions are already concrete, no rewrite happens (no-op,
  confirming want #4).
- **`checkstack.bundle`** on the backend primary lists the `-common` +
  `-frontend` siblings (issue want #4/#5, exercised by bundle mode and by
  `shouldSpawnFrontend` / `pickFrontendEntry`,
  `dev-internals.ts:185-193` / `dev-frontend.ts:148-198`).
- **Scope handling.** Prompt for an npm scope (e.g. `@acme`); default to
  an unscoped `widget-*` set if the author declines (both install fine —
  `plugin-distribution.md:38`). `pluginId` stays the unscoped base
  (`widget`), used for `/api/<pluginId>/*` routing.
- **`git init`** + an initial commit (issue want #1) — done in the thin
  `create-checkstack-plugin` shell after the engine writes files, behind a
  `--no-git` opt-out. (NOT in the shared engine, so the monorepo path is
  unaffected.)

### 4.5 New `*.hbs` templates needed (standalone-only)

These render only in standalone mode (the engine skips them in monorepo
mode). Put under `core/scripts/src/templates/standalone-root/`:

- `package.json.hbs` (root workspace, scope + scripts).
- `tsconfig.json.hbs`, `eslint.config.js.hbs`, `.gitignore`,
  `README.md.hbs` (quickstart: prereqs → `bun install` → `bun run dev`
  → hit `/api/<pluginId>/*` → `bun run pack`).
- `.changeset/config.json.hbs` + `.changeset/initial.md.hbs`.

The existing per-type templates (`templates/{common,backend,frontend}/`)
are **reused verbatim**, with ONE required modification:

- **`templates/backend/package.json.hbs` must gain a `checkstack.bundle`
  array** listing the `-common` and `-frontend` siblings (the backend is
  the bundle primary). It currently has only `type`/`pluginId`
  (`backend/package.json.hbs:12-15`). Without `checkstack.bundle`,
  `plugin-pack --bundle` **errors out** (`plugin-pack.ts:71-77` —
  `"--bundle requires checkstack.bundle"`), which the integration test
  asserts (§7.2 step 4) — so this is load-bearing, not optional. Render
  the sibling names through the scope-aware Handlebars data (e.g.
  `["@{{scope}}/{{pluginBaseName}}-common", "@{{scope}}/{{pluginBaseName}}-frontend"]`,
  or the unscoped forms when no scope is given). This block is emitted in
  **both** modes — it is harmless in the monorepo path (siblings resolve
  via the workspace) and required in standalone. Siblings (`-common`,
  `-frontend`) must NOT carry `checkstack.bundle`
  (`plugin-distribution.md:166`).

Beyond that, only the templates' `workspace:*` ranges are rewritten by
the engine (§4.2). Do NOT otherwise fork them.

---

## 5. Sensible-defaults skeleton (the "useful on first boot" contract)

Resolves the issue's third open sub-question. The generated trio ships:

- **Auth mode: synthetic dev auth.** No auth config in the skeleton — the
  dev server sets `CHECKSTACK_DEV_AUTH=true` (`dev-internals.ts:218`,
  enforced off in prod by `core/backend/src/index.ts:624-629`), so every
  access rule the plugin registers is auto-granted to a `dev-user`. The
  skeleton's `common/src/access.ts` declares one read/manage access pair
  (the template already does this via `accessPair`,
  cf. `plugin-templates.md:68-76`); the contract's procedures reference it
  (`common/src/rpc-contract.ts.hbs:11-58`). First boot needs no login.
- **DB: single local Postgres, migrations on boot.** Default
  `DATABASE_URL=postgresql://checkstack:checkstack@localhost:5432/checkstack`
  (`dev-internals.ts:50-52`); the README's prereqs reuse the existing
  `docker run ... postgres:16-alpine` snippet
  (`plugin-development.md:42-48`). No queue/cache dep — the dev server
  auto-loads in-memory providers (`dev-deps-resolver.ts:144-162`), so
  Redis is NOT required for first boot.
- **Example entity: one `items` table.** `backend/src/schema.ts.hbs:10-16`
  — `id uuid pk`, `name text`, `description text?`, `createdAt`,
  `updatedAt`. Drizzle, schema-isolated via `search_path`.
- **Example procedures: CRUD over `items`.** `getItems`, `getItem`,
  `createItem`, `updateItem`, `deleteItem`
  (`common/src/rpc-contract.ts.hbs:11-58`,
  `backend/src/router.ts.hbs:25-45`), served at `/api/widget/*`. The
  integration test (§7) asserts `getItems` answers there.
- **Example frontend: one list page + route.** `frontend/src/index.tsx.hbs`
  registers a `home` route (`:12-22`) rendering
  `WidgetListPage` that calls the typed client. Exercises Vite/HMR
  (want #3 backend+frontend case).
- **Explicitly NOT in the default skeleton:** a reactive
  `defineEntity`/state-machine example (kept minimal; add a commented
  pointer to the entity docs). Rationale: the default must boot with the
  fewest moving parts; reactive entities add queue/event surface that a
  first-run author shouldn't have to reason about. Per
  `.agent/rules/state-and-scale.md`, the example `items` table is the
  durable source of truth read directly by the service — no pod-local
  state, so the skeleton is scale-correct by construction.

---

## 6. The exists-vs-missing matrix

| # | Capability | State | Anchor / note |
|---|------------|-------|---------------|
| 1 | Standalone **repo bootstrap** (root pkg, tsconfig, lint, `.gitignore`, `git init`) | **MISSING — build** | no code path; `create.ts:194-235` is monorepo-only |
| 2 | **Full trio skeleton** from templates, concrete published versions | **PARTIAL — build** | templates exist but `workspace:*` (`backend/package.json.hbs:25-37`) + single-type-per-run |
| 2a | Decouple engine from `process.cwd()`/root | **MISSING — build** | `create.ts:134,194-199,224-235`; `cli.ts:19,32-41` |
| 2b | Concrete-version resolution (`latest` dist-tag) | **MISSING — build** | versions are 0.x, per-package (§3.6) |
| 3 | Minimal dev server (`checkstack-dev`) | **EXISTS** | `@checkstack/dev-server@2.0.0`, `dev-server.ts:45-165` |
| 3a | Backend + frontend (Vite/HMR) dev | **EXISTS** | `dev-frontend.ts:33-135`, `shouldSpawnFrontend` `dev-internals.ts:185-193` |
| 3b | Co-load core backend deps + auto queue/cache | **EXISTS** | `dev-deps-resolver.ts:67-165` |
| 4 | `plugin-pack --validate-only` / pack / `--bundle` | **EXISTS** | `plugin-pack.ts:48-169` |
| 4a | `workspace:*` rewrite is a **no-op** for standalone | **EXISTS (to confirm)** | empty map `buildWorkspaceMap:252-281`; rewrite guarded `:331-347` |
| 5 | CI release workflow template | **EXISTS (unproven vs tarballs)** | `docs/public/examples/plugin-release.yml` |
| 5a | Runtime rejects `workspace:*` at install | **EXISTS** | `compatibility-checker.ts:85-94` |
| 6 | **Automated integration test** vs published tarballs | **MISSING — build** | no `*.it.test.ts` covers this lane (`pr-checks.yml:158-222`) |
| D1 | `cli.ts` has a `dev` subcommand | **MISSING / stale help** | `cli.ts` lacks `dev`; `dev-server.ts:168` help says otherwise |
| D2 | Docs bootstrap section accurate | **WRONG** | invented `^1.0.0` ranges `plugin-development.md:81-88` |
| D3 | `plugin-templates.md` "CLI Scaffolding" link | **DANGLING** | `plugin-templates.md:133` |
| D4 | `plugin-release.yml` doc path | **MISPLACED REF** | lives in `docs/public/examples/`; header cites legacy `docs/architecture/...` |

---

## 7. Design — the automated integration test (want #6)

### 7.1 DECIDED (maintainer, locked): Verdaccio e2e lane, scaffold-on-the-fly, in-repo

**Decision (locked): add the Verdaccio end-to-end integration lane to CI;
the test scaffolds the fixture on the fly, inside this repo's CI**, against
**published tarballs served from a local registry**. No separate canonical
reference repo.

Rationale:

- **One test guards four things.** Scaffolding on the fly exercises the
  scaffolder itself (wants #1/#2), the published tarballs, the dev server
  (#3), and `plugin-pack` (#4) in a single lane. A static fixture repo
  would test only #3–#5 and let the scaffolder rot independently — the
  exact failure mode this issue exists to prevent.
- **No second repo to maintain or keep in sync** with template/version
  changes. The fixture is always current because it's generated from the
  same templates the scaffolder ships.
- **Deterministic + offline.** Publishing the current monorepo packages to
  a **local Verdaccio** registry and resolving `latest` from it (§4.3,
  `--version-tag` + a `--registry` override on `resolveVersion`) makes the
  test hermetic — no public-network flakiness, and it tests the
  *just-built* code, not whatever is live on npm.

### 7.2 Test shape (`*.it.test.ts`, gated by `CHECKSTACK_IT`)

Add `core/dev-server/src/external-plugin-lifecycle.it.test.ts` (or a new
`core/e2e-external/` package if it needs its own deps — decide at impl
time based on whether it can live as a devDep of `dev-server`). Wrap in
`describe.skipIf(!process.env.CHECKSTACK_IT)` so the fast lane skips it
(`pr-checks.yml:155-157`).

Steps (each an assertion point):

1. **Publish tarballs to a local registry.** This is the first-class
   want-#6 mechanism, so specify it concretely — `scripts/publish-packages.ts`
   publishes to the **real npm registry via `bun publish`** and is NOT
   directly reusable here; we drive a throwaway local registry instead:

   1. **Boot Verdaccio** on `http://localhost:4873` with a config that
      allows anonymous publish (a tmp `config.yaml` with
      `packages: { '@checkstack/*': { access: $all, publish: $anonymous },
      'create-checkstack-plugin': { access: $all, publish: $anonymous } }`).
      Run it as a CI step/background process (`npx verdaccio --config
      <tmp>/config.yaml`), wait for the port to answer.
   2. **Mint a throwaway auth token** so the publish protocol is satisfied
      even though the registry accepts anonymous: write a tmp `.npmrc`
      containing `//localhost:4873/:_authToken=fake` +
      `@checkstack:registry=http://localhost:4873` and point
      `NPM_CONFIG_USERCONFIG` / `BUN_CONFIG_REGISTRY` at it for the publish
      and install steps.
   3. **Publish each package with `npm publish`, not `bun publish`.**
      Iterate the ~11 packages the scaffold needs (`common`, `backend-api`,
      `backend`, `frontend`, `frontend-api`, `ui`, `tsconfig`,
      `drizzle-helper`, `test-utils-backend`, `scripts`, `dev-server`) plus
      `create-checkstack-plugin` itself, running
      `npm publish --registry http://localhost:4873 --userconfig <tmp>/.npmrc`
      in each package dir. **Publish-protocol caveat:** `bun publish`
      resolves `workspace:*` to concrete versions at publish time (the
      whole reason `scripts/publish-packages.ts:4-6` uses it), whereas
      `npm publish` does NOT understand `workspace:*`. So either (a) run
      the monorepo's own `bun run scripts/publish-packages.ts` with a
      `--registry`/registry-env override so it targets Verdaccio while
      keeping its workspace-resolution behavior — **preferred**, since it
      reuses the proven resolver — or (b) if `bun publish` cannot be
      retargeted at a local registry in CI, first run `plugin-pack`-style
      workspace rewriting over a throwaway copy of each package, then
      `npm publish` the rewritten copies. Decide at impl time by checking
      whether `bun publish --registry` (or `BUN_CONFIG_REGISTRY`) works in
      the CI image; the plan's default is (a). Assert each publish returns 0
      and `npm view <pkg> --registry http://localhost:4873 version` answers.
2. **Scaffold on the fly.** Run the new scaffolding engine in
   `{ kind: "standalone" }` mode into a tmpdir, with the **injected
   `ScaffoldOptions.resolveVersion`** (§4.2) pointed at the local registry
   — the test passes a resolver that calls
   `npm view <pkg> --registry http://localhost:4873 version` (the same
   `--registry`/`CHECKSTACK_SCAFFOLD_REGISTRY` env override the
   `create-checkstack-plugin` CLI exposes, §4.3). This is why
   `resolveVersion` is an injected option rather than hardcoded: the test
   overrides it without touching the network. Assert: trio dirs exist,
   every `package.json` has **zero** `workspace:` ranges, the concrete
   versions match what Verdaccio reports, `git` repo initialized.
3. **`bun install`** in the tmpdir against the local registry (the tmp
   `.npmrc` / `@checkstack:registry` + `BUN_CONFIG_REGISTRY` from step 1.2
   route all `@checkstack/*` fetches to Verdaccio). Assert exit 0 and that
   `@checkstack/backend` + `@checkstack/dev-server` resolve in
   `node_modules`.
4. **`plugin-pack --validate-only`** then **`plugin-pack --bundle`**.
   Assert: validate passes; rewrite is a **no-op** (no `workspace:`
   survived → confirms want #4a); a `<name>-<version>-bundle.tgz` with a
   schema-valid `bundle.json` is produced (`plugin-pack.ts:120-158`).
5. **Boot the dev server** (`runDevServer` against the real `CHECKSTACK_IT`
   Postgres `CHECKSTACK_IT_PG_URL`, `pr-checks.yml:189`). Reuse the
   integration Postgres service. Wait for HTTP ready.
6. **Assert the plugin loads + serves `/api/<pluginId>/*`.** POST
   `/api/widget/getItems` with an oRPC JSON envelope
   (cf. `plugin-development.md:226-229`) under dev auth; assert 200 and a
   JSON array body. Assert the Plugin Manager reports the plugin loaded
   (query the pluginmanager router or the boot log).
7. **(backend+frontend case)** assert the Vite server starts and the
   frontend entry resolves (`pickFrontendEntry`,
   `dev-frontend.ts:148-198`) — at minimum that `shouldSpawnFrontend`
   fires and the Vite port answers.
8. **Teardown.** Kill child processes, stop Verdaccio, drop the tmp DB
   schema, remove tmpdir.

### 7.3 CI wiring

Run in the existing `integration` job (`pr-checks.yml:158-222`) — it
already provides Postgres + `CHECKSTACK_IT=1` + the `bun test it.test`
selector (`:207`). Concrete additions to that job:

- **A "Publish to local registry" step before the test** (or have the test
  itself boot it — prefer a CI step so a publish failure is attributed
  clearly): `npx verdaccio --config <tmp>/config.yaml &`, wait for
  `http://localhost:4873`, write the tmp `.npmrc` (anonymous publish + the
  throwaway `_authToken`), then publish the ~11 `@checkstack/*` packages +
  `create-checkstack-plugin` via the §7.2-step-1 mechanism (default:
  retargeted `scripts/publish-packages.ts`; fallback: rewrite-then-
  `npm publish`).
- **Env passed to the test**: `CHECKSTACK_SCAFFOLD_REGISTRY=http://localhost:4873`
  (consumed by the injected `resolveVersion`) and the tmp
  `BUN_CONFIG_REGISTRY` / `NPM_CONFIG_USERCONFIG` so the in-test
  `bun install` (step 3) hits Verdaccio.
- A longer step timeout (publish + full `bun install` + backend boot is
  minutes, not seconds).

Because the test publishes the *current* working tree's packages, it
implicitly catches "a `package.json` change broke the published shape"
regressions — the rot the issue calls out.

> [!NOTE]
> Local-registry publish + a full `bun install` + a backend boot is
> heavy (minutes). Keep it to **one** end-to-end test (backend+frontend
> trio); push finer-grained assertions (version rewriting, env
> construction, frontend-entry picking) into the existing fast unit
> suites (`dev-internals.test.ts`, `dev-deps-resolver.test.ts`,
> `dev-frontend.test.ts`) where they already largely live.

---

## 8. Phasing (each phase independently shippable)

### Phase 1 — Extract the monorepo-decoupled scaffolding engine

- Move the FS/Handlebars logic into `core/scripts/src/scaffold/`
  (`scaffold-plugin.ts`, `rewrite-workspace-versions.ts`,
  `resolve-versions.ts`) with the `ScaffoldMode` parameterization (§4.2).
- Extract the `workspace:`-rewrite from `plugin-pack.ts:331-347` into the
  shared module; have `plugin-pack` import it (DRY, no behavior change).
- Rewire `create.ts` to call the engine in `{ kind: "monorepo" }` mode;
  keep `typecheck:references:generate` behind that mode.
- **Ship:** in-monorepo `create` behaves identically; no external surface
  yet. Changeset: `@checkstack/scripts` minor (internal refactor + new
  exported engine).

### Phase 2 — `create-checkstack-plugin` package

- New package `core/create-checkstack-plugin` (unscoped published name
  `create-checkstack-plugin`, `bin` so `bun create checkstack-plugin`
  works). Thin shell: arg parse, prompts (scope, base name, which types),
  `resolveVersion` via `npm view`, call the engine in
  `{ kind: "standalone" }`, then `git init` + initial commit.
- **Dependency note:** `create-checkstack-plugin` declares
  `@checkstack/scripts` as a **production `dependency`** (not a devDep),
  because it imports and runs the extracted scaffolding engine at runtime.
  This is intentionally unusual — everywhere else `@checkstack/scripts` is
  a *plugin devDependency* (tooling). Because the engine lives in
  `@checkstack/scripts`'s published `src/` (`files: ["src", ...]`,
  `core/scripts/package.json`), the import resolves from a normal install.
  After adding the dep, re-run `typecheck:references:generate`.
- New `templates/standalone-root/` (§4.5) + the `checkstack.bundle`
  template change (§4.5).
- Run `bun run typecheck:references:generate` (new workspace package +
  the new `@checkstack/scripts` workspace dep, per
  `.agent/rules/typecheck.md`).
- **Ship:** `bunx create-checkstack-plugin widget` produces a repo where
  `bun install && bun run dev` works. Changeset: new package minor.
  **In the changeset body, explicitly note** that
  `create-checkstack-plugin` takes `@checkstack/scripts` as a *runtime
  production dependency* (it executes the engine), so a reviewer doesn't
  flag the dependency type as a mistake.

### Phase 3 — Automated integration test (want #6)

- Local-registry publish harness + the `*.it.test.ts` lane (§7).
- Verdaccio in the `integration` CI job.
- **Ship:** the external lifecycle is guarded in CI. Changeset: test-only
  (no version bump strictly required, but a `@checkstack/dev-server` /
  `create-checkstack-plugin` patch is reasonable if any prod code moved).

### Phase 4 — Docs + cleanup (want: docs correct; D1–D4)

- `plugin-development.md`: replace the hand-authored `package.json`
  bootstrap (`:59-118`) with the `create-checkstack-plugin` quickstart;
  fix the invented `^1.0.0` ranges (D2).
- `plugin-distribution.md`: verify every command against the §7 run; fix
  any drift; correct the `docs/public/examples/plugin-release.yml`
  header's legacy `docs/architecture/...` path (D4).
- `plugin-templates.md:133`: point `CLI Scaffolding` at the new
  bootstrap page or remove the item (D3).
- Add a `dev` subcommand to `cli.ts` that shells to `checkstack-dev`, OR
  fix the stale help text in `dev-server.ts:168` to say `checkstack-dev`
  (D1) — pick the smaller change; recommend fixing the help text since
  `@checkstack/dev-server` is the published, documented entry.
- New `developer-guide` page (or section) for the scaffolder with a
  runnable example (per `.agent/rules/docs-style.md`: frontmatter
  `title`+`description`, sentence-case headings, no em-dashes, slug links).
- **Ship:** docs match reality; every command executes verbatim.

---

## 9. Per-phase test matrix

| Phase | Unit (fast lane) | Integration (`CHECKSTACK_IT`) | Manual / docs |
|-------|------------------|-------------------------------|---------------|
| 1 | engine renders trio to a tmp target (no network); `workspace:`→concrete rewrite (table of cases); `plugin-pack` still rewrites via shared module (existing tests stay green) | n/a | `bun run create` in monorepo still scaffolds + wires references |
| 2 | `resolveVersion` (mock `npm view`, incl. `--registry` threading); standalone layout asserted on a tmpdir; **zero `workspace:` ranges**; backend `checkstack.bundle` lists the two siblings; root `package.json` scripts/workspaces correct; `git init` invoked (injected spawn) | n/a (real install in Phase 3) | `bunx create-checkstack-plugin widget` → `bun install && bun run dev` by hand once |
| 3 | reuse `dev-internals.test.ts`, `dev-deps-resolver.test.ts`, `dev-frontend.test.ts` for fine-grained logic | the one end-to-end lane (§7.2 steps 1–8): boot Verdaccio + publish ~11 `@checkstack/*` + `create-checkstack-plugin` (retargeted `publish-packages.ts`, fallback rewrite-then-`npm publish`) → inject `resolveVersion`→Verdaccio → scaffold → `bun install` (registry-pinned) → `plugin-pack --bundle` (rewrite no-op) → boot dev server → `POST /api/widget/getItems`==200 + frontend Vite up; CI adds a Verdaccio publish step + `CHECKSTACK_SCAFFOLD_REGISTRY` / `BUN_CONFIG_REGISTRY` env + longer timeout | observe CI lane green on a PR |
| 4 | n/a | re-run §7 to validate doc commands | execute every command in `plugin-development.md` / `plugin-distribution.md` verbatim; Starlight build (`bun run --filter docs build`) clean |

Per `.agent/rules/testing.md`: TDD — write the engine/version-resolver
unit tests first. Per `.agent/rules/state-and-scale.md`: the scaffolder is
**stateless tooling** (no pod-local runtime state); the *generated* plugin
reads its `items` table directly (durable, globally readable) — no
scale-correctness concern introduced.

---

## 10. Changesets, versioning, references

- **Changesets required** (code/feature changes, per
  `.agent/rules/changesets.md`):
  - Phase 1: `@checkstack/scripts` **minor** (new engine export + internal
    refactor; `plugin-pack` now imports shared rewrite — note "no behavior
    change" in the changeset body).
  - Phase 2: `create-checkstack-plugin` **minor** (new package).
  - Phase 3: test-only → optional patch on touched prod packages; if a CI
    workflow file is the only change, no changeset (per the rule's "CI/build
    config" exclusion).
  - Phase 4: docs-only edits need **no** changeset; the `cli.ts`/
    `dev-server.ts` help fix (D1) is a behavior/UX change → small patch on
    `@checkstack/scripts` or `@checkstack/dev-server`.
- **BETA rule:** never bump majors. Use **minor** + a `BREAKING CHANGES`
  note in the changeset body if anything is breaking (none expected here).
- **Project references:** after creating `core/create-checkstack-plugin`
  and adding any new `@checkstack/*` workspace deps, run
  `bun run typecheck:references:generate` and commit the tsconfig changes
  (`.agent/rules/typecheck.md`). Do NOT hand-edit `references` arrays.
- **Docs-in-same-PR rule** (`.agent/rules/architecture.md`): the new
  scaffolder is a new tooling surface → docs ship in the Phase 4 PR (or
  alongside Phase 2 if shipped together).

---

## 11. Watch-outs / non-obvious things

- **Never emit `workspace:*` in standalone output** — install rejects it
  (`compatibility-checker.ts:85-94`). The engine's standalone path MUST
  rewrite every range; fail loud if `resolveVersion` can't resolve one.
- **Versions are per-package, not lockstepped** (§3.6). Resolve each
  `@checkstack/*` dep independently; a single hardcoded version will drift.
- **`plugin-pack --bundle` from a standalone repo** still calls
  `buildWorkspaceMap` (`plugin-pack.ts:79`); with a local `workspaces`
  root it finds siblings but rewrites nothing (concrete versions). The
  test asserts this no-op (want #4a) — don't "fix" it.
- **Frontend dev needs `@checkstack/frontend` resolvable** from the
  plugin's node_modules (`dev-frontend.ts:50-52`) — the frontend template
  already devDepends it (`frontend/package.json.hbs:36`); keep it.
- **The dev server is `@checkstack/dev-server` (bin `checkstack-dev`)**, a
  separate package from `@checkstack/scripts`. The `checkstack-scripts dev`
  help string (`dev-server.ts:168`) is stale — D1.
- **`bun create checkstack-plugin`** resolves the unscoped
  `create-checkstack-plugin` — the package name is load-bearing for the
  ergonomic command; don't scope it.
- **Local-registry publish is heavy** — one e2e test only (§7 NOTE).
- **The release template path** is `docs/public/examples/plugin-release.yml`,
  not `docs/examples/` (the issue's path is imprecise) — and its header
  comment cites a legacy doc path (D4).
