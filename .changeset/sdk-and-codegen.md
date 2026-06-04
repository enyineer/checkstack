---
"@checkstack/release": minor
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/healthcheck-script-backend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/automation-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/ui": minor
---

Add the auto-generated, version-pinned `@checkstack/sdk` package + codegen, and serve its types live to the in-app editor.

- A new committed workspace package `@checkstack/sdk`, generated from the platform's source of truth by `scripts/generate-sdk.ts` (`generate:sdk` / `generate:sdk:check`): a fully-typed oRPC client (`createCheckstackClient`) over the REST surface with one `InferClient` per plugin contract, real script-authoring helpers (`@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration`) whose runtime body is the same identity function the in-app runner injects, per-subpath `.d.ts` under the package `exports` map, and an editor-only ambient bundle. A `generate:sdk:check` CI guard fails when the committed SDK files drift from a fresh generation. The `@checkstack/sdk` version is stamped from `@checkstack/release` and MUST NOT appear in a changeset (a guard enforces this); the `@checkstack/release` bump here advances the release version so the generated SDK can be published later. The generated client also normalizes its base URL without a backtracking-prone regex, closing a CodeQL `js/polynomial-redos` finding.
- Live editor type injection: a new version-keyed route `GET /api/script-packages/sdk-types/:releaseVersion` (raw handler in `@checkstack/script-packages-backend`) serves the generated SDK editor bundle with `Cache-Control: private, max-age=1y, immutable`; the pure path-build/parse module lives in `@checkstack/script-packages-common`, shared by backend and frontend. A mismatched version returns `409` so the editor refetches and never serves stale types after an upgrade. The frontend `useSdkTypeInjection` hook fetches the bundle once per session and mounts it into Monaco via `addExtraLib`. Schema-narrowed `context.config` / `context.event.payload` editor types stay local; the package-resolving module declarations come from the one published `@checkstack/sdk` source.

BREAKING CHANGES: the script-authoring import surface moves from the bare `@checkstack/healthcheck` / `@checkstack/integration` virtual modules to the `@checkstack/sdk/healthcheck` / `@checkstack/sdk/integration` subpaths of the published `@checkstack/sdk` package. The old bare-name imports no longer resolve (an old import now errors in the editor, surfacing the migration). Existing scripts must update the module specifier:

    - import { defineHealthCheck } from "@checkstack/healthcheck";
    + import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

    - import { defineIntegration } from "@checkstack/integration";
    + import { defineIntegration } from "@checkstack/sdk/integration";

The helper names and their runtime behaviour are unchanged - only the module specifier moves. The global (no-import) helper form continues to work unchanged.

This is a beta minor.
