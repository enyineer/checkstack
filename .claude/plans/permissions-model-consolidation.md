# Permissions model consolidation — from five primitives to one relation

> **Status:** Tier 0 + two fixes + the resource resolver/UI = SHIPPED on this
> branch. **Target B (relation tuples) APPROVED 2026-06-10** with these locked
> decisions: (1) **generic tuple API** replaces the per-concept endpoints + S2S
> checks; (2) privacy = an explicit **`public#viewer`** marker tuple; (3)
> **team_manager stays a separate table** (different axis); (4) **backfill + drop**
> the old tables in this PR. The concrete build spec is **§8**.
> **Branch:** `feat/permissions-clarity`, stacked on the sealed squash commit of
> `feat/platform-team-scoping`.
> **Goal:** keep the (correct) access-control *engine* but stop expressing one
> idea — "who may touch this?" — five different ways. Reduce the concept count an
> admin must hold from ~13 to a small, nameable set, make the safe path the
> default for plugin authors, and preserve the product behaviour
> (readable-by-default, private opt-in) exactly.

Self-contained handoff. Current-state claims carry `file:line` anchors. The plan
honours `.claude/rules/*` — no `any`, zod for validation, typed object args,
`isLowPower` guards on animations, look-and-feel parity with sibling pages,
per-package beta-minor changesets, append-only migrations, same-PR docs.

---

## 0. TL;DR — the verdict and the decided scope

**Verdict (all four review angles converged):** the *engine* is sound and
mainstream — flat **RBAC for verbs** (`role → access_rule`) plus a single-hop
**ReBAC for scope** (`team → resource grant`), enforced centrally by
`autoAuthMiddleware`. This is the Backstage/GitHub shape and should be kept. The
pain is **accidental complexity**: the same "principal → relation → object" idea
is encoded as **five overlapping primitives**, scattered across **four admin
screens** with misleading words, and wired by an **implicit keying contract** that
is the root cause of the IDOR / fail-open / mis-key bugs already fixed on the
team-scoping branch.

**DECIDED — fix now (this branch, §5.5):**
- **#1 grant-gating divergence → admin-only.** Granting/revoking a team's access
  to a resource stays a pure `auth.teams.manage` action (matches the
  implemented + tested code). Correct the docs that wrongly claim it also needs
  manage on the resource. **Docs-only change, no behaviour change.**
- **#2 loaded-gun default → removed.** Drop the rule-level `idParam: "systemId"`
  baked into `incidentAccess.incident` and `catalogAccess.system`, after proving
  every consumer declares its own per-proc `instanceAccess`. Add a boot guard so
  a team-scopable endpoint with no `instanceAccess` fails boot instead of
  silently fail-open.

**DECIDED — build now (this branch, §5.1–5.4): Tier 0 clarity + DX**, no schema
change: UI renames, always-visible privacy toggle, an "effective access"
read-out, and boot-time output-shape validation.

**PROPOSED — not yet approved (§4): Tier 1 model collapse.** Target A (collapse
the three grant booleans into one ordered `level`) → Target B (one relation-tuple
table that also absorbs `teamOnly`, `resource_create_grant`, and `team_manager`).
This is what takes the admin from five concepts to two. Needs sign-off before
schema work. **Tier 2 (resource hierarchy)** is deferred unless the child-privacy
gap causes real incidents.

---

## 1. Current state (verified `file:line` anchors)

### 1.1 The engine (keep this)

- Central enforcement: `autoAuthMiddleware`, `core/backend-api/src/rpc.ts:117-640`.
  Per request it qualifies each access rule to `{pluginId}.{resource}.{level}`,
  partitions rules into global-only / single (`idParam`) / list (`listKey`) /
  record (`recordKey`) / create, then: anonymous→pass; public→global checks;
  auth requirement; user-type check; **service short-circuit (trusted)**
  (`:233-252`); global-rule check (`:260`); single-resource pre-check
  (`:275-331`, now fail-closed); create pre-check + optional parent gate
  (`:346-409`); run handler; post-grant owner write (`:421-442`); list/record
  post-filter (`:446-635`).
- Single-resource resolution `checkResourceTeamAccess`,
  `core/auth-backend/src/router.ts:1978-2049`; list mirror
  `getAccessibleResourceIds`, `:2051-2130`. Both read `teamOnly` **before** the
  zero-grant short-circuit (`:1999-2004`) — a load-bearing ordering hazard (see
  §2.1).

### 1.2 The five primitives (the problem surface) — all in `core/auth-backend/src/schema.ts`

| Primitive | Table | What it encodes |
|---|---|---|
| Role + access rule | `role`, `access_rule`, `role_access_rule` (`:66-93`) | "what verbs may a principal do, platform-wide" (flat RBAC, `*` wildcard, `isDefault`/`isPublic`) |
| Resource grant | `resource_team_access.canRead` / `.canManage` (`:270`) | "team T may read/manage resource `type:id`" (two booleans) |
| Owner | `resource_team_access.isOwner` (`:284`, partial-unique) | "exactly one team owns `type:id`" (≈ redundant with `canManage`) |
| Privacy | `resource_access_settings.teamOnly` (`:254`) | "this resource opts out of the global read path" |
| Create capability | `resource_create_grant` (`:310`) | "team T's members may create resources of `type`" |
| (Team admin) | `team_manager` (`:235`) + `assertTeamManagementAccess` (`router.ts:138-177`) | "user U may manage team T's membership" (a fourth, bespoke auth check) |

### 1.3 Concept counts to use the system correctly

- **Platform admin: ~13** — identity types, roles, access rules, `*`,
  `isDefault`/`isPublic` defaults + their disable-tracking tables, teams,
  membership, team managers, read/manage grants, `is_owner`, `teamOnly`,
  create-capability, applications/API keys.
- **Team manager: ~3** — team, members, managers (plus the *negative* knowledge
  that they cannot grant resource access).
- **Plugin author: ~10-12** — `proc({userType, access})`, `access()`/`accessPair()`
  with `pluginId`, `read`/`manage` levels, qualified-id matching, `isDefault`/
  `isPublic`, the four `instanceAccess` modes + `create.parent`/`teamIdParam`/
  `idField`, the **implicit keying contract** (§2.3), list/record output shape,
  `serviceScope`.

---

## 2. The problem, in three parts

### 2.1 Five-way encoding of one idea (accidental complexity)

Every mature ReBAC system (Zanzibar/OpenFGA) and even the IAM systems (GCP
"role on resource for member") express all of §1.2 as **one relation: principal →
relation → object**. checkstack expresses it as five separate tables/concepts.
Evidence it is *accidental*, not inherent:

- `is_owner` is never read by any authorization check — only written by
  `setResourceOwner` (`router.ts:2435-2469`), which always sets
  `canRead=canManage=true`. It exists only to enforce "one owner" and to support
  future "owned-by-team" queries. For *access*, it duplicates `canManage`.
- `teamOnly` is "is this private?" stored in a **separate table** from grants, so
  privacy and grants can drift, forcing the "read `teamOnly` before the zero-grant
  short-circuit or you leak" comment (`router.ts:1999-2004`). In a relation model
  privacy is just *the absence of a `public#viewer` relation* — one table, no
  ordering hazard.
- `resource_create_grant` is a third grant table with its own RPC trio and its
  own authorize path (`authorizeResourceCreate`, `router.ts:2328-2433`), layered
  alongside the global-manage path and the parent-gated-create path
  (`rpc.ts:357-398`) — the docs admit "three independent create paths"
  (`docs/.../concepts/teams-and-access.md:91`). A `creator` relation on a
  type-level object collapses this.
- `team_manager` is the same "subject has relation on object" shape modelled a
  fourth way as bespoke imperative checks.
- `canRead`/`canManage` is a denormalised 2-bit enum forcing
  `action === "manage" ? canManage : canRead` branching at every call site
  (`router.ts:2043`, `:2106`, `:2169`).

### 2.2 UI topology + naming (the admin-facing pain)

- **"Team access" silently means "who can *change* this", not "who can *see* it"**
  — read is already global, so adding a team only changes *change* rights. The
  default grant is `canManage:true` (`TeamAccessEditor.tsx:169`). The word
  "access" does two jobs.
- **One concept, four screens:** the grant editor (resource page), the **Private**
  toggle (hidden *inside* that editor, only after a grant exists,
  `TeamAccessEditor.tsx:285`), the **Owning team** picker (create form only), and
  **Resource creation** capability (team page). `TeamResourceGrantsSummary` can
  only *show* a team's grants, not edit them (`:79-82`).
- **No "read-only subset" path.** The model is purely additive
  (`hasGlobalAccess OR grant`), so "this person sees only these two systems"
  requires first stripping their role's global read — two screens away.
- **No "effective access" read-out** anywhere: debugging "why can Bob change X?"
  means visiting Roles + Users + Teams + the resource page.

### 2.3 The implicit keying contract (the plugin-author pain → the bug class)

For each `instanceAccess` mode the author must guarantee an *unstated* equality:
`idParam` value (single), each list item `.id` (list), each record **key**
(record), and `create.idField` (create) MUST equal the grant's stored
`resourceId` (the object's own id, written by the frontend editor), and the
rule's `{pluginId}.{resource}` MUST equal the frontend `resourceType` string.
Nothing ties these four separately-authored literals together. Consequences,
ranked by danger:

- **FAIL OPEN:** forgotten `instanceAccess` on an object endpoint (enforced only
  at the global-rule level); `idParam` pointing at a *parent* id while the handler
  mutates a *child* (the catalog IDOR). The shared rule's
  `idParam: "systemId"` default (`incident-common/src/access.ts:29`,
  `catalog-common/src/access.ts:31`) is *wrong for every object-scoped mutation*
  and only saved by ~20 per-proc overrides — forget one and it skips/denies.
- **FAIL SILENTLY:** `listKey`/`recordKey` keyed on `systemId` while grants are
  object-id (the bulk-endpoint bug — fixed by *removing* the `recordKey`); wrong
  `create.idField` → ownerless resource; frontend `resourceType` string drift.
- **FAIL CLOSED (safe):** typo'd/absent `idParam` (now caught at boot,
  `plugin-loader.ts:894`).

The boot validator (`validateContractInstanceAccess`,
`plugin-loader.ts:832-924`) catches multiple/empty modes and input-path typos,
but **cannot** see keying *correctness* (right field vs the grant key), output
shape (`listKey` is an array of `{id}`, `recordKey` keys are object-ids), wrong
`create.idField`, or a *missing* `instanceAccess`.

---

## 3. Essential vs accidental — what we keep and what collapses

**Keep (essential):** two orthogonal questions (verbs via roles, scope via
grants); team as the grant *subject*; readable-by-default + private opt-in as the
*behaviour*; the notion of a single owning team.

**Collapse (accidental):** the five distinct encodings in §2.1. The target is one
relation primitive `(object, relation, subject)` with relations carrying built-in
implication (`owner ⊃ editor ⊃ viewer`), privacy as the presence/absence of a
`public#viewer` relation, and create-capability as a `creator` relation on a
type-level object.

---

## 4. PROPOSED target model (needs sign-off before schema work)

### 4.1 Target A — one ordered `level` (smallest change, big clarity win)

Replace `canRead`/`canManage`/`isOwner` with a single ordered enum
`viewer < editor < owner`. The `action === "manage" ? canManage : canRead`
branching becomes `level >= required`. **Admin mental model:** *"give a TEAM a
LEVEL on a RESOURCE."* This is the GitHub repo-permissions model verbatim.

- **Migration (append-only, per `migrations.md`):** add `level` column; backfill
  in the same migration (`isOwner→owner`, `canManage→editor`, `canRead→viewer`);
  a follow-up migration drops the booleans once code no longer reads them.
- **Risk:** low. Loses "manage but not read" (nonsensical anyway). Does **not**
  fix `teamOnly`/create-grant/team-manager sprawl.

### 4.2 Target B — one relation-tuple table (the real target)

One table of `(object, relation, subject)` tuples. `object` =
`{resourceType}:{resourceId}` (or `{resourceType}:*` for type-level), `relation` ∈
`{viewer, editor, owner, creator}`, `subject` = a team (or the special
`public` subject, or a user for `manager`-of-team). Resolution becomes a generic
`check(object, relation, subject-set)` + `listObjects(type, relation,
subject-set)` — exactly the two S2S primitives we already need.

- **What disappears:** `resource_access_settings`/`teamOnly` (privacy =
  presence/absence of a `public#viewer` tuple, materialised at create time where
  `setResourceOwner` already runs, `rpc.ts:433-440`); `resource_create_grant`
  (folds into `creator` tuples on `type:*`) and its RPC trio; optionally
  `team_manager` (a `manager` relation on `team:id`) and `assertTeamManagementAccess`.
- **Admin mental model: 2 concepts** — *"grant a RELATION to a TEAM on an
  OBJECT."* (OpenFGA/Zanzibar / GCP "role on resource for member").
- **Migration:** new `relation_tuple` table; data migration fans the existing
  tables into tuples; the four S2S endpoints collapse to two — a net *reduction*
  of the auth-backend surface.
- **Risk:** moderate. The "absence = public" shortcut must be chosen carefully or
  it reintroduces the `teamOnly`-ordering bug in new clothes; safest is an
  explicit `public#viewer` tuple written at create time. Conceptual reframe for
  the team, but strictly fewer concepts.

### 4.3 Sequencing

Ship **A** as the cheap down-payment (pure clarity, mechanical migration), then
**B** once we are willing to migrate the S2S surface. Do **not** build B before
the maintainer signs off on this section.

### 4.4 Target C — resource hierarchy (DEFERRED, orthogonal)

Declare parent edges between resource types (seed already exists in
`create.parent`, `rpc.ts:357-384`) so privacy/grants flow downhill (system → its
health checks/contacts), GCP-folder-style. Closes the "marked the child private
but it leaked" gap (`docs/.../backend/teams.md` warning). High risk (recursive
resolution → Zanzibar-style caching/consistency concerns). Defer unless it bites.

---

## 5. APPROVED work for this branch (no Tier 1 schema change)

### 5.1 Rename the grant editor to its real job

"Team access" → **"Who can change this"** in `TeamAccessEditor.tsx` and
`ScopeToTeamDialog`; default action stays Manage; demote the read-only grant to a
sub-option that auto-reveals only when the resource is Private (where read grants
actually matter). Copy-only; no schema change.

### 5.2 Make the privacy control discoverable

Always render the **Private** toggle (drop the `typedAccessList.length > 0`
condition at `TeamAccessEditor.tsx:285`); rename to "Hide from everyone else";
keep the existing guard that auto-disables it when the last grant is removed
(`:206-214`). When toggled on with no team, prompt to add one.

### 5.3 "Effective access" read-out

Extend `ResourceManagedBy` so the resource side answers *who, by name* can change
a resource (resolve team grants → member users/applications). Add a per-team view
on the Teams page that lists the team's resource grants (currently only counted by
`TeamResourceGrantsSummary`). Read-only; reuses existing S2S reads. Honour
`isLowPower` (no animated expanders). **This is the largest Tier 0 item — scope it
to a read-only resolver, not an editor.**

### 5.4 DX boot guards (make the unsafe path loud)

In `validateContractInstanceAccess` (`plugin-loader.ts`):
- **Require an explicit decision:** a procedure whose `access` rule names a
  team-scopable resource type (one in `collectResourceKinds`,
  `plugin-manager.ts:92`) MUST declare `instanceAccess`, else fail boot. (Add an
  explicit `instanceAccess: { global: true }` escape hatch for intentionally
  unscoped endpoints.) Kills the #1 fail-open.
- **Cross-check output shape:** `listKey` resolves to a `z.array` of `ZodObject`
  with an `.id`; `recordKey` resolves to a `z.record`; `create.idField` exists in
  the *output* schema. Pull the current request-time 500s (`rpc.ts:457-473`)
  forward to boot. (The semantic systemId-vs-object-id mismatch still can't be
  seen statically — note that limitation in the validator comment.)

### 5.5 The two decided fixes

- **#1 (docs):** in `docs/.../concepts/teams-and-access.md` (the permissions
  table row) and any developer-doc echo, drop the "**and** manage access to that
  resource" clause from "grant/revoke a team's access". State plainly: granting a
  team access to a resource, making it private, and granting create-capability are
  **`auth.teams.manage` (admin) actions**. No code change.
- **#2 (code) — bigger than expected; audit done 2026-06-10.** The plan was
  "remove the rule-level `idParam: "systemId"` since it's only ever overridden."
  The audit disproved the "only ever overridden" premise — **three consumers
  inherit the default and are already subtly mis-scoped by it:**
  - `getIncidentsForSystem` (`incident-common/src/rpc-contract.ts:55`) carries a
    comment claiming it is "left unscoped deliberately", but having no per-proc
    `instanceAccess` it **inherits** `idParam: "systemId"` and runs a
    single-resource check of a *systemId* against *incident-id* grants — the exact
    mismatch the comment says to avoid. It only passes today because
    `incident.read` is `isDefault`+`isPublic` (callers satisfy it via global
    access); a team-only caller without global incident-read would be wrongly
    denied. The maintenance equivalent (`getMaintenancesForSystem`) likely shares
    this.
  - `getSystems` (`catalog-common/src/rpc-contract.ts:86`, no input) and
    `getEntities` (`:75`) are **list-all** endpoints with **no `listKey`** that
    inherit a meaningless `idParam: "systemId"`. Post the fail-closed change, a
    team-only caller is denied outright; a global caller gets the full,
    *unfiltered* list (the known "list-all endpoints lack instanceAccess" gap,
    observation 11749).

  So #2 is not a mechanical removal — it requires a **per-endpoint scoping
  decision** for each inheritor (e.g. `getSystems` should gain
  `listKey: "systems"`; `getIncidentsForSystem`'s cross-plugin gating on
  `catalog.system` is a genuine open design question the middleware can't express
  today). **Correct sequencing:**
  1. Build the §5.4 boot guard + an explicit `instanceAccess: { global: true }`
     escape hatch first.
  2. Make `instanceAccess` explicit on every consumer of `incidentAccess.incident`
     / `catalogAccess.system` (real scoping for the list endpoints; `global: true`
     for the genuinely-unscoped/service ones; resolve the `getIncidentsForSystem`
     cross-plugin gating).
  3. Only then drop instance-config from `accessPair`/`access` so the rule layer
     can never carry a key again — the boot guard now prevents regressions.

  This makes #2 a scoped sub-project, not a quick fix. It is the highest-value DX
  hardening but should land as its own reviewed change, after Tier 0's cheap
  clarity wins.

---

## 6. Decision record

- **Grant-gating = admin-only (not delegated).** Maintainer chose 2026-06-10:
  granting a team access to a resource is a platform-admin action; resource
  managers do **not** self-assign teams. Simpler, central, matches shipped code;
  rejected the "manage-the-resource also grants" delegation model.
- **Engine kept, encoding collapsed.** Rejected rebuilding on an external policy
  engine (Backstage-style open policy function) — the fixed relation table is the
  deliberate simplification that gives every plugin one engine for free.
- **A before B; C deferred.** Rejected jumping straight to relation tuples without
  the cheap `level` down-payment, and rejected building the resource hierarchy
  pre-emptively.

## 7. Open questions for sign-off

1. Approve Target B as the destination (yes → A is a stepping stone; no → stop at
   A or stay as-is)?
2. Fold `team_manager` into the tuple table in B, or leave it as a separate
   concept?
3. For §5.3, is a read-only "effective access" view enough for now, or do we also
   want per-team grant *editing* moved onto the Teams page (bigger change)?

---

## 8. Target B — concrete build spec (APPROVED 2026-06-10)

Collapse the resource-access layer (NOT roles/access-rules, NOT team_manager)
onto one relation-tuple table, expose a generic tuple API, and preserve today's
behaviour exactly.

### 8.1 Schema — `relation_tuple`

One table (auth-backend schema), forward-only migration `0007`:

```
relation_tuple(
  object_type   text not null,   -- qualified type, e.g. "catalog.system"
  object_id     text not null,   -- the resource id; "*" for type-level (creator)
  relation      text not null,   -- 'viewer' | 'editor' | 'owner' | 'creator'
  subject_type  text not null,   -- 'team' | 'public'
  subject_id    text not null,   -- teamId; "*" for the public subject
  created_at    timestamptz default now(),
  PRIMARY KEY (object_type, object_id, relation, subject_type, subject_id)
)
```

Indexes:
- `(subject_type, subject_id, object_type, relation)` — listObjects / "what can this team touch".
- `(object_type, relation, subject_type, subject_id)` — hasAnyTypeGrant.
- Partial UNIQUE `(object_type, object_id) WHERE relation='owner' AND subject_type='team'` — at most one owning team (replaces the old `is_owner` partial unique).
- FK on `subject_id -> team.id` only when `subject_type='team'` is not expressible as a plain FK (subject_id is polymorphic); enforce team existence in the write path, and cascade team deletion by deleting tuples with `(subject_type='team', subject_id=teamId)` in the existing team-delete handler.

### 8.2 Relations (with implication) + privacy

- Implication: **owner ⊃ editor ⊃ viewer**. "can read" needs viewer|editor|owner;
  "can manage" needs editor|owner.
- `creator` lives only on `object_id='*'` (type-level): "team may create this type".
- **Privacy marker** = a tuple `(type, id, 'viewer', 'public', '*')`. Semantics:
  "the GLOBAL (RBAC) path is open for this object" — global read-rule grants read,
  global manage-rule grants manage. Its ABSENCE (when the object has team grants)
  = private (teamOnly): team grants only, for both read and manage.
- **Default-open preserved without per-resource tuples:** an object with NO tuples
  at all falls back to the global RBAC rule (today's "no grants -> hasGlobalAccess").
  We only ever write a `public` marker for objects that ALSO have a team grant and
  are not private (so privacy is the absence of that marker *among grant-bearing
  objects*, never "every resource needs a public row").

### 8.3 Engine (replaces the 5 S2S methods)

Two primitives in the tuple store; the `AuthService` S2S surface is reshaped to
these (middleware `rpc.ts` updated to match):

```
check({ userTeamIds, objectType, objectId, action, hasGlobalAccess }) -> bool
  rows = tuples for (objectType, objectId)
  grants = rows where subject_type='team'
  if grants.length == 0: return hasGlobalAccess          // default-open
  publicOpen = rows has (viewer, public)
  if publicOpen && hasGlobalAccess: return true
  need = action==='read' ? {viewer,editor,owner} : {editor,owner}
  return grants.some(g => userTeamIds.includes(g.subject_id) && need.has(g.relation))

listAccessibleObjectIds({ userTeamIds, objectType, candidateIds, action, hasGlobalAccess }) -> string[]
  // same logic per id, batched in one query over candidateIds

hasAnyTypeGrant({ userTeamIds, objectType, action }) -> bool        // for the G11 403
  EXISTS tuple (objectType, *any id*, need-relation, team in userTeamIds)

canCreate({ userTeamIds, objectType, hasGlobalManage }) -> { allowed, eligibleTeamIds }
  hasGlobalManage || teams with (objectType:'*', 'creator')
```

Owner write at create = `writeRelation(owner, team)` + (unless private) the
`public` marker. `is_owner`/`teamOnly`/`resource_create_grant` cease to exist.

### 8.4 Generic tuple API (auth-common contract — BREAKING)

Replace `setResourceTeamAccess` / `removeResourceTeamAccess` /
`getResourceTeamAccess` / `getResourceAccessSettings` / `setResourceAccessSettings`
/ `grantResourceCreate` / `revokeResourceCreate` / `listResourceCreateGrants` /
`listTeamResourceGrants` with:

- `writeRelation({ objectType, objectId, relation, teamId })` (teams.manage) — upsert a team tuple; `owner` enforces single-owner.
- `deleteRelation({ objectType, objectId, relation, teamId })` (teams.manage).
- `setObjectPublic({ objectType, objectId, public: boolean })` (teams.manage) — add/remove the `public` viewer marker (the privacy toggle).
- `listObjectRelations({ objectType, objectId })` (teams.read) — `{ teams: [{teamId, teamName, relation}], public: boolean }` (powers "Who can change this").
- `listSubjectRelations({ teamId })` (teams.read) — `[{ objectType, objectId, relation }]` (powers the Teams-page grant list).
- `getResourceKinds`, `resolveResourceNames`, `searchResources` — unchanged.

S2S (service): `check`, `listAccessibleObjectIds`, `hasAnyTypeGrant`, `canCreate`,
plus the owner/public writes used by create-mode. `AuthService` interface +
`core-services` + every mock updated to match; `rpc.ts` create/post-filter paths
call the new methods.

The frontend (`TeamAccessEditor`, `TeamResourceGrantsEditor`, `ResourceManagedBy`,
`deriveTeamAccessSummary`, the create owner-pickers) maps onto the new API:
read=viewer, manage=editor, owner=owner, private=`!public`.

### 8.5 Migration (forward-only `0007`, backfill + drop)

In ONE migration file, data-SQL before the drops (per migrations.md):
1. `INSERT INTO relation_tuple` from:
   - `resource_team_access`: `is_owner` -> owner; else `can_manage` -> editor;
     else `can_read` -> viewer. (subject_type='team', subject_id=team_id)
   - `resource_create_grant` -> (object_id='*', 'creator', team).
   - The `public` marker: for every DISTINCT (resourceType,resourceId) present in
     `resource_team_access` that is NOT teamOnly in `resource_access_settings`
     (or absent there) -> `(type, id, 'viewer', 'public', '*')`.
2. `DROP TABLE resource_team_access, resource_access_settings, resource_create_grant;`
   (the `is_owner` column + partial indexes go with the table.)

### 8.6 Phasing (green per commit)

1. Schema + migration + `relation-tuple-store.ts` (the two primitives) + unit tests.
2. Reshape `AuthService` + auth-backend S2S handlers over the store; update
   `core-services` + all mocks; update `rpc.ts`. (Engine cutover.)
3. Generic user-facing endpoints; delete old handlers.
4. Frontend onto the generic API.
5. Drop-table migration verified on a populated DB; docs + changeset; remove dead
   schema/types.

### 8.7 Out of scope (kept)

Roles + access_rules (RBAC), `team` / `userTeam` / `applicationTeam` / `team_manager`
(membership + team admin), and the cross-plugin resource resolver are unchanged.
