# RLAC: keep frontend gating in lock-step with backend authorization

The platform authorizes writes with **RBAC** (global access rules from roles) OR
**ReBAC** (per-resource team grants in the `relation_tuple` store). The backend
is the security boundary: a forgotten frontend gate can never grant access. But a
forgotten or mismatched frontend gate IS a real bug of a different kind - a
team-scoped user (a team grant, no global rule) either never sees a surface they
are authorized to use, or sees a picker offering resources every submit will
reject. This rule exists so that class of drift cannot ship.

Two CI guards enforce most of this; the rest is convention:

- `bun run check:manage-capabilities` (frontend ↔ backend): every management
  route/nav gated on a team-scopable `manage` rule must declare a matching
  `manageCapability`. See `scripts/check-manage-capabilities.ts`.
- `core/backend/src/plugin-manager/instance-access-contract-conformance.test.ts`
  (backend): every contract is boot-valid and every `parentScope`/`create.parent`
  resourceType is a type some contract actually team-scopes.
- `validateContractInstanceAccess` (boot): each proc declares exactly one
  instanceAccess mode and its input paths exist.

## The one keying rule everything hinges on

A resource type's team grants are keyed on
`qualifyResourceType(pluginId, rule.resource)` - derived from the **access rule's
`resource`**, NOT from a separate name. So the frontend `ResourceType` constant a
plugin exports MUST equal that value, or the capability gate checks a type the
backend never writes.

> [!CAUTION]
> `accessPair("healthcheck", ...)` (resource `"healthcheck"`) keys grants on
> `healthcheck.healthcheck`, NOT `healthcheck.configuration`. Health-check
> team-scoping was invisible for exactly this reason. Name the access-rule
> `resource` the same clean noun you use for the `ResourceType` constant
> (`accessPair("system", ...)` ↔ `resourceType(pluginMetadata, "system")`), so
> the two agree by construction.

```ts
// *-common/access.ts
export const fooResourceTypes = {
  // MUST equal qualifyResourceType(pluginId, <the manage rule's resource>).
  widget: resourceType(pluginMetadata, "widget"),
};
export const fooAccess = {
  widget: accessPair("widget", { read: {...}, manage: {...} }, { pluginId }),
};
```

## Backend: pick the instanceAccess mode deliberately

Every write proc on a team-scopable type declares exactly ONE mode. Choosing none
fails OPEN (global-rule only); the boot validator rejects that when the type is
scoped elsewhere.

- `idParam: "id"` - authorize against the caller's grant on THIS resource id.
- `create: { teamIdParam, idField }` - a create-capability grant (or a parent
  gate) authorizes creation; the owning-team grant is written for the new id.
  - `create.parent: { resourceType, idParam }` - also authorize by MANAGE on a
    parent INSTANCE named in the payload (e.g. an incident "for" a system).
  - `create.alsoAcceptCreatorOf: [type, ...]` - also authorize by a `creator`
    (create-capability) grant on a SIBLING TYPE, no instance needed. Type-scoped,
    strictly the `creator` grant (an instance editor/owner grant does NOT count -
    that is what `parent` is for). Use for sibling self-service, e.g. a
    `catalog.system` creator may also create `catalog.group` / `catalog.environment`.
    Each listed type must itself be team-scoped (the conformance test enforces
    this). The owning team is still resolved from `teamIdParam`/membership.
- `parentScope: { resourceType, action, idParam }` - authorize by MANAGE on a
  PARENT (e.g. an incident "for" a `catalog.system`). The parent type must itself
  be team-scoped.
- `{ global: true }` - the deliberate "this endpoint is NOT team-scoped" marker.
  **Do NOT use it for a utility/catalog endpoint that a team-scoped manager
  needs** (see `typeScoped`): `global: true` is enforced ONLY against the
  caller's global rules, so a team-scoped manager with no global rule gets a 403
  even though they can manage the actual resource. This is a real, easy-to-miss
  bug (the healthcheck editor's `getStrategies`/`getCollectors` were gated this
  way): the boot validator accepts `global: true` as a deliberate opt-out and
  cannot tell it is actually a dependency of a team-scopable editor flow, and the
  `check:manage-capabilities` guard only covers routes/nav, not the procedures a
  page calls. So NO gate flags it - pick the mode by hand.
- `typeScoped: { action? }` - a no-instance utility/catalog endpoint (list the
  strategy/collector types, an editor helper, a sandboxed script test) that has
  nothing to scope on but IS reached by a team-scoped manager. Authorizes when
  the caller holds the global rule OR ANY team grant of the rule's resource type
  - a `viewer`/`editor`/`owner` grant on any instance, OR a `creator`
  (create-capability) grant so a team member who may CREATE the type can open its
  authoring UI before owning an instance. This is the correct fix whenever you
  are tempted to reach for `global: true` on an endpoint a team manager needs.
  `action` defaults to the access rule's own level.
- `listKey`/`recordKey` - post-filter a list / single record by the caller's
  grants.
- `bulkManage: { idsParam }` - a bulk WRITE (mass delete / mass resolve) over an
  id ARRAY. PRE-handler, the middleware partitions `input[idsParam]` into the
  caller's manageable subset and the denied remainder and exposes both on
  `context.bulkAccess[idsParam]` as `{ authorizedIds, deniedIds }`. The handler
  MUST mutate only `authorizedIds` and report `deniedIds` as forbidden, returning
  a per-id result. This is the ONLY correct mode for a bulk write: `idParam`
  throws on the first unauthorized id, `listKey`/`recordKey` post-filter AFTER the
  mutation (fail-open), and `global: true` excludes team-scoped users.

A parent-gated create (`create.parent`) MUST resolve an owning team, or a
team-scoped creator makes an object they cannot later edit. `authorizeCreate`
handles this; the frontend `TeamOwnershipPicker` marks the team required when the
caller lacks the global rule.

## Frontend: gate every write surface on capability, not just the global rule

Use the `AccessApi` primitives (`@checkstack/frontend-api`), never a bare
`useAccess(rule)` on a management surface:

- Route/nav: declare `manageCapability: { objectType: fooResourceTypes.widget,
  parentType?: catalogResourceTypes.system }`. The route guard and sidebar then
  reveal it to team-scoped users. `objectType` MUST be the type the route's
  `manage` rule resolves to (the CI guard checks this).
- Create/update buttons and pages: derive the gate from the CONTRACT, not by
  hand-passing `accessRule`/`objectType`. Prefer the gate-fused client hooks
  `client.createFoo.useGatedMutation(...)` / `client.updateFoo.useGatedMutation({
  gateInput: { id } })` - the mutation cannot hand back `mutate` without the
  `{ allowed, accessLoading }` verdict, so the button gate can never drift from
  the call it guards. When you need a standalone verdict (no mutation to fuse
  onto yet), use `accessApi.useProcedureAccess(FooApi.contract.createFoo)`; it
  resolves the access rule, object type, and any `create.parent` parent type
  from the procedure's `instanceAccess` metadata.
- Per-row actions and remove chips: `useResourceAccess(...).canAccess(id)`.
- Resource pickers (Affected Systems, SLO target, dependency source, ...): filter
  the options to `canAccess(id)` (or all when the user holds the global rule), so
  the picker only offers what the backend will accept.

For pickers, use `useManageableResources` from `@checkstack/auth-frontend`
instead of re-deriving the filter in every editor:
`useManageableResources({ items, getId, accessRule, objectType, keepIds?,
allowAllOverride? })` returns `{ manageable, ... }` - the exact list to offer.
`keepIds` keeps an existing selection visible; `allowAllOverride` is for a HIGHER
rule that authorizes any instance (a global incident manager may reference any
system). Used by the incident/maintenance/SLO pickers.

Capability GATING of buttons/pages stays on the contract-derived verdict
(`useGatedMutation` / `useProcedureAccess` for a single procedure,
`useSurfaceAccess` / `useCanAccessType` for the coarse "can reach this surface"
gate) and `PageLayout`'s `allowed` prop: pages consume the verdict compoundly (a
`useEffect` dependency, a ternary between two empty states, a per-row predicate),
which a wrapper component cannot express - so there is deliberately no
gate-component sugar. The removed `useCanCreate` hook is replaced by
`useProcedureAccess(FooApi.contract.createFoo)` (or the fused
`useGatedMutation`), which derives the same verdict from the create procedure's
contract instead of hand-passed args that can drift.

## Adding a new team-scoped resource - checklist

1. `*-common/access.ts`: `accessPair("<noun>", ...)` + `resourceType(
   pluginMetadata, "<noun>")` with the SAME noun; export both.
2. `*-common/rpc-contract.ts`: give each write proc the right instanceAccess mode.
3. `*-frontend`: `manageCapability` on the route/nav; capability hooks on
   buttons/rows; filter every picker.
4. Register a `resourceResolverRegistry` entry under the SAME qualified type so
   Teams can render grant names.
5. Run `bun run check:manage-capabilities` and the backend conformance test.

If a management surface is intentionally GLOBAL-only (no team grants), simply
declare no instanceAccess (backend) and no `manageCapability` (frontend) - the
guards only fire for types the backend actually team-scopes.
