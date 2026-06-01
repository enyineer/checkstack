# Auto-generated, version-pinned `@checkstack/sdk` + editor type injection

> **Status:** planned (design locked 2026-06-01, not started)
> **Branch:** off `main`
> **Issue:** #249
> **Goal:** Auto-generate a typed Checkstack SDK from the platform's
> source-of-truth API surface (all 21 plugin oRPC contracts + the
> script-authoring helpers), publish it to npm with its version pinned to the
> platform release version, and feed its `.d.ts` into the in-app TypeScript
> script editor so script authors get real autocomplete against the SDK instead
> of hand-rolled ambient declarations.

Self-contained handoff. Pick up from this document alone. Every current-state
claim carries a `file:line` anchor (verified 2026-06-01) so the implementer
never has to guess.

---

## 1. Why

- **The editor's "SDK" is a lie.** `defineHealthCheck` / `defineIntegration` and
  the `@checkstack/healthcheck` / `@checkstack/integration` "modules" exist only
  as ambient `declare module` strings injected into Monaco
  (`core/ui/src/components/CodeEditor/scriptContext.ts:136-139` and
  `:204-207`). There is no real, installable, versioned package backing them.
- **The runtime fakes it too.** At execution time the import is rewritten to a
  throwaway temp `_helpers.mjs` whose body is a one-line identity function
  (`core/backend-api/src/esm-script-runner.ts:231-235`, rewrite at
  `:197-225`, wired by the runners at
  `plugins/healthcheck-script-backend/src/inline-script-collector.ts:98-99` and
  `plugins/integration-script-backend/src/automations.ts:445-446`). A script
  author who copies `import { defineHealthCheck } from "@checkstack/healthcheck"`
  into an external IDE gets a module-not-found error.
- **Nothing is generated from the contracts.** The 21 per-plugin oRPC contracts
  (`core/**/src/rpc-contract.ts`) are the real API surface, but no typed client
  is published for external consumers, and the editor types are hand-authored
  strings that drift from the contracts.
- **The plumbing to fix all three already exists, just disconnected.** JSON
  Schema → TS (`generateTypeDefinitions.ts:107`), version-keyed cacheable
  `.d.ts` HTTP delivery (`type-acquisition-route.ts`), `addExtraLib` injection
  (`TypefoxEditor.tsx:443`), and a release-version tracker
  (`@checkstack/release`, `core/release/package.json:3` = `0.93.0`). This
  feature wires them into one **generate → publish → inject** pipeline.

---

## 2. Locked decisions

These resolve issue #249's open questions. Rationale per item; **user sign-off
flagged** where the decision changes externally-visible package names or scope.

1. **Package shape — DECIDED: umbrella `@checkstack/sdk` with subpath exports,
   with NO compat packages.** ✅ **MAINTAINER-DECIDED (sign-off resolved
   2026-06-01): rewrite every consumer of the bare names to the subpath
   form.**
   - One package, three subpaths:
     `@checkstack/sdk` (root: typed client + `InferClient` re-exports + the
     runtime client factory),
     `@checkstack/sdk/healthcheck` (`defineHealthCheck` + context/result types),
     `@checkstack/sdk/integration` (`defineIntegration` + context/result types).
   - The editor and runtime **hard-code the bare names** `@checkstack/healthcheck`
     and `@checkstack/integration` today. **All of those call sites are rewritten
     to the subpath form** `@checkstack/sdk/healthcheck` /
     `@checkstack/sdk/integration` — the full enumerated touch-point list is
     §6.4. The previously-considered thin compat re-export packages are
     **DROPPED** entirely: no `@checkstack/healthcheck` / `@checkstack/integration`
     packages are published.
   - **This is a BREAKING change to the script-author import surface.** Any
     externally-authored or in-repo script using
     `import { defineHealthCheck } from "@checkstack/healthcheck"` must migrate to
     `import { defineHealthCheck } from "@checkstack/sdk/healthcheck"` (same for
     integration). Documented in the changeset BREAKING note (§10) and the docs
     (§8 Phase 4); in-repo scripts/docs/templates are migrated in the same PR
     (§6.4). The runtime helper-function NAMES (`defineHealthCheck`,
     `defineIntegration`) are unchanged — only the module specifier changes.
   - **Rationale (maintainer):** one canonical package, no parallel name surface
     to keep in sync, no risk of a compat package drifting from the umbrella. The
     subpath form is the single supported way to import helpers, in-app and
     externally. The one-time break is acceptable in BETA and is mechanically
     simple (specifier string swap; §6.4).
   - **Load-bearing consequence:** because external `npm install` resolves
     `@checkstack/sdk/healthcheck` via the package's `exports` map under
     `node16`/`nodenext`/`bundler` resolution, the exports map MUST ship a
     **per-subpath `.d.ts`** (not one shared ambient file) for the `types`
     condition. See §4.1 (no longer a flagged caveat — now a hard requirement)
     and the §9 Phase-1 resolution test.

2. **Runtime client vs types-only for v1 — DECIDED/LOCKED: ship TYPES + a THIN
   RUNTIME CLIENT, in addition to the helper identity-runtime.**
   - The script helpers (`defineHealthCheck`, `defineIntegration`) MUST have a
     runtime body because users `export default defineHealthCheck(...)` and the
     function must exist when executed outside the in-app rewrite. Their body is
     the same identity function the rewrite injects today
     (`esm-script-runner.ts:234`) — behaviorally compatible (§6.3).
   - The full typed oRPC **client** ships as **types + a thin runtime factory**
     `createCheckstackClient({ baseUrl, headers })` built on `@orpc/client`'s
     `createORPCClient` over the existing REST/OpenAPI surface
     (`api-router.ts:291-349`, `/rest/:pluginId/*`). This is genuinely useful and
     cheap (oRPC already generates the client from the contract). **Rationale:**
     "types-only" would leave the issue's stated external-API-consumer use case
     half-done; the runtime factory is a few lines over oRPC. The helpers being
     real runtime is non-negotiable for external authoring. **This decision is
     LOCKED — v1 ships the runtime client.**

3. **Versioning mechanics — DECIDED: pre-publish stamp; the single
   `@checkstack/sdk` package is excluded from changesets.**
   - `@checkstack/sdk` is NOT in any changeset and is NOT bumped by
     `changeset version`. Its `package.json` `version` is **stamped to the
     `@checkstack/release` version by `scripts/generate-sdk.ts`** as a pre-publish
     codegen step. **Rationale:** issue requires `sdk version === release
     version`; changesets bumps each package independently, which would
     immediately desync. The release tracker is already force-injected on every
     release (`inject-release.ts:122`), so reading it is the single source of
     truth. (With the compat packages dropped, there is exactly ONE package to
     stamp.)
   - **Rejected:** changeset fixed-group (`.changeset/config.json:11` `fixed:[]`)
     with `@checkstack/release` — a fixed group still bumps via changeset math,
     not "equals release", and the SDK has no hand-authored changesets to drive a
     bump. Stamping is exact.

4. **Editor types fetched-live vs bundled — DECIDED: fetched-live over a
   version-keyed, HTTP-cacheable route mirroring the script-packages ATA
   handler.** The route is keyed by the running release version, served with
   `Cache-Control: private, max-age=1y, immutable` (mirror
   `type-acquisition-route.ts:175`), so a deployment upgrade changes the key and
   the editor never serves stale SDK types. **Rationale:** a bundled snapshot
   freezes SDK types at frontend-build time and drifts from the running backend
   the instant a contract changes; the version-keyed live route always matches
   the deployed contracts and reuses a proven, cache-correct pattern. The
   generated `.d.ts` is still committed (so external `npm install` works and CI
   can diff it), but the editor reads the **running** version's copy.

---

## 3. Machinery to reuse (DO NOT reinvent)

### 3.1 Contract → client type inference
- **`createClientDefinition(contract, metadata)`** —
  `core/common/src/client-definition.ts:90-98`. Every plugin's contract flows
  through this; it returns `ClientDefinition<TContract>` carrying the contract
  as a phantom type (`__contractType`, `:29`).
- **`InferClient<T>`** — `client-definition.ts:41-42` →
  `ContractRouterClient<C>` from `@orpc/contract`. This is the exact type the
  generated client root must expose per plugin.
- The 21 `*Api` definitions live one-per-plugin in
  `core/<plugin>-common/src/rpc-contract.ts` (e.g.
  `healthcheck-common/src/rpc-contract.ts:1` imports `createClientDefinition`,
  `proc`). Each exports a `<Name>Api` (e.g. `HealthCheckApi`). Full list (21):
  `announcement, anomaly, auth, automation, cache, catalog, dependency, gitops,
  healthcheck, incident, integration, maintenance, notification, pluginmanager,
  queue, satellite, script-packages, secrets, slo, theme, tips`.

### 3.2 Root aggregation (server side, reference only)
- `core/backend/src/plugin-manager/api-router.ts:172-180` builds
  `rootRpcRouter[pluginId] = router` and serves it as RPC (`/api/:pluginId/*`,
  `:354-359`) and REST/OpenAPI (`/rest/:pluginId/*`, `:364-369`). The SDK client
  shape mirrors this `{ [pluginId]: InferClient<XApi> }` nesting.

### 3.3 JSON Schema → TypeScript
- **`jsonSchemaToTypeScript(schema, indent)`** —
  `generateTypeDefinitions.ts:107-162`. Handles objects, arrays, enums,
  primitives, `Record`. Reused by the SDK codegen for `context.config` /
  `context.event.payload` of the helper types.

### 3.4 Existing helper-type builders (the strings to externalize)
- `scriptContext.ts:72-141` `buildHealthCheckTypes(configType)` and
  `:152-209` `buildIntegrationTypes(payloadType)` are the canonical helper
  declarations. The SDK codegen lifts the **generic** (`Record<string,
  unknown>`) variant of these into the published `.d.ts`; the per-schema variant
  stays in `scriptContext.ts` for the in-editor, schema-narrowed experience.
  Both are exported on `_internals` (`scriptContext.ts:540-541`) — reuse them so
  there is ONE source for the helper text.

### 3.5 Version-keyed cacheable `.d.ts` delivery
- **Raw HTTP handler pattern** — `type-acquisition-route.ts:67-167`. Authn +
  global read-access check (`:52-61`), path keyed by an install identity
  (`lockfileHash`), `Cache-Control: private, max-age=1y, immutable`
  (`:169-178`), stale-key → `409` (`:132-138`). The SDK route mirrors this,
  keyed by **release version** instead of lockfile hash.
- **Shared path contract lives in a `-common` package** —
  `core/script-packages-common/src/type-acquisition.ts:21-70`:
  `TYPE_ACQUISITION_PATH_PREFIX`, `buildTypeAcquisitionPath`,
  `parseTypeAcquisitionPath`. This module is the canonical pattern: the pure
  path-build/parse logic lives in the `*-common` package so BOTH the backend
  raw handler (`script-packages-backend/src/type-acquisition-route.ts` imports
  it, verified) AND the frontend ATA resolver import the same functions and can
  never drift. The SDK's analogous module MUST live in a `-common` package for
  the same reason — see §6.1 for exactly which one.

### 3.6 Monaco injection
- **`addExtraLib(content, uri)`** — singleton TS/JS language-service defaults;
  injected per-editor for the ambient `context` types at `TypefoxEditor.tsx:443`
  (`typeDefinitions` prop, `:313`), and for acquired package closures at
  `:119-130` (mounted at `file:///<path>`). The SDK `.d.ts` mounts the same way:
  `file:///node_modules/@checkstack/sdk/...`.
- **ATA reset on install identity change** — `TypefoxEditor.tsx:96-112`
  (`acquiredSpecifiers` / `acquireResetKey`). The SDK injection follows the same
  reset-on-version-change discipline so an upgrade refreshes the libs.

### 3.7 Runtime import rewrite (must stay compatible)
- `esm-script-runner.ts:197-225` `rewriteHelperImports` + `:231-235`
  `buildHelperSource`. The injected runtime body is
  `export function ${fn}(value) { return value; }`. The published SDK helper's
  runtime body MUST be the same identity function so a script that imports the
  real package behaves identically to one that gets the rewrite (§6.3). The
  `helperModuleName` the callers pass changes from the bare names to the subpath
  form (§6.4); the rewrite logic itself (regex-escaping the specifier,
  `:206-209`) is specifier-agnostic and needs no change.

### 3.8 Release / publish flow
- `package.json:25` `version-packages` = `inject-release.ts && changeset
  version`; `package.json:26` `publish-packages` = `publish-packages.ts`.
- `inject-release.ts:122` force-adds `@checkstack/release` (minor) to a pending
  changeset every release → release version always bumps.
- `publish-packages.ts:43-62` discovers packages by scanning `core/` + `plugins/`
  dirs (skipping `_`-prefixed), `:94-116` computes status vs npm,
  `:163-225` `publishPackage` runs `bun publish --access public` + tags
  `name@version` + pushes (`:353-358`). Private packages are skipped
  (`:101-103`, `determinePackageStatus` → `"private"`).
- `.github/workflows/release.yml:45-50` — changesets action runs
  `version: bun run version-packages`, `publish: bun run
  scripts/publish-packages.ts`.

### 3.9 Existing codegen-script conventions
- `core/ui/scripts/generate-stdlib-types.ts` — emits a JSON map of virtual
  `.d.ts` paths into `generated/` (`:81-93`), run via `generate:monaco-types`
  (`core/ui/package.json:71`). The SDK codegen follows the same shape: read
  source-of-truth, emit committed artifacts.
- `scripts/generate-tsconfig-references.ts` — root-level codegen sibling
  (`package.json:15-16`).

---

## 4. The `@checkstack/sdk` package — emitted shape

Codegen target directory: `core/sdk/` (ONE new workspace package, picked up by
`publish-packages.ts` dir scan at `:48-62`). **No compat packages** — the
maintainer-decided subpath rewrite (§2.1) means `@checkstack/sdk` is the only
published artifact.

### 4.1 `core/sdk/` layout (generated + committed)

```
core/sdk/
  package.json            # name "@checkstack/sdk", version STAMPED (§7)
  src/
    index.ts              # re-export: createCheckstackClient, types, helpers
    client.ts             # GENERATED typed client factory + per-plugin types
    contracts.ts          # GENERATED: re-export of every *Api ClientDefinition
    healthcheck.ts        # defineHealthCheck + HealthCheckScript{Context,Result}
    integration.ts        # defineIntegration + IntegrationScript{Context,Result}
  generated/
    index.d.ts            # GENERATED: root subpath surface (client + types)
    healthcheck.d.ts      # GENERATED: ./healthcheck subpath surface
    integration.d.ts      # GENERATED: ./integration subpath surface
    editor-bundle.d.ts    # GENERATED: combined ambient .d.ts for the EDITOR only
  tsconfig.json           # extends @checkstack/tsconfig/common.json
```

`package.json` exports map (each subpath's `types` points at ITS OWN `.d.ts`):

```json
{
  "name": "@checkstack/sdk",
  "version": "0.0.0-STAMPED",
  "exports": {
    ".":              { "types": "./generated/index.d.ts",       "default": "./src/index.ts" },
    "./healthcheck":  { "types": "./generated/healthcheck.d.ts", "default": "./src/healthcheck.ts" },
    "./integration":  { "types": "./generated/integration.d.ts", "default": "./src/integration.ts" }
  }
}
```

> **Per-subpath `.d.ts` is LOAD-BEARING (not optional).** External `npm install`
> resolves `@checkstack/sdk/healthcheck` through the `exports` map under
> `node16`/`nodenext`/`bundler` module resolution, which expects each subpath's
> `types` to point at a `.d.ts` whose top-level exports ARE that subpath's
> surface. A single shared ambient file would resolve the subpath but expose the
> wrong / all exports. So the codegen emits THREE per-subpath declaration files
> (`generated/index.d.ts`, `generated/healthcheck.d.ts`,
> `generated/integration.d.ts`) for the `types` conditions, PLUS a separate
> combined ambient `generated/editor-bundle.d.ts` (the `declare module
> "@checkstack/sdk" / "@checkstack/sdk/healthcheck" / "@checkstack/sdk/integration"`
> blocks + the `declare function defineHealthCheck/defineIntegration` globals)
> that ONLY the version-keyed editor route serves and Monaco mounts (§6.1/§6.2).
> The editor never resolves through `exports`; it mounts the ambient bundle
> directly. **Phase 1 ships a `tsc`-`nodenext` fixture-consumer resolution test
> (§9) that imports all three subpaths and asserts each resolves to exactly its
> own surface** — this is now a hard acceptance criterion, not a caveat.

### 4.2 The typed client (`client.ts` / `contracts.ts`)

`contracts.ts` re-exports the 21 `*Api` `ClientDefinition`s from each
`@checkstack/<plugin>-common`. `client.ts` derives the root client type by
applying `InferClient` per plugin (`client-definition.ts:41`) and provides the
runtime factory:

```ts
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import type { InferClient } from "@checkstack/common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
// ...21 imports

export interface CheckstackClient {
  healthcheck: InferClient<typeof HealthCheckApi>;
  automation:  InferClient<typeof AutomationApi>;
  // ...one entry per plugin id, mirroring api-router.ts:176
}

export function createCheckstackClient(opts: {
  baseUrl: string;                       // e.g. https://host/rest
  headers?: Record<string, string>;      // API-key / bearer auth
}): CheckstackClient { /* createORPCClient over OpenAPILink, per pluginId prefix */ }
```

> The client is a **types-first** artifact. The runtime factory is small glue
> over oRPC's own client; the value is the `CheckstackClient` type and the
> per-plugin `InferClient` shapes, which are exactly the contracts the running
> backend serves at `/rest/:pluginId/*` (`api-router.ts:306-348`).

### 4.3 The script helpers (`healthcheck.ts` / `integration.ts`)

Runtime + types in one. Runtime is the identity function; types come from
reusing `scriptContext.ts` `_internals.buildHealthCheckTypes("Record<string,
unknown>")` / `buildIntegrationTypes("Record<string, unknown>")` so there is one
source of truth:

```ts
// core/sdk/src/healthcheck.ts
export interface HealthCheckScriptResult { success: boolean; message?: string; value?: number; }
export interface HealthCheckScriptContext { /* generic config: Record<string, unknown>, check, system */ }
export function defineHealthCheck<T extends ...>(value: T): T { return value; }
```

The published `generated/editor-bundle.d.ts` is the AMBIENT bundle the editor
mounts: it declares `module "@checkstack/sdk"`, `module
"@checkstack/sdk/healthcheck"`, `module "@checkstack/sdk/integration"`, plus the
global `declare function defineHealthCheck` / `defineIntegration` (mirroring
`scriptContext.ts:126-139`, `:192-207`) so no-import autocomplete still works.
It declares ONLY the subpath module names — the dropped bare names
(`@checkstack/healthcheck` / `@checkstack/integration`) are NOT declared, so the
editor flags an old bare-name import as unresolved, surfacing the migration to
the author. The per-subpath `generated/*.d.ts` files (§4.1) are the
`exports`-resolved declarations for external `npm install`; the editor bundle is
separate and editor-only.

### 4.4 No compat packages

The maintainer dropped the thin compat packages (§2.1). `@checkstack/sdk` is the
only published package. The bare names `@checkstack/healthcheck` /
`@checkstack/integration` are NOT published and NOT declared anywhere — every
consumer is rewritten to the subpath form (§6.4).

---

## 5. `scripts/generate-sdk.ts` — codegen design

Sibling to `scripts/generate-tsconfig-references.ts`. Wired as
`package.json` script `generate:sdk` and into `version-packages` AFTER
`changeset version` (so the stamp reads the just-bumped release version; see §7.1
for ordering and the §7.1.1 failure mode).

### 5.1 Inputs (source of truth)
1. The 21 `*Api` `ClientDefinition`s — imported from each
   `@checkstack/<plugin>-common` (the plugin id list is enumerable from the
   `core/*-common` dirs that export an `*Api`).
2. The helper type builders — `scriptContext.ts` `_internals` (§3.4).
3. The release version — `core/release/package.json` `version` (`:3`).

### 5.2 Steps
1. **Emit `contracts.ts` + `client.ts`** — generate the per-plugin import block
   and the `CheckstackClient` interface by enumerating the plugin ids (one
   `InferClient<typeof XApi>` per id). The client *type* is structural; no zod
   walking needed because `InferClient` already does the contract→client
   inference at the type level — the generated file just re-exports and assembles.
2. **Emit `healthcheck.ts` / `integration.ts`** — runtime identity helpers +
   the generic-config/payload type declarations (reuse `_internals` builders
   with `"Record<string, unknown>"`).
3. **Emit the per-subpath declaration files** —
   `generated/index.d.ts` (root: client + `CheckstackClient` + `InferClient`
   re-exports), `generated/healthcheck.d.ts`, `generated/integration.d.ts`. These
   are the `exports`-`types` targets for external `npm install` (§4.1).
4. **Emit `generated/editor-bundle.d.ts`** — concatenate the ambient `declare
   module "@checkstack/sdk[/sub]"` + global `declare function` declarations
   (subpath names ONLY; no bare names). This is the EDITOR-only artifact the
   version-keyed HTTP route serves and Monaco mounts.
5. **Stamp version** — write `core/release/package.json` `version` into
   `core/sdk/package.json` (the ONLY package; no compat packages to stamp).
6. **`--check` mode** — like `generate-tsconfig-references.ts --check`
   (`package.json:16`): regenerate to a temp buffer and diff against the
   committed files; nonzero exit on drift. CI runs this so a contract change
   without a regenerated SDK fails (mirrors `typecheck:references:check`).

### 5.3 What the codegen does NOT do
- It does not re-derive procedure shapes by walking zod schemas; `InferClient`
  already carries the full type. zod→TS (`jsonSchemaToTypeScript`) is used ONLY
  for the helper `context` blocks, which are the only place a JSON Schema (not a
  contract type) is the input.

---

## 6. Editor type-injection design

### 6.1 New version-keyed HTTP route (backend) + where the path module lives
Add an SDK-types raw handler mirroring `type-acquisition-route.ts`. **Route
home — DECIDED (resolves open-item 4): reuse `script-packages-backend`.** The
editor already talks to that plugin for ATA, the cacheable-`.d.ts` pattern is
already proven there, and reusing it avoids a 4th wiring location and a new
plugin in the dependency graph. The handler is registered the same way
(`rpc.registerHttpHandler`) alongside the existing type-closure handler.

**Path module — DECIDED: it lives in `core/script-packages-common/src/`**, a
NEW sibling file `sdk-types-path.ts` next to the existing
`type-acquisition.ts:21-70`. This is the SAME `-common` package the
type-acquisition path module lives in, so the SDK route does not invent a 4th
wiring location: the backend handler (in `script-packages-backend`) and the
frontend resolver (in `core/ui`) both import the pure build/parse functions
from `@checkstack/script-packages-common`, exactly as they do for the existing
type-acquisition path (§3.5). Do NOT put these functions in
`script-packages-backend` (backend-only, the frontend can't import it) and do
NOT create a new package. Path keyed by release version:

```
/api/script-packages/sdk-types/:releaseVersion   →  { files: [{ path, content }] }
```

- Pure path module `core/script-packages-common/src/sdk-types-path.ts` (mirror
  `type-acquisition.ts`): `SDK_TYPES_PATH_PREFIX = "/sdk-types"`,
  `buildSdkTypesPath({ releaseVersion })`, `parseSdkTypesPath(afterPrefix)`.
  Exported from the package's `index.ts` like the existing path helpers.
- Handler: authn + global read check (reuse the `hasReadAccess` shape,
  `type-acquisition-route.ts:52-61`); if `:releaseVersion !== runningVersion`
  → `409` (stale) so the client refetches; else return the committed
  `core/sdk/generated/editor-bundle.d.ts` content with `Cache-Control: private,
  max-age=1y, immutable` (`type-acquisition-route.ts:175`). It serves the
  EDITOR bundle (combined ambient declarations), not the per-subpath
  `exports`-resolved files.
- The running version is read from `@checkstack/release` at runtime (the value
  baked into the deployed image; `release.yml:119-125` extracts it for Docker).

### 6.2 Frontend injection
- A new effect (sibling to the ATA registry, `TypefoxEditor.tsx:96-165`) fetches
  `buildSdkTypesPath({ releaseVersion })` once per session, then
  `registerAcquiredFiles`-style mounts each file at
  `file:///node_modules/@checkstack/sdk/...` via `addExtraLib` on both
  `typescriptDefaults` and `javascriptDefaults` (`TypefoxEditor.tsx:126-127`).
- Reset on version change reuses the `syncAcquireResetKey` discipline
  (`:107-112`) with `releaseVersion` as the reset key, so a deployment upgrade
  refreshes the SDK libs (never stale).
- `scriptContext.ts` keeps emitting the **schema-narrowed** `context.config` /
  `context.event.payload` block (its raison d'être — per-collector/per-event
  typing). The generic `@checkstack/healthcheck` / `@checkstack/integration`
  ambient `declare module` blocks (`scriptContext.ts:136-139`, `:204-207`) are
  REMOVED, and the editor now resolves the subpath module names from the
  injected `editor-bundle.d.ts`. Net: schema narrowing stays local; the
  package-resolving module declarations come from the one published source under
  the subpath names. (The bare-name removal here is one of the §6.4
  touch-points.)

### 6.3 Runtime compatibility (helper behavior unchanged; only the specifier changes)
The in-app runner keeps its rewrite (`esm-script-runner.ts:197-225`): scripts
run in-app still get the temp `_helpers.mjs` identity function — the runtime
BODY is unchanged. The published SDK helper is the SAME identity function
(§3.7), so a script authored in an external IDE against
`@checkstack/sdk/healthcheck` behaves identically when pasted in-app and
rewritten. The ONLY change to the runner callers is the `helperModuleName` they
pass: it moves from the bare names to the subpath names (enumerated in §6.4). No
change to the rewrite logic itself (specifier-agnostic, §3.7).

### 6.4 Bare-name → subpath rewrite: enumerated touch-points (BREAKING)
Every consumer of the bare names is rewritten to the subpath form. Verified
inventory (anchors at the time of writing; re-grep before editing):

**Editor ambient declarations (the module names Monaco resolves):**
- `core/ui/src/components/CodeEditor/scriptContext.ts:136` — `declare module
  "@checkstack/healthcheck"` block → REMOVED (now served by `editor-bundle.d.ts`
  under `@checkstack/sdk/healthcheck`); §6.2.
- `scriptContext.ts:204` — `declare module "@checkstack/integration"` block →
  REMOVED (served as `@checkstack/sdk/integration`).
- `scriptContext.ts:224` — doc-comment naming the bare import form → update to
  the subpath form.

**Runtime import-rewrite call sites (`helperModuleName` values):**
- `plugins/healthcheck-script-backend/src/inline-script-collector.ts:98` —
  `helperModuleName: "@checkstack/healthcheck"` → `"@checkstack/sdk/healthcheck"`.
  Also update the user-facing description string at `:119` (names the package).
- `plugins/integration-script-backend/src/automations.ts:445` —
  `helperModuleName: "@checkstack/integration"` → `"@checkstack/sdk/integration"`.
- `core/healthcheck-backend/src/collector-script-test.ts:196` —
  `helperModuleName: "@checkstack/healthcheck"` → subpath (the "test in UI" run
  path; same rewrite as the collector).
- `core/automation-backend/src/script-test.ts:233` —
  `helperModuleName: "@checkstack/integration"` → subpath (the integration
  "test in UI" run path).

**`esm-script-runner.ts` JSDoc examples (no behavior, keep docs honest):**
- `core/backend-api/src/esm-script-runner.ts:81` and `:83` — example
  `helperModuleName` / editor import in the JSDoc → subpath form.

**Tests that assert the bare name (update expectations alongside the rewrite):**
- `core/ui/src/components/CodeEditor/scriptContext.test.ts:13-14`, `:148` —
  assert `declare module "@checkstack/healthcheck"` / `integration"` →
  assert the subpath module name (or assert the block is no longer emitted by
  `scriptContext`, per §6.2).
- `core/backend-api/src/esm-script-runner.test.ts:87-88`, `:97`, `:105-106`,
  `:117`, `:125-126`, `:130`, `:145`, `:156-157` — bare-name imports + expected
  `helperModuleName` → subpath form.
- `core/healthcheck-backend/src/collector-script-test.test.ts:97` and
  `core/automation-backend/src/script-test.test.ts:104` — assert the rewritten
  `helperModuleName` → subpath.
- `plugins/healthcheck-script-backend/src/inline-script-collector.test.ts:143-151`
  and `plugins/integration-script-backend/src/automations.test.ts:512` — bare
  names in script fixtures + assertion → subpath.

**Docs + in-repo example scripts (migrate verbatim):**
- `docs/src/content/docs/user-guide/reference/script-health-checks.md:95`, `:130`
  — `import ... from "@checkstack/healthcheck"` → `@checkstack/sdk/healthcheck`,
  with a BREAKING migration note.
- `docs/src/content/docs/user-guide/guides/test-scripts-in-the-ui.md` — update
  any helper-import mention to the subpath form (verify on edit).

**Starter templates:** the in-editor starters use the GLOBAL helper form (no
import) — `HEALTHCHECK_INLINE_TS_STARTER` (`scriptContext.ts:227`) and
`INTEGRATION_INLINE_TS_STARTER` (`:281`) — so they need NO import-string change.
If any are later changed to the named-import form, they MUST use the subpath.

**Out of scope (do NOT touch):** historical `CHANGELOG.md` entries
(`core/ui/CHANGELOG.md:627`, `core/healthcheck-frontend/CHANGELOG.md:408`,
`core/integration-frontend/CHANGELOG.md:268`,
`plugins/healthcheck-script-backend/CHANGELOG.md:229`) and built artifacts
(`core/frontend/dist/...`) — these are immutable history / generated output.

---

## 7. Versioning + publish wiring

### 7.1 Stamp ordering
`version-packages` (`package.json:25`) becomes:
```
bun run scripts/inject-release.ts && changeset version && bun run scripts/generate-sdk.ts
```
`generate-sdk.ts` runs AFTER `changeset version` so it reads the
**just-bumped** `core/release/package.json` version (changeset version applies
the injected `@checkstack/release` minor bump first), then stamps the SDK
packages to match. The regenerated SDK files are committed onto the
`changeset-release/main` branch by the changesets action (`release.yml:45-50`)
alongside the version bumps.

#### 7.1.1 Failure mode: release version only advances when SOME changeset is consumed
`inject-release.ts:98-122` injects the `@checkstack/release` bump into the
**first changeset that lacks a release marker** — it does NOT create a changeset
when none exist (`:75-78` returns early on zero pending changesets). So
`@checkstack/release` advances **only if at least one package has a pending
changeset** that `changeset version` consumes. This creates a silent gap for the
SDK:

> **The gap:** A `*-common` contract changes (so the generated SDK surface
> changes), but the author writes NO changeset. `version-packages` finds no
> pending changesets → `@checkstack/release` is NOT bumped → `generate-sdk.ts`
> re-reads the **unchanged** release version → the stamped SDK version equals
> what's already on npm → `publish-packages.ts` classifies it `up-to-date`
> (`determinePackageStatus`, `:107`) and **skips it**. The published SDK silently
> drifts from the deployed contracts — the exact failure this feature exists to
> prevent.

**Resolution — make it a hard rule + a CI guard:** any change to a generated
SDK input surface (i.e. ANY `core/*-common/src/rpc-contract.ts` or the helper
builders in `scriptContext.ts`) MUST carry a changeset on the underlying
`-common` package (or another platform package). This is already the norm per
`.agent/rules/changesets.md` (API changes require a changeset), so the SDK adds
no new author burden — it only makes the consequence explicit. Because such a
changeset always exists, `inject-release.ts` always has a changeset to inject
the release bump into, so `@checkstack/release` always advances, the stamp
always increments, and the SDK always republishes. To enforce it mechanically,
the Phase-1 `generate-sdk.ts --check` CI job ALSO fails when the regenerated
SDK declaration files differ from the committed copies with NO pending changeset
present — i.e. SDK drift without a changeset is a CI error, not a silent skip.
This reconciles §7.1 (stamp after `changeset version`), §3.8 (release always
bumps — true precisely *because* every SDK-affecting change carries a
changeset), and §7.3 (no changeset may name `@checkstack/sdk` itself — the
changeset is on the `-common`/platform package, never on the SDK).

### 7.2 Publish
`publish-packages.ts` already scans `core/` (`:48`), so `core/sdk` is
auto-discovered. It publishes via `bun publish --access public` (`:205`) when
its stamped version is ahead of npm (`determinePackageStatus`, `:94-116`). No
publish-script change needed — `@checkstack/sdk` is NOT `private` (unlike
`@checkstack/release`, `core/release/package.json:5`), so it is not skipped.

### 7.3 `@checkstack/sdk` MUST NOT be in changesets
Because the version is stamped, never let a hand-written changeset reference
`@checkstack/sdk` — a changeset bump would fight the stamp. Add a guard to
`generate-sdk.ts --check` (or a tiny lint in `inject-release.ts`) that fails if
a pending changeset names `@checkstack/sdk`. **Document this in the changeset
README.**

---

## 8. Phasing (each phase shippable)

### Phase 1 — Codegen + committed SDK package (no publish, no editor change)
- New `scripts/generate-sdk.ts` (+ `generate:sdk` script). Emit `core/sdk/*`
  (ONE package: `src/`, per-subpath `generated/*.d.ts`, the editor
  `generated/editor-bundle.d.ts`, exports map) with version stamped from
  `@checkstack/release`.
- Add `--check` mode + CI job (mirror `typecheck:references:check`), including
  the SDK-drift-without-changeset guard (§7.1.1).
- Verify the per-subpath `exports`-`types` resolution with a `tsc`/`nodenext`
  fixture consumer (§4.1, §9) — drives the per-subpath `.d.ts` shape.
- Run `bun run typecheck:references:generate` (1 new workspace package; `core/sdk`
  deps on all 21 `*-common`). Commit tsconfig changes.
- **Ships:** a real, installable-from-source typed client + helpers; CI guards
  drift. Nothing published yet.

### Phase 2 — Publish wiring (version = release version)
- Extend `version-packages` to run `generate-sdk.ts` after `changeset version`
  (§7.1). Verify `publish-packages.ts` discovers + publishes `@checkstack/sdk`
  (no code change expected; add a `publish-packages.test.ts` case asserting the
  SDK package with a stamped-ahead version is classified `update`/`new`).
- Add the `@checkstack/sdk`-in-changeset guard (§7.3).
- **Ships:** `@checkstack/sdk@<release>` on npm, pinned to the platform release.

### Phase 3 — Bare-name → subpath rewrite (BREAKING) + editor live injection
- **Rewrite every bare-name consumer to the subpath form** — all touch-points in
  §6.4: editor ambient blocks removed (`scriptContext.ts:136`, `:204`), runtime
  `helperModuleName` call sites (`inline-script-collector.ts:98`,
  `automations.ts:445`, `collector-script-test.ts:196`, `script-test.ts:233`),
  JSDoc examples, and all the asserting tests. This is the BREAKING change to the
  script-author import surface.
- New version-keyed `/api/script-packages/sdk-types/:releaseVersion` raw handler
  in `script-packages-backend` + pure path module
  `core/script-packages-common/src/sdk-types-path.ts` (§6.1). Serves committed
  `generated/editor-bundle.d.ts`.
- Frontend fetch + `addExtraLib` mount + reset-on-version effect (§6.2).
- **Ships:** editor autocomplete backed by the published `@checkstack/sdk` under
  the subpath names, never stale after upgrade; bare-name imports now error in
  the editor, surfacing the migration.

### Phase 4 — Docs + in-repo migration
- New developer-guide page `docs/src/content/docs/.../sdk.md` (generation,
  versioning, `npm install @checkstack/sdk@<release>`, client + helper usage via
  subpaths, external-IDE authoring). Starlight frontmatter (`title`,
  `description`).
- Migrate `docs/.../script-health-checks.md:95`,`:130` and
  `docs/.../test-scripts-in-the-ui.md` from the bare names to
  `@checkstack/sdk/healthcheck` / `@checkstack/sdk/integration`, with a clear
  **BREAKING migration note** (old `@checkstack/healthcheck` import → new
  subpath).

---

## 9. Per-phase test matrix

| Phase | Test | Asserts |
|---|---|---|
| 1 | `generate-sdk.test.ts` (bun) | codegen emits expected `CheckstackClient` keys = the 21 plugin ids; emits both helper runtime + types; stamps version from a fixture `release` pkg |
| 1 | `--check` drift test | mutating a generated file → nonzero exit |
| 1 | `tsc -b` (typecheck) | generated `client.ts` compiles; `CheckstackClient` resolves `InferClient` per plugin without `any` |
| 1 | subpath-exports resolution check (LOAD-BEARING, §4.1) | a fixture consumer importing `@checkstack/sdk`, `@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration` under `nodenext` resolves each subpath's `types` to exactly its own surface (asserts the per-subpath `.d.ts` is required + correct) |
| 1 | client runtime smoke test | `createCheckstackClient({ baseUrl })` builds a client; per-plugin keys present + typed (the LOCKED v1 runtime client, §2.2) |
| 2 | `publish-packages.test.ts` add-case | a stamped `@checkstack/sdk` ahead of npm → status `update`/`new`; private `@checkstack/release` still skipped |
| 2 | stamp test | after `generate-sdk.ts`, `core/sdk/package.json` version === `@checkstack/release` version (single package) |
| 2 | changeset-guard test | pending changeset naming `@checkstack/sdk` → `--check` fails |
| 2 | SDK-drift-without-changeset guard (§7.1.1) | regenerated SDK `.d.ts` differs from committed AND no pending changeset → `--check` fails (prevents the silent no-republish drift) |
| 3 | bare-name → subpath rewrite tests (§6.4) | every updated `helperModuleName`/ambient-block test asserts the SUBPATH name; no test still asserts a bare name; an old bare-name import is unresolved in the editor bundle |
| 3 | path module unit test (mirror `type-acquisition.test.ts`) | `buildSdkTypesPath`/`parseSdkTypesPath` round-trip; rejects traversal/empty |
| 3 | handler test | matching version → 200 + immutable cache header; mismatched → 409; unauthenticated → 401; no read access → 403 |
| 3 | helper-source parity test | published `defineHealthCheck`/`defineIntegration` runtime body === `esm-script-runner.ts:234` identity body (regression guard for §6.3) |
| 4 | docs build | Starlight builds; no missing-`title` warning; links resolve; no remaining bare-name imports in docs |

> Frontend `addExtraLib` injection glue is intentionally untested at unit level
> (no DOM/network in unit tests) — same rationale as the existing ATA glue
> (`TypefoxEditor.tsx:138`). The pure path + handler logic carry the coverage.

---

## 10. Cross-cutting (repo rules)

- **Changeset:** feature → `minor` bump for the touched *platform* packages
  (editor, the script runners, the new backend handler surface). **BETA: no
  major** — `minor` + an explicit **BREAKING CHANGES** note in the changeset
  body: the script-author import surface moves from `@checkstack/healthcheck` /
  `@checkstack/integration` to `@checkstack/sdk/healthcheck` /
  `@checkstack/sdk/integration` (§2.1, §6.4). `@checkstack/sdk` itself is
  version-stamped and excluded from the changeset (§7.3).
- **`typecheck:references:generate`:** REQUIRED in Phase 1 — ONE new workspace
  package (`core/sdk`) that adds workspace deps on all 21 `*-common` packages.
  Commit the regenerated `tsconfig.json` reference arrays (do NOT hand-edit, per
  `.agent/rules/typecheck.md`).
- **Lint/typecheck:** `bun run lint` + `bun run typecheck` after each phase. No
  `any` in generated `client.ts` — `InferClient` is fully typed; if a contract
  type leaks `unknown`, fix the contract, don't cast.
- **State & scale:** N/A — the SDK is stateless codegen + a stateless cacheable
  route. The route reads the running version (image-baked, identical on every
  pod), so reads are pod-consistent by construction.
- **Docs in same PR:** Phase 4 ships with the feature PR per
  `.agent/rules/architecture.md` (new core package + new platform contract =
  the SDK route).

---

## 11. Sign-off status (all resolved)

All prior open items are now decided. Recorded here for traceability:

1. ✅ **Package shape — MAINTAINER-DECIDED: subpath imports, no compat
   packages** (§2.1). Every bare-name consumer is rewritten to
   `@checkstack/sdk/{healthcheck,integration}` (§6.4); this is a BREAKING change
   to the script-author import surface, documented in docs + changeset.
2. ✅ **v1 runtime — LOCKED: ship types + the thin `createCheckstackClient`
   runtime client, plus the helper identity-runtime** (§2.2).
3. ✅ **npm name** — only `@checkstack/sdk` is published; confirm it is
   free/ownable under the org before first publish (single name, no compat
   names to reserve).
4. ✅ **SDK-types route home** — reuse `script-packages-backend` for the handler;
   the pure path module lives in `core/script-packages-common/src/sdk-types-path.ts`
   (same `-common` package as the existing `type-acquisition.ts`), shared by
   backend + frontend (§6.1).
