---
title: "Frontend access gating"
description: "Gate create buttons, management pages, and per-row actions so team-scoped users see exactly what the backend authorises."
---

Checkstack authorises actions with two layers: global RBAC access rules
(role grants) and resource-level ReBAC grants (a team may manage a specific
system, or create a whole type). The backend enforces both. Your frontend must
gate its buttons on both too, or a team-scoped user either sees an action the
backend will reject, or - worse - never sees an action the backend would have
allowed. The `accessApi` (from `@checkstack/frontend-api`, resolved with
`useApi(accessApiRef)`) exposes three hooks for this. Pick the one that matches
what you are gating.

## Which hook to use

- `useAccess(rule)` - a plain global RBAC check. Use it for actions that are
  NOT resource-scoped (settings pages, global toggles).
- `useCanCreate({ accessRule, objectType, parentType? })` - "may the user create
  this type?" Use it for create/add/new buttons.
- `useCanAccessType({ accessRule, objectType, parentType? })` - "may the user
  reach the management SURFACE for this type at all?" True for create-capable
  users AND for users who manage any existing object of the type (or its parent).
  Use it for a route's `manageCapability`, and for a management page's top-level
  `allowed` gate, so a user who manages an existing resource can open the page to
  edit it even without create capability.
- `useResourceAccess({ accessRule, objectType, resourceIds, action? })` - "which
  of these specific resources may the user act on?" Use it for per-row and
  detail-page edit / delete / manage controls, and to filter resource pickers.

All four OR the global rule with team-derived grants, so a user holding the
global manage rule always sees everything.

For anonymous callers the team-derived path is skipped entirely: the backing
procedures (`canCreate`, `myManageableTypes`, `listMyAccessibleResources`) are
authenticated-only and a guest holds no team grants, so the hooks resolve from
the global (anonymous-role) rules alone and never fire a request that could
only fail with 401 "Authentication required".

## Reference resource types by constant, never a string

`objectType` and `parentType` are typed `ResourceType` values, not raw strings.
Each `*-common` package exports plugin-qualified constants built with the
`resourceType(pluginMetadata, localType)` factory from `@checkstack/common`:

```ts
// e.g. catalog-common/src/access.ts
import { resourceType } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

export const catalogResourceTypes = {
  system: resourceType(pluginMetadata, "system"), // "catalog.system"
  group: resourceType(pluginMetadata, "group"),   // "catalog.group"
};
```

Import and use the constant (`catalogResourceTypes.system`,
`incidentResourceTypes.incident`, ...) at every capability call site. A raw
`"catalog.system"` string is NOT assignable to `ResourceType`, so a typo fails
typecheck. `parentType` mirrors your backend contract's
`instanceAccess.create.parent.resourceType` when the type is created "for" a
parent (an incident/maintenance/SLO is created for a `catalog.system`); omit it
for top-level types.

## Gate a create button and its page

`useCanCreate` returns `{ loading, allowed }`, so it is a drop-in replacement for
the `useAccess` you already gate the page on.

```tsx
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { incidentAccess } from "@checkstack/incident-common";

const accessApi = useApi(accessApiRef);

const { allowed: canManage, loading } = accessApi.useCanCreate({
  accessRule: incidentAccess.incident.manage,
  objectType: "incident.incident",
  parentType: "catalog.system", // a user managing a system may open one for it
});

return (
  <PageLayout allowed={canManage} loading={loading} actions={
    canManage ? <Button onClick={openEditor}>Report incident</Button> : undefined
  }>
    {/* ... */}
  </PageLayout>
);
```

## Gate per-resource actions

On a list page, pass every visible id to `useResourceAccess` once and gate each
row's controls with the returned `canAccess(id)` predicate. Do NOT reuse the
create-capability boolean for row actions - a user who can create incidents is
not necessarily allowed to edit every existing one.

```tsx
const { canAccess } = accessApi.useResourceAccess({
  accessRule: incidentAccess.incident.manage,
  objectType: "incident.incident",
  resourceIds: incidents.map((i) => i.id),
});

// in each row:
{canAccess(incident.id) && (
  <Button onClick={() => edit(incident)}>Edit</Button>
)}
```

On a detail page, pass the single id:

```tsx
const { canAccess } = accessApi.useResourceAccess({
  accessRule: incidentAccess.incident.manage,
  objectType: "incident.incident",
  resourceIds: incident ? [incident.id] : [],
});

{canAccess(incident.id) && <Button onClick={resolve}>Resolve</Button>}
```

> [!NOTE]
> `canAccess` fails closed: it returns `false` while access is still resolving,
> so a control briefly hides rather than flashing then disappearing. Pair it with
> the returned `loading` flag if you want to defer rendering the row instead.

> [!IMPORTANT]
> These hooks gate VISIBILITY only. The backend still enforces authorization on
> every mutation via `autoAuthMiddleware`, so a hidden button is defence in
> depth, not the security boundary. Never move an access decision that the
> backend owns into the frontend.

## Gate multi-select bulk actions

A list with mass actions (mass delete, mass resolve/complete) restricts the
selectable rows to the ones the caller can MANAGE, using the SAME
`canAccess(id)` predicate as the per-row controls. Only render a row's checkbox
when `canAccess(id)` is true, and derive the select-all set from those ids so a
row the backend would reject is never selectable.

```tsx
// pure helpers keep the gating testable (see incidentConfig.logic.ts)
const selectableIds = selectableIncidentIds({ incidents, canAccess });
// of the selection, the subset still eligible for the "resolve" action:
const resolvableSelected = resolvableIncidentIds({ selectedIds, incidents, canAccess });

// per row:
{canAccess(i.id) && (
  <Checkbox checked={selectedIds.has(i.id)} onCheckedChange={() => toggleOne(i.id)} />
)}
```

Prune the selection whenever the selectable set changes (a refetch, a revoked
grant, a deleted row) so a stale id can never be submitted, and submit only the
still-eligible subset. The backend mirrors this with the `bulkManage`
instance-access mode, which authorizes each id server-side and reports a per-id
result - so a mismatched frontend gate can only under-offer, never grant access.

## Gate a route and its sidebar entry

A management route is otherwise gated only on its global `accessRule`, so a
team-scoped user can neither see the nav entry nor open the page. Declare a
`manageCapability` on the route registration; the route guard and sidebar then
also allow it when the user can create/manage the type (or its parent) via a
team - resolved once via `myManageableTypes`.

```ts
// incident-frontend/src/index.tsx
{
  route: incidentRoutes.routes.config,
  accessRule: incidentAccess.incident.manage,
  // Managing a system unlocks the incidents surface for it.
  manageCapability: {
    objectType: incidentResourceTypes.incident,
    parentType: catalogResourceTypes.system,
  },
  nav: { group: "Reliability", icon: AlertTriangle },
  load: () => import("./pages/IncidentConfigPage").then((m) => ({ default: m.IncidentConfigPage })),
}
```

Gate the page's own `PageLayout allowed` on `useCanAccessType` with the same
`objectType`/`parentType` so it agrees with the route guard.

## Filter resource pickers to what the backend accepts

When a form lets the user SELECT resources to act on (an incident's affected
systems, an SLO's target system, a group's members), offer only the resources
the backend will accept. Match the filter to the backend's actual authorization:

- If the mutation requires MANAGE on every referenced resource (incident and
  maintenance require manage on every system; SLO create parent-gates the target
  system), filter the picker with `useResourceAccess(...).canAccess(id)` on the
  `manage` rule (or show all when the user holds the global rule).
- If the mutation is a READ relationship (a status page merely DISPLAYS a
  system's status), do NOT manage-filter - that would wrongly hide readable
  resources.

```tsx
const { allowed: allowGlobal } = accessApi.useAccess(incidentAccess.incident.manage);
const { canAccess: canManageSystem } = accessApi.useResourceAccess({
  accessRule: catalogAccess.system.manage,
  objectType: catalogResourceTypes.system,
  resourceIds: systems.map((s) => s.id),
});
const selectableSystems = allowGlobal
  ? systems
  : systems.filter((s) => canManageSystem(s.id) || selectedSystemIds.has(s.id));
```

Keep already-selected resources visible when editing (the `|| selectedIds.has(id)`
above) so existing links don't vanish.

## Gate affordances, not structure

Capability gating hides ACTIONS - it must never unmount structural DOM that a
read-only user's view depends on. The dependency map is the cautionary tale:
React Flow silently drops every edge whose source node has no source
`<Handle>`, so conditionally rendering the handle only for managed systems
erased ALL edges from read-only users' maps. Always render the handle and gate
its `isConnectable` / `isConnectableStart` (the drag-to-connect affordance)
on `useResourceAccess(...).canAccess(id)` instead.

## Keep the owning-team picker on the global rule

Editors that let a global admin create a resource owned by a chosen team (via
`TeamOwnershipPicker`'s `allowGlobal`) should keep using `useAccess(rule)` for
that specific flag: only a true global-manage holder may create a globally-owned
resource, whereas `useCanCreate` is also true for team-scoped creators. Gate the
picker's `allowGlobal` on `useAccess`, and the button/page on `useCanCreate`.

For the backend contract these hooks mirror, see
[Teams and access control](/checkstack/developer-guide/backend/teams/).
