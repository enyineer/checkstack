---
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/ui": minor
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-frontend": minor
---

Fix package IntelliSense in script editors: lazy Automatic Type Acquisition (ATA) with proper `@types/*` resolution.

Script editors (automation "Run Script (TypeScript)" and healthcheck collectors) now provide real autocomplete for installed npm packages. Importing a package whose types live in DefinitelyTyped - e.g. `import { debounce } from "lodash"` (lodash ships no own types; `@types/lodash` does) - now yields member completions. Previously no package completions appeared at all.

Root cause: the old rollup wrapped each package's raw, multi-file `.d.ts` (with `export =`, `export as namespace`, and triple-slash `/// <reference path>` chains) inside a single `declare module "<name>" { ... }`, which the TypeScript worker silently rejected, and it truncated large type sets (lodash is ~866 KB across ~700 files) at a 256 KB cap.

The fix registers the REAL declaration files at their `node_modules/...` virtual paths and lets TypeScript's own NodeJs + `@types` resolution do the work:

- `@checkstack/script-packages-backend`: replaced `rollupPackageTypes` with a tree-driven closure extractor (`resolvePackageTypeClosure`). Given a bare specifier, it resolves against the materialized tree - own types via `package.json` `types`/`typings`/`exports` (bundled-types packages like `zod`/`dayjs`), the `@types/<mangled>` companion when it exists (`lodash` -> `@types/lodash`, scoped `@babel/core` -> `@types/babel__core`), or both, or neither (graceful empty, never a throw). It follows `/// <reference path|types>` and relative imports, includes each package's `package.json`, leaves every file UNWRAPPED, and surfaces a `truncated` flag instead of silently capping. Served from a new raw, HTTP-cacheable route `GET /api/script-packages/types/:lockfileHash/:specifier` (`Cache-Control: private, max-age=1y, immutable`), auth-gated by `script-packages.read`.
- `@checkstack/script-packages-common`: **BREAKING** - replaced the `listPackageTypes` RPC procedure and `PackageTypesSchema { name, version, dts }` with `PackageTypeClosureSchema` (a `{ path, content }` file-map plus `hasOwnTypes`/`hasAtTypes`/`notFound`/`truncated`) served over the cacheable HTTP route. Added a shared `buildTypeAcquisitionPath`/`parseTypeAcquisitionPath` path contract.
- `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `acquireTypes` resolver + `acquireResetKey`. On debounced buffer change it parses bare `import`/`require` specifiers (pure, unit-tested) and lazily fetches + registers each NEW package's closure via `addExtraLib` at `file:///node_modules/...`, deduped by a shared acquired-set that resets when the install hash changes. Compiler options set `moduleResolution: NodeJs`, `baseUrl: "file:///"`, and `typeRoots` so a bare import resolves to its `@types` companion. The `context` ambient global keeps working unchanged.
- `@checkstack/script-packages-frontend`: replaced the old `useScriptPackageTypes` (which concatenated the broken `dts`) with `useScriptPackageTypeAcquisition()`, returning the `acquireTypes` resolver (targets the cacheable route, zod-validates the response) and the current `lockfileHash` as `acquireResetKey`.
- `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: wired the resolver into the Run Script and collector editors.

State & scale: the type closure is derived on read from the materialized package tree (no new durable state). The editor's acquired-set is pod-local UI bookkeeping; the route is keyed by the cluster-wide `lockfileHash`, so the browser HTTP cache is correct across pods and only refetches after a new install changes the hash.
