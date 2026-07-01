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
- `parentScope: { resourceType, action, idParam }` - authorize by MANAGE on a
  PARENT (e.g. an incident "for" a `catalog.system`). The parent type must itself
  be team-scoped.
- `{ global: true }` - the deliberate "this endpoint is NOT team-scoped" marker.
- `listKey`/`recordKey` - post-filter a list / single record by the caller's
  grants.

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
- Create buttons/pages: `useCanCreate({ accessRule, objectType, parentType? })`.
- Per-row actions and remove chips: `useResourceAccess(...).canAccess(id)`.
- Resource pickers (Affected Systems, SLO target, dependency source, ...): filter
  the options to `canAccess(id)` (or all when the user holds the global rule), so
  the picker only offers what the backend will accept.

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
