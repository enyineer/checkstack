---
title: "Checkstack SDK"
description: "How the auto-generated, version-pinned @checkstack/sdk package is built, published, and injected into the script editor."
---

`@checkstack/sdk` is the auto-generated, version-pinned TypeScript SDK for
Checkstack. It covers two distinct use cases:

- **Script authoring** - `defineHealthCheck` and `defineIntegration` helpers
  for inline scripts written in the in-app editor or in an external IDE.
- **API client** - a fully-typed `createCheckstackClient` factory for external
  tooling and automation that calls the Checkstack REST surface.

The package is generated from the platform's source-of-truth contracts, so its
types always match the running backend.

## How the SDK is generated

The SDK is emitted by `scripts/generate-sdk.ts`. It reads three inputs:

1. **The 22 per-plugin `*Api` contract definitions** - one `ClientDefinition`
   per `@checkstack/*-common` package (e.g. `HealthCheckApi` from
   `@checkstack/healthcheck-common`). `InferClient<typeof XApi>` is applied
   per plugin to build the `CheckstackClient` interface.
2. **The script-context helper type builders** - the generic variants of the
   `HealthCheckScriptContext` / `IntegrationScriptContext` blocks from
   `core/ui/src/components/CodeEditor/scriptContext.ts`.
3. **The current release version** - read from `core/release/package.json`.

The generator emits all files under `core/sdk/` and commits them:

| File | Purpose |
|---|---|
| `src/client.ts` | Typed `CheckstackClient` interface + `createCheckstackClient` runtime factory |
| `src/contracts.ts` | Re-exports all 22 `*Api` `ClientDefinition` objects |
| `src/healthcheck.ts` | `defineHealthCheck` runtime + `HealthCheckScript{Context,Result}` types |
| `src/integration.ts` | `defineIntegration` runtime + `IntegrationScript{Context,Result}` types |
| `generated/index.d.ts` | Root subpath declaration (for `exports."."`) |
| `generated/healthcheck.d.ts` | `./healthcheck` subpath declaration |
| `generated/integration.d.ts` | `./integration` subpath declaration |
| `generated/editor-bundle.d.ts` | Combined ambient `.d.ts` served to Monaco only |

Run the generator manually whenever you change a `*-common` contract or the
script-context helper builders:

```bash
bun run generate:sdk
```

A `--check` mode is used in CI to detect drift:

```bash
bun run generate:sdk:check
```

This regenerates to a temp buffer, diffs against the committed files, and exits
non-zero if they differ. A contract change without a regenerated SDK will fail
CI.

> [!IMPORTANT]
> Never add `@checkstack/sdk` to a changeset. The SDK version is stamped
> from `@checkstack/release` by `generate-sdk.ts` - a changeset bump would
> fight the stamp. See [Changesets](/checkstack/developer-guide/tooling/changesets/)
> for details.

## Versioning - SDK version equals the release version

The SDK version is always identical to the platform release version tracked by
`@checkstack/release` (the version baked into each Docker image). The stamp
happens during the release flow:

```
inject-release.ts  →  changeset version  →  generate-sdk.ts
```

`generate-sdk.ts` runs after `changeset version` so it reads the just-bumped
`@checkstack/release` version and writes it into `core/sdk/package.json`.
`publish-packages.ts` then discovers `core/sdk/` automatically (it scans
`core/` and `plugins/`) and publishes when the stamped version is ahead of npm.

This means you install exactly the version that matches your running platform:

```bash
npm install @checkstack/sdk@0.93.0
```

where `0.93.0` is the release version shown in the platform footer or returned
by the health endpoint.

## Subpath exports

The package has three subpaths, each with its own per-subpath `.d.ts` for
correct `node16`/`nodenext`/`bundler` module resolution:

| Subpath | Contents |
|---|---|
| `@checkstack/sdk` | `createCheckstackClient`, `CheckstackClient`, all `*Api` contract re-exports, `InferClient` |
| `@checkstack/sdk/healthcheck` | `defineHealthCheck`, `HealthCheckScriptContext`, `HealthCheckScriptResult` |
| `@checkstack/sdk/integration` | `defineIntegration`, `IntegrationScriptContext`, `IntegrationScriptResult` |

### The umbrella client

```ts
import { createCheckstackClient } from "@checkstack/sdk";

const client = createCheckstackClient({
  baseUrl: "https://your-host/rest",
  headers: { "X-Api-Key": "your-api-key" },
});

// Fully typed - each key is InferClient<typeof XApi>.
const checks = await client.healthcheck.list({ ... });
const incidents = await client.incident.list({ ... });
```

The client mirrors the backend's nested oRPC router at `/rest/:pluginId/*` -
one entry per plugin id. Types come from the per-plugin contracts through
`InferClient`, so the compiler validates every call.

### Health-check scripts

```ts
import { loadavg } from "node:os";
import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

const load = loadavg()[0];
export default defineHealthCheck({
  success: load < 0.60,
  message: `1m load average is ${load.toFixed(2)}`,
  value: load,
});
```

`defineHealthCheck` is a runtime identity function - it returns its argument
unchanged. Its only job is to assert at the type level that `export default`
matches `HealthCheckScriptResult`, so type errors surface before the script
runs. The function form is also supported:

```ts
import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

export default defineHealthCheck(async (context) => {
  return {
    success: true,
    message: `Checked ${context.system.name} every ${context.check.intervalSeconds}s`,
  };
});
```

### Integration scripts

```ts
import { defineIntegration } from "@checkstack/sdk/integration";

export default defineIntegration(async (context) => {
  const ticketId = await createTicket({
    title: `Incident: ${context.event.payload.title}`,
  });
  return { id: ticketId };
});
```

`defineIntegration` follows the same pattern - identity runtime, type-narrowing
purpose. The return value is optional; returning nothing is valid for fire-and-
forget integrations.

## Using the SDK from an external IDE

Install the SDK at the version matching your running platform:

```bash
# npm
npm install @checkstack/sdk@0.93.0

# bun
bun add @checkstack/sdk@0.93.0
```

Your `tsconfig.json` should use `"moduleResolution": "node16"` (or `"bundler"`)
so the `exports` map is respected and each subpath resolves to its own `.d.ts`:

```json
{
  "compilerOptions": {
    "module": "node16",
    "moduleResolution": "node16",
    "target": "es2022"
  }
}
```

Scripts authored against `@checkstack/sdk/healthcheck` or
`@checkstack/sdk/integration` in an external IDE behave identically when pasted
into the in-app editor. The in-app runner rewrites the subpath import to its
temp identity-function module at execution time, so the helper behaviour is
exactly the same.

## Editor type injection

The in-app Monaco editor automatically injects the SDK types for the running
release. No install is needed inside the editor.

The injection works through a version-keyed, HTTP-cacheable route:

```
GET /api/script-packages/sdk-types/:releaseVersion
```

The backend handler lives in `@checkstack/script-packages-backend` and serves
the committed `generated/editor-bundle.d.ts` with
`Cache-Control: private, max-age=1y, immutable`. The key changes on every
deployment upgrade, so the editor always loads the types that match the running
backend and never serves a stale snapshot.

The frontend `useSdkTypeInjection` hook fetches the bundle once per session and
mounts it into Monaco via `addExtraLib` under
`file:///node_modules/@checkstack/sdk/...`. A version change triggers a reset so
a live upgrade refreshes the injected libs.

The editor bundle declares only the subpath module names
(`@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration`, and the root
`@checkstack/sdk`). An old bare-name import (`@checkstack/healthcheck`,
`@checkstack/integration`) now shows an unresolved-module error in the editor,
surfacing the migration.

## BREAKING migration from bare-name imports

Before the `@checkstack/sdk` package was introduced, scripts imported helpers
using virtual bare-name modules:

```ts
// Old - no longer works.
import { defineHealthCheck } from "@checkstack/healthcheck";
import { defineIntegration } from "@checkstack/integration";
```

These bare names were hand-rolled ambient declarations injected into Monaco.
They are no longer declared anywhere - the editor now errors on them. Update
existing scripts to the `@checkstack/sdk` subpath form:

```ts
// New - use the published subpath.
import { defineHealthCheck } from "@checkstack/sdk/healthcheck";
import { defineIntegration } from "@checkstack/sdk/integration";
```

The helper names (`defineHealthCheck`, `defineIntegration`) and their runtime
behaviour are unchanged - only the module specifier moves. Scripts that do not
import the helper at all (using the global form instead) need no change.

> [!NOTE]
> In-app scripts that use the global helper form (`export default
> defineHealthCheck({ ... })` with no import statement) continue to work
> unchanged. The editor starters use this form.

## CI guard - SDK drift detection

`generate:sdk:check` runs in CI alongside typecheck and lint. It fails when:

- The generated SDK files differ from the committed copies (a contract changed
  without a regenerated SDK).
- A pending changeset names `@checkstack/sdk` directly (which would fight the
  version stamp).
- The generated SDK surface changed but no pending changeset exists for any
  platform package (guards against the silent no-republish drift case described
  in the plan).

When `generate:sdk:check` fails, run `bun run generate:sdk` locally, commit the
updated `core/sdk/` files, and ensure at least one changeset covers the
underlying contract change.

## See also

- [Script health checks](/checkstack/user-guide/reference/script-health-checks/) - user-guide reference for inline scripts
- [Changesets](/checkstack/developer-guide/tooling/changesets/) - release and versioning workflow
- [`core/sdk/`](https://github.com/enyineer/checkstack/tree/main/core/sdk) - generated SDK source
- [`scripts/generate-sdk.ts`](https://github.com/enyineer/checkstack/tree/main/scripts/generate-sdk.ts) - codegen script
