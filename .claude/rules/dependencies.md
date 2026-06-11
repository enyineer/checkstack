# Dependency direction

Dependencies in this monorepo flow **one way only: from the specific to the
general**. A more-general (platform / host / infrastructure) package must NEVER
import a more-specific (domain / capability) package. If you ever feel the urge
to add such an import, you have found a design error — invert it (see below).

## The layers (general ➜ specific)

From most general (bottom, depended-upon) to most specific (top, depends-down):

1. **Foundation**: `@checkstack/common`, `@checkstack/backend-api`,
   `@checkstack/frontend-api`, `@checkstack/ui`, `@checkstack/tsconfig`,
   `@checkstack/scripts`, the `*-api` / `*-utils` helpers.
2. **Platform / host plugins**: the cross-cutting mechanisms other plugins plug
   INTO — e.g. `auth-*`, `automation-backend`, `ai-backend`,
   `integration-backend`, `command-backend`, `status-page-backend`. These OWN
   extension points and generic registries.
3. **Domain / capability plugins**: the concrete features — `catalog-*`,
   `healthcheck-*`, `incident-*`, `maintenance-*`, `slo-*`, `anomaly-*`,
   `dependency-*`, and everything under `plugins/`.

A package may depend on its own layer and any layer **below** it. It may NOT
depend on a layer **above** it. Concretely:

- A **platform** package must not import a **domain** package — not its
  `*-backend`, not its `*-frontend`, and **not its `*-common`** "just to
  special-case it". `status-page-backend` importing `healthcheck-common` /
  `catalog-common` to resolve domain data was exactly this error.
- A **domain** plugin depends on the **platform** (to get its extension points,
  base API, UI kit), never the reverse.

## `*-common` packages are leaves

A `*-common` package carries contracts, schemas, types, and pure helpers. It may
depend on `@checkstack/common`, `@checkstack/frontend-api` (for slot/route
defs), and **other `*-common` packages it genuinely references** (e.g. a cross-
plugin RPC `ClientDefinition` or shared schema). It must **never** depend on any
`*-backend` or `*-frontend`. A backend/frontend depending on another plugin's
`*-common` (for its API client def or schemas) is fine and is the normal way to
make a cross-plugin RPC call.

## How to invert a wrong dependency: extension points

When a platform package needs domain data or behavior, it must **define an
extension point (or a registry / interface)** and let the owning plugin
**contribute** the implementation. The owning plugin imports the platform; the
platform stays ignorant of the owner.

> [!IMPORTANT]
> The platform DEFINES the contract (the extension-point shape, and any shared
> schemas/types in the platform's own `*-common`). The owning DOMAIN plugin
> SUPPLIES the implementation by registering against that contract in its
> `register()`/`init()`. Registration is buffered behind the extension point, so
> load order does not matter.

Reference patterns already in the tree:

- `automationActionExtensionPoint` (automation-backend) — plugins contribute
  actions; automation-backend imports no capability plugin.
- `aiToolProjectionExtensionPoint` (ai-backend) — plugins project their read
  procedures as AI tools.
- `statusWidgetTypeExtensionPoint` (status-page-backend) — owning plugins
  (healthcheck/incident/maintenance) contribute their status-page widgets, so
  `status-page-backend` depends only on `backend-api`, `common`, and its own
  `status-page-common`.

Minimal shape:

```ts
// platform-backend: define the point + a generic registry
export interface FooExtensionPoint {
  registerFoo(def: FooDefinition, meta: PluginMetadata): void;
}
export const fooExtensionPoint = createExtensionPoint<FooExtensionPoint>("platform.foo");

// domain-backend: import the PLATFORM and contribute (never the other way round)
env.getExtensionPoint(fooExtensionPoint).registerFoo(myFooImpl, pluginMetadata);
```

If verifying a resource the platform doesn't own (e.g. "can this user read this
system?"), put the check in the OWNING plugin's `*-common` (e.g.
`catalog-common`'s `assertCatalogResourcesReadable`) and call it from the
contributor — never reach back up into the platform.

## Checks

- After adding/removing any `@checkstack/*` dependency, run
  `bun run typecheck:references:generate` and commit the tsconfig changes
  (see [`typecheck.md`](./typecheck.md)). The reference graph is generated from
  `package.json` deps.
- A pruned back-edge / dependency cycle reported by the generator is a **smell**:
  it usually means a platform package is reaching into a domain package. Fix the
  direction rather than living with the cycle.
- Smell test before adding an import: "Is the thing I'm importing MORE specific
  than the package I'm editing?" If yes, stop and add an extension point instead.
