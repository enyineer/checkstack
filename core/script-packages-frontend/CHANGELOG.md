# @checkstack/script-packages-frontend

## 0.2.0

### Minor Changes

- b995afb: Fix two Script Packages bugs: empty-allowlist installs and read-only Advanced settings.

  - Install now: clicking "Install now" with no enabled packages no longer fails with ENOENT and an `error` install state. With an empty dependency set `bun install` writes no `bun.lock`, so the central resolver previously threw reading it. The resolver now short-circuits an empty (or all-disabled) allowlist to an empty resolved set, ending the install in `ready` at 0.0 MB with the deterministic empty-lockfile hash. No subprocess or registry call is made in that case.
  - Advanced settings: the registry URL, "ignore install scripts" toggle, write-only auth token, size guardrail thresholds, and active storage backend are now editable in the Script Packages settings page (previously read-only displays) and wired to the existing `setRegistryConfig` / `setSizeCapConfig` / `setStorageBackend` mutations. The auth-token field is write-only: a blank field leaves the stored token untouched, and a "Clear token" action removes it. The destructive blob-migration flow is unchanged.

  No schema or RPC contract changes.

- 270ef29: Declutter the Script Packages settings page with progressive disclosure.

  The page stacked five always-open cards. The common case now stays prominent - install state plus the allowed-packages allowlist - and the advanced configuration (registry & storage summary, storage backend, satellite sync) moves into a collapsed-by-default accordion. The destructive storage-migration trigger is now guarded by a confirmation modal so it is never a single stray click.

- 270ef29: Add garbage collection for script packages, reclaiming both shared blob storage and per-host disk.

  Two things accumulated and were never reclaimed; both are now collected with provably-safe guards (referenced-set + grace + lock / active-run protection - when in doubt, retain).

  - **Blob GC (Postgres / S3 reclamation).** A new `gcBlobs` RPC (manage-gated) plus a daily scheduled job prune content-addressed blobs no longer referenced by any retained lockfile manifest (the current desired hash plus the previous N, default 1, for rollback / in-flight reconciles). Candidates are only deleted after a grace window (default 24h, keyed on `created_at`), each blob's bytes are removed from its recorded backend before its index row, and the pass holds the installer-election advisory lock so it is mutually exclusive with installs and storage migrations. The settings UI surfaces last-run and total-reclaimed figures and a "Run cleanup now" action. The installer now records each successful manifest in a new `script_package_lockfile_history` table so the retained set is computable; GC state lives in `script_package_blob_gc_state`.
  - **Tree GC (per-host disk).** After a successful symlink flip, each host (core pod or satellite) sweeps its `trees/<lockfileHash>/` dirs, deleting non-current trees older than a grace window (default 1h). `current`'s target is never deleted. Active-run safety uses a conservative mtime-keyed grace window chosen to exceed the longest run timeout, since runs are throwaway subprocesses with no robust cross-process refcount - a tree only becomes eligible once no live run could still be pinned to it.

  Adds the `gcBlobs` / `getBlobGcState` RPCs, the `BlobGcSummary` / `BlobGcState` schemas, and two new Drizzle tables (`script_package_lockfile_history`, `script_package_blob_gc_state`).

- b995afb: Autocomplete the import specifier itself in script editors.

  Lazy type acquisition only loads a package's types once its name is already in the buffer, so while you were still typing the import specifier (`import {} from "lod"`) there were no suggestions - the lazy-ATA catch-22. Script editors now suggest installed package names directly in import-specifier position; selecting one (e.g. `lodash`) inserts the name, and the existing ATA loop then loads its `@types/lodash` closure so members complete.

  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `importablePackages?: string[]` prop and a dedicated Monaco completion provider (registered once per `typescript`/`javascript` language, scoped to the editor's model, disposed on unmount). It fires ONLY when the cursor is inside an import/require module-specifier string - detected by a new pure, unit-tested helper `importSpecifierCompletionContext(lineUpToCursor)` that handles `from "…"`, bare `import "…"`, `require("…")`, and dynamic `import("…")`, returns the partial specifier + the replace range, and returns null once the string is closed or outside an import. Items are `kind: Module`, insert the bare name without touching the quotes, and coexist with (do not replace) the TS worker's own completions. Trigger characters: `"`, `'`, and `/` (for scoped subpaths); manual invoke (Ctrl+Space) also works. A new pure helper `importablePackageNames` filters a raw manifest name list (excludes `@types/*`, dedupes, sorts).
  - `@checkstack/script-packages-frontend`: `useScriptPackageTypeAcquisition()` now also returns `importablePackages`, derived from the installed manifest (what is actually resolvable at runtime) with `@types/*` companions excluded - you import `lodash`, never `@types/lodash` (the `@types` package still backs the closure types).
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: pass `importablePackages` into `DynamicForm` alongside the existing `acquireTypes` wiring, so both the Run Script action editor and healthcheck collector editors get import-name completion.

  The completion list is plugin-agnostic in `@checkstack/ui` (the names are injected); it never fires outside import-string positions, so normal completions are unaffected.

- b995afb: Fix package IntelliSense in script editors: lazy Automatic Type Acquisition (ATA) with proper `@types/*` resolution.

  Script editors (automation "Run Script (TypeScript)" and healthcheck collectors) now provide real autocomplete for installed npm packages. Importing a package whose types live in DefinitelyTyped - e.g. `import { debounce } from "lodash"` (lodash ships no own types; `@types/lodash` does) - now yields member completions. Previously no package completions appeared at all.

  Root cause: the old rollup wrapped each package's raw, multi-file `.d.ts` (with `export =`, `export as namespace`, and triple-slash `/// <reference path>` chains) inside a single `declare module "<name>" { ... }`, which the TypeScript worker silently rejected, and it truncated large type sets (lodash is ~866 KB across ~700 files) at a 256 KB cap.

  The fix registers the REAL declaration files at their `node_modules/...` virtual paths and lets TypeScript's own NodeJs + `@types` resolution do the work:

  - `@checkstack/script-packages-backend`: replaced `rollupPackageTypes` with a tree-driven closure extractor (`resolvePackageTypeClosure`). Given a bare specifier, it resolves against the materialized tree - own types via `package.json` `types`/`typings`/`exports` (bundled-types packages like `zod`/`dayjs`), the `@types/<mangled>` companion when it exists (`lodash` -> `@types/lodash`, scoped `@babel/core` -> `@types/babel__core`), or both, or neither (graceful empty, never a throw). It follows `/// <reference path|types>` and relative imports, includes each package's `package.json`, leaves every file UNWRAPPED, and surfaces a `truncated` flag instead of silently capping. Served from a new raw, HTTP-cacheable route `GET /api/script-packages/types/:lockfileHash/:specifier` (`Cache-Control: private, max-age=1y, immutable`), auth-gated by `script-packages.read`.
  - `@checkstack/script-packages-common`: **BREAKING** - replaced the `listPackageTypes` RPC procedure and `PackageTypesSchema { name, version, dts }` with `PackageTypeClosureSchema` (a `{ path, content }` file-map plus `hasOwnTypes`/`hasAtTypes`/`notFound`/`truncated`) served over the cacheable HTTP route. Added a shared `buildTypeAcquisitionPath`/`parseTypeAcquisitionPath` path contract.
  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `acquireTypes` resolver + `acquireResetKey`. On debounced buffer change it parses bare `import`/`require` specifiers (pure, unit-tested) and lazily fetches + registers each NEW package's closure via `addExtraLib` at `file:///node_modules/...`, deduped by a shared acquired-set that resets when the install hash changes. Compiler options set `moduleResolution: NodeJs`, `baseUrl: "file:///"`, and `typeRoots` so a bare import resolves to its `@types` companion. The `context` ambient global keeps working unchanged.
  - `@checkstack/script-packages-frontend`: replaced the old `useScriptPackageTypes` (which concatenated the broken `dts`) with `useScriptPackageTypeAcquisition()`, returning the `acquireTypes` resolver (targets the cacheable route, zod-validates the response) and the current `lockfileHash` as `acquireResetKey`.
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: wired the resolver into the Run Script and collector editors.

  State & scale: the type closure is derived on read from the materialized package tree (no new durable state). The editor's acquired-set is pod-local UI bookkeeping; the route is keyed by the cluster-wide `lockfileHash`, so the browser HTTP cache is correct across pods and only refetches after a new install changes the hash.

- b995afb: Add live, backend-proxied npm package-name autocomplete and version lookup to the Script Packages "Allowed packages" form.

  The package-name field now searches the configured registry as you type (debounced). The version field suggests the package's published versions newest-first, defaulting to the registry's `latest` dist-tag while staying free-typeable for an exact manual pin. Picking a package now auto-fills its version (from the search hit, then upgraded to `latest`) instead of clearing the field, and the version dropdown stays open so a version is actually selectable.

  This is fully backend-proxied so it reuses the SAME configured registry + auth the install path uses: the registry can be private with a server-side-only auth token (the client only ever sees `hasAuthToken`), and browsers can't reach arbitrary registries due to CORS.

  - `@checkstack/script-packages-common`: two new `manage`-gated query procedures - `searchPackages` (input `{ text }`, output `{ items: [{ name, version?, description? }] }`) and `getPackageVersions` (input `{ name }`, output `{ versions, distTags? }`). Output `version`/`versions` are relaxed to plain strings so valid-but-unusual registry versions surface as suggestions; strict `PackageVersionSchema` validation still applies on `addPackage`.
  - `@checkstack/script-packages-backend`: new `registry-client` (fetch-based, AbortController timeout, size cap, zod-validated registry responses, scoped-registry selection, tolerant semver-descending sort, a best-effort pod-local read cache that is never a source of truth, and errors that never leak the auth token). Search results use the registry's own relevance ranking from `-/v1/search`. The registry + token resolution used by the install path is factored into a shared `resolveRegistryRequestConfig` helper reused by both the new RPC handlers and the installer.
  - `@checkstack/script-packages-frontend`: the package and version inputs become live comboboxes (Popover + Input) with inline pinned-version validation before "Add" is enabled. Selecting a suggestion routes through a dedicated `onSelect(hit)` callback (separate from manual-typing `onValueChange`) so a pick auto-fills the version instead of clearing it; the popover dismissable layer ignores interactions originating on the anchor input, fixing the version dropdown that previously opened then immediately closed. The version-autofill decision logic is extracted into a pure, unit-tested helper.

  State & scale: the registry-client TTL cache is an explicitly non-authoritative, pod-local best-effort read cache (search/version lookups are non-authoritative reads); a cache miss on another pod simply re-fetches, so pod-local divergence is harmless. No new durable state of record is introduced.

- 270ef29: Wire up the script-packages RPC router, admin UI, and editor IntelliSense.

  - `script-packages-backend`: the oRPC router implementing the full
    contract (allowlist CRUD, registry config with encrypted write-only auth
    token, `installNow` via the elected installer, size cap, storage backend
    selection, install state, `getManifest` / `downloadBlob` for reconcilers,
    and `listPackageTypes`), the `installNow` controller (election, size-cap
    enforcement, `script-packages.changed` emit, blocked during migration),
    the `.d.ts` rollup, the singleton config stores, and the full plugin
    wiring (broadcast-hook reconcile + startup backstop).
  - `script-packages-common`: admin route for the settings page.
  - `script-packages-frontend`: the Settings -> Script Packages admin page
    (allowlist, install state + size, registry/storage summary, satellite
    sync) and the `useScriptPackageTypes()` hook.
  - `automation-frontend` / `healthcheck-frontend`: merge installed-package
    `.d.ts` into the script-editor `typeDefinitions` so `import` from an
    allowlisted package autocompletes in every script field.

- 270ef29: Add storage-backend migration for script packages.

  - `migrateStorage({ target })` copies every blob from the active backend to
    the target, verifies each copy byte-for-byte (read back + SHA-256 compare),
    flips the per-blob `backend` only after a verified copy, then atomically
    switches the active backend. Resumable from a partial state (the work set
    is re-derived from the index), aborts cleanly on an integrity mismatch
    (active backend untouched), and supports optional source GC. Built on the
    Phase 2 dual-backend read fallback, so reads keep working mid-migration.
  - Migration and `installNow` are mutually exclusive via the installer
    advisory lock; `setStorageBackend` is refused while a migration runs.
  - New `listStorageBackends` RPC + admin UI: a storage-backend card with a
    target selector, "Migrate" action, and live progress / completion / error
    state.

### Patch Changes

- b995afb: Improve the automation Run Script secret → env mapping editor and script IntelliSense.

  - **Searchable secret picker with existence validation.** The secret → env mapping editor (`SecretEnvEditor`) now uses a searchable, keyboard-navigable combobox (modeled on `VariablePicker` / `PackageNameCombobox`, `isLowPower`-aware) populated from the secrets plugin's `listSecretNames`, replacing the plain `<input>` + `<datalist>`. A free-typed name still round-trips (a secret may be created later). When a row references a name that the loaded list does not contain, the row shows a non-blocking warning (red border + message); save is not prevented. The existence check lives in a pure, unit-tested `unknownSecretNames` helper.
  - **Clearer field description.** The `secretEnv` field descriptions on the `run_script` / `run_shell` actions no longer show the stored `${{ secrets.NAME }}` template (which is confusing in a UI that takes a bare name); they now describe the actual UI behavior and how the value is injected (`process.env.<ENV_NAME>` / `$<ENV_NAME>`) and masked.
  - **`process.env.<ENV_NAME>` autocomplete.** Declared `secretEnv` env-var names now autocomplete under `process.env.` in the Run Script (TypeScript) Monaco editor and are typed `string`, via an ambient `NodeJS.ProcessEnv` augmentation merged into the editor type definitions. New pure, unit-tested generators `generateSecretEnvTypes` and `secretEnvEnvNames` (exported from `@checkstack/automation-frontend`) drive this; the augmentation coexists with `@types/node`'s existing index signature.
  - **Shared combobox-interaction helper.** The "opens-then-immediately-closes" popover guard (`comboboxAnchorProps` / `isAnchorInteraction`) is promoted from `@checkstack/script-packages-frontend` into `@checkstack/ui` so the new secret picker and the existing package/version comboboxes share one implementation; the package comboboxes now import it from `@checkstack/ui` and the local copy is removed.

- b995afb: Tidy the user menu: move "Script packages" and "Secrets" into the **Configuration** group (the now-empty **Administration** group is gone), and display the user-menu groups in alphabetical order instead of a hardcoded canonical order.
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
  - @checkstack/ui@1.12.0
  - @checkstack/script-packages-common@0.2.0
