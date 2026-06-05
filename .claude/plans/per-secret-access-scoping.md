# Per-secret + per-connection access scoping (write-time use-gate)

> **Status:** planned (design locked 2026-06-03, not started)
> **Branch:** TBD (off the integration/all-features worktree, HEAD `b7c1e91b`)
> **Original ask (verified by a security review):** the secret + connection
> model is flat and instance-global. `secret.read` (a default rule) lets any
> authed user see secret NAMES (never values — values are write-only, resolved
> server-side at runtime); `secret.manage` gates create/rotate/delete.
> Connections are gated only by `integration.manage`. There is **no per-secret
> or per-connection ownership/ACL**. Consequence: ANY holder of
> `automation.manage` / `healthcheck.configuration.manage` can author a config
> that references `${{ secrets.PROD_DB_PASSWORD }}` or any `connectionId` and
> have it resolved at runtime — and because the same holder can edit the SCRIPT
> BODY around the reference (e.g. add a `fetch` that exfiltrates the resolved
> value), merely being able to SAVE a config that references a secret is enough
> to abuse it.

Self-contained handoff. Pick up from this document alone. Every current-state
claim carries a `file:line` anchor against the integration worktree (HEAD
`b7c1e91b`). The rigor exemplar this plan matches is
[`.claude/plans/ai-assistant-context-tools.md`](./ai-assistant-context-tools.md)
(and the plans it cites). Where a mechanism could not be fully verified it is
flagged explicitly rather than invented.

---

## 1. The decided model (what this plan builds)

- **Write-time gate on the ACTING principal, ALL references (not delta-based).**
  A create OR update of any secret/connection-referencing config is allowed only
  if the acting principal is authorized for EVERY secret AND connection the
  **post-edit** config references. All-references, not just newly-added: editing
  the script body can exfiltrate a pre-existing reference, so touching a config
  that references secret `S` requires use-access to `S`. **No authorship
  tracking.**
- **Runtime resolution is UNCHANGED.** The gate lives entirely at the write
  boundary. A saved config still resolves whatever it declares at run time
  (`SecretResolverService.resolveForRun` /`resolveBySchema`,
  [core/secrets-backend/src/resolver-service.ts:50](../../core/secrets-backend/src/resolver-service.ts#L50),
  [:39](../../core/secrets-backend/src/resolver-service.ts#L39)) — we do not
  touch it.
- **`secret.read` stays default** (names remain visible to all authed users for
  `${{ secrets.* }}` autocomplete,
  [core/secrets-common/src/access.ts:12](../../core/secrets-common/src/access.ts#L12),
  [core/secrets-common/src/rpc-contract.ts:34](../../core/secrets-common/src/rpc-contract.ts#L34)).
  The NEW gate is on USE (referencing/resolving), **not** name-listing.

---

## 2. What exists today (verified substrate)

### 2.1 The generic team-grant engine — reuse it, do not reinvent

The platform **already has** a generic, per-resource, team-scoped grant model in
auth, and a generic enforcement engine in the RPC middleware. This is the
substrate for per-secret/per-connection grants.

- **`resourceTeamAccess` table**
  ([core/auth-backend/src/schema.ts:268](../../core/auth-backend/src/schema.ts#L268)):
  `(resourceType, resourceId, teamId)` → `canRead` / `canManage` booleans. PK is
  `[resourceType, resourceId, teamId]`. Shared Postgres.
- **`resourceAccessSettings` table**
  ([core/auth-backend/src/schema.ts:252](../../core/auth-backend/src/schema.ts#L252)):
  `(resourceType, resourceId)` → `teamOnly: boolean`. When `teamOnly` is false a
  global access-rule holder also passes; when true, ONLY a team grant passes.
- **Teams** (`team`, `userTeam`, `applicationTeam`, `teamManager`,
  [schema.ts:183](../../core/auth-backend/src/schema.ts#L183)–[:246](../../core/auth-backend/src/schema.ts#L246)):
  users and API-key applications belong to teams M:N; `teamManager` users can
  manage a specific team's membership + resource access.
- **The S2S check** `AuthService.checkResourceTeamAccess`
  ([core/backend-api/src/types.ts:112](../../core/backend-api/src/types.ts#L112),
  implemented [core/auth-backend/src/router.ts:1783](../../core/auth-backend/src/router.ts#L1783)):
  given `{ userId, userType, resourceType, resourceId, action, hasGlobalAccess }`
  returns `{ hasAccess }`. Logic:
  - **No grants for the resource ⇒ `hasAccess = hasGlobalAccess`** (open by
    default; [router.ts:1804](../../core/auth-backend/src/router.ts#L1804)).
  - Grants exist + not `teamOnly` + caller has global ⇒ allow
    ([:1825](../../core/auth-backend/src/router.ts#L1825)).
  - Otherwise: allow iff caller is in a team whose grant has the `canRead`/
    `canManage` bit for the requested action
    ([:1845](../../core/auth-backend/src/router.ts#L1845)).
  - **Bulk variant** `getAccessibleResourceIds`
    ([types.ts:124](../../core/backend-api/src/types.ts#L124),
    [router.ts:1853](../../core/auth-backend/src/router.ts#L1853)) for filtering
    a list of ids in one call.
- **The enforcement engine** `autoAuthMiddleware`
  ([core/backend-api/src/rpc.ts:116](../../core/backend-api/src/rpc.ts#L116))
  already wires this for any access rule that declares `instanceAccess`
  (`idParam` / `listKey` / `recordKey`,
  [core/common/src/access-utils.ts:179](../../core/common/src/access-utils.ts#L179)):
  single-resource pre-check ([rpc.ts:271](../../core/backend-api/src/rpc.ts#L271)),
  list post-filter ([:320](../../core/backend-api/src/rpc.ts#L320)), record
  post-filter ([:396](../../core/backend-api/src/rpc.ts#L396)), all fail-closed
  ([:609](../../core/backend-api/src/rpc.ts#L609),
  [:646](../../core/backend-api/src/rpc.ts#L646)).
- **Resource type qualification** `qualifyResourceType(pluginId, resource)`
  ([rpc.ts:131](../../core/backend-api/src/rpc.ts#L131)) produces the
  `resourceType` string (e.g. `secret.secret`).
- **The grant-management RPCs** (gated by `auth.teams.manage`):
  `setResourceTeamAccess` / `removeResourceTeamAccess` / `getResourceTeamAccess`
  and `setResourceAccessSettings` / `getResourceAccessSettings`
  ([core/auth-common/src/rpc-contract.ts:630](../../core/auth-common/src/rpc-contract.ts#L630)–[:698](../../core/auth-common/src/rpc-contract.ts#L698)).
- **The principal in a handler**: `RpcContext.user` is an `AuthUser`
  ([rpc.ts:47](../../core/backend-api/src/rpc.ts#L47)); `RealUser`/`ApplicationUser`
  carry `accessRules: string[]` ([types.ts:66](../../core/backend-api/src/types.ts#L66))
  so the `hasGlobalAccess` input is computable inline as
  `accessRules.includes("*") || accessRules.includes(qualifiedRule)`.
  `context.auth` is the `AuthService` ([rpc.ts:46](../../core/backend-api/src/rpc.ts#L46)).

> **Design decision (RESOLVED, §9 OQ-1): grants are TEAM-scoped, reusing
> `resourceTeamAccess`.** A new per-principal table would duplicate teams,
> team-manager UX, and the S2S engine. The existing engine already answers
> exactly the question we need ("is principal P authorized for resource R for
> action A, given P's global access?"). We add **two new resource types** to it
> (`secret.secret`, `integration.connection`) and reuse `checkResourceTeamAccess`
> /`getAccessibleResourceIds` verbatim. The "principal" granularity the ask
> mentions is achieved by a single-member team where needed (the standard
> platform pattern; the resource-grant model is team-only by construction).

### 2.2 How secrets / connections are referenced (the extraction surface)

Four distinct reference mechanisms, all verified:

1. **`x-secret` config-string leaves.** A field is marked secret via
   `configString({ "x-secret": true })`
   ([core/backend-api/src/zod-config.ts:184](../../core/backend-api/src/zod-config.ts#L184),
   detected by `isSecretSchema`, [:120](../../core/backend-api/src/zod-config.ts#L120)).
   These hold a `${{ secrets.NAME }}` template (or a literal value). The generic
   schema-driven walker `walkSecretFields({ value, schema, visit })`
   ([core/secrets-backend/src/walk-secret-fields.ts:20](../../core/secrets-backend/src/walk-secret-fields.ts#L20))
   visits every `x-secret` string leaf, handling objects, arrays,
   optional/default/nullable, and discriminated + plain unions — the SAME walk
   the runtime resolver uses.
2. **`${{ secrets.NAME }}` templating anywhere in a value tree.** Captured by
   `SECRET_TEMPLATE_REGEX` ([core/secrets-common/src/secret-field.ts:37](../../core/secrets-common/src/secret-field.ts#L37));
   the pure recursive collector `collectSecretNames({ value })`
   ([:55](../../core/secrets-common/src/secret-field.ts#L55)) returns every
   referenced name from an arbitrary object tree (used today by gitops
   reconcile, [core/gitops-backend/src/sync/reconciler.ts:122](../../core/gitops-backend/src/sync/reconciler.ts#L122),
   and the run-secret resolver, [resolver-service.ts:85](../../core/secrets-backend/src/resolver-service.ts#L85)).
3. **`secretEnv` mappings.** A least-privilege `{ ENV_VAR: "${{ secrets.NAME }}" }`
   allowlist on script actions/collectors (`secretEnvMappingSchema`,
   [core/secrets-common/src/env-mapping.ts:76](../../core/secrets-common/src/env-mapping.ts#L76);
   a bare name is tolerated and normalized via `normalizeSecretEnvValue`,
   [:61](../../core/secrets-common/src/env-mapping.ts#L61)).
4. **`connectionId` references.** A connection is referenced by a plain
   `configString` field conventionally named `connectionId`, marked with an
   `x-options-resolver` whose source is the provider's connection-options
   resolver (e.g. [plugins/integration-jira-backend/src/automations.ts:72](../../plugins/integration-jira-backend/src/automations.ts#L72)).
   The owning action declares `connectionProviderId`
   ([core/automation-backend/src/action-types.ts:335](../../core/automation-backend/src/action-types.ts#L335),
   surfaced [router.ts:480](../../core/automation-backend/src/router.ts#L480)).
   **There is NO `x-connection` schema marker today** — the binding is the
   `connectionId` config KEY + the action's `connectionProviderId`. (See OQ-2.)

An **existing partial extractor** already walks an automation's action tree
(choose/parallel/repeat/sequence) collecting every `config.secretEnv` map and
every literal `config.connectionId`: `collectDeclaredSecretRefs(definition)`
([core/automation-backend/src/dispatch/reseed-run-secrets.ts:87](../../core/automation-backend/src/dispatch/reseed-run-secrets.ts#L87)).
It deliberately skips templated connection ids (those containing `${{`). It does
**not** walk `x-secret` fields or `${{ secrets.* }}` in arbitrary config fields,
so it is not by itself sufficient (see §4).

### 2.3 Where secrets / connections physically live

- **Secrets** are keyed by **name** (unique), stored behind a pluggable backend
  (local Postgres `secrets` table,
  [core/secrets-backend-local/src/schema.ts:10](../../core/secrets-backend-local/src/schema.ts#L10),
  or Vault). The name is the only stable cross-backend identifier — **the grant
  `resourceId` must be the secret NAME**, not a row id (a Vault secret has no
  Postgres row).
- **Connections** are NOT a Postgres table — they live IN the secret backend
  under key pattern `integration_connection_{providerId}_{connectionId}`
  ([core/integration-backend/src/connection-store.ts:6](../../core/integration-backend/src/connection-store.ts#L6)),
  identified by `connectionId` (a UUID string). **The grant `resourceId` is the
  `connectionId`.**

Both are stable string ids ⇒ both fit `resourceTeamAccess(resourceType,
resourceId, teamId)` directly, in shared Postgres, with the same answer on every
pod (the engine is a DB read). **State-and-scale:** no new physical state beyond
the existing shared table; no pod-local state.

### 2.4 The write paths to gate (verified call sites)

| Plugin | Create | Update | Validate (propose) |
| --- | --- | --- | --- |
| Healthcheck | `createConfiguration` ([core/healthcheck-backend/src/router.ts:161](../../core/healthcheck-backend/src/router.ts#L161), gated `configuration.manage`) | `updateConfiguration` ([:188](../../core/healthcheck-backend/src/router.ts#L188)) | `validateConfiguration` ([:170](../../core/healthcheck-backend/src/router.ts#L170), gated `configuration.manage`) |
| Automation | `createAutomation` ([core/automation-backend/src/router.ts:179](../../core/automation-backend/src/router.ts#L179), gated `automation.manage`) | `updateAutomation` ([:199](../../core/automation-backend/src/router.ts#L199)) | `validateDefinition` ([:257](../../core/automation-backend/src/router.ts#L257), gated `automation.**read**`) |
| AI | `automation.propose` ([core/ai-backend/src/tools/automation-propose.ts](../../core/ai-backend/src/tools/automation-propose.ts)) + `healthcheck.propose` ([core/ai-backend/src/tools/healthcheck-propose.ts:146](../../core/ai-backend/src/tools/healthcheck-propose.ts#L146)) | — | the propose tools' `dryRun` |
| GitOps | `reconcileEntity` ([core/gitops-backend/src/sync/reconciler.ts:184](../../core/gitops-backend/src/sync/reconciler.ts#L184)) — no interactive principal | — | — |

Healthcheck config shape: a strategy `config` plus `collectors[].config`
([core/healthcheck-common/src/schemas.ts:78](../../core/healthcheck-common/src/schemas.ts#L78),
[:65](../../core/healthcheck-common/src/schemas.ts#L65)); each `config` is a
`z.record(z.unknown())` validated against the registered strategy/collector zod
schema (which carries the `x-secret` metadata) — schemas resolved via
`collectorRegistry.getCollector(id).collector.config.schema`
([core/healthcheck-backend/src/healthcheck-gitops-kinds.ts:203](../../core/healthcheck-backend/src/healthcheck-gitops-kinds.ts#L203)).
Automation definition shape: `triggers[]` + `actions[]`; a provider action is
`{ action: "plugin.id", config }` (`ProviderActionSchema`,
[core/automation-common/src/schemas.ts:333](../../core/automation-common/src/schemas.ts#L333));
each action's schema + `connectionProviderId` resolved via
`actionRegistry.getAction(qualifiedId)`
([core/automation-backend/src/action-registry.ts:64](../../core/automation-backend/src/action-registry.ts#L64),
`RegisteredAction.config.schema`,
[action-types.ts:311](../../core/automation-backend/src/action-types.ts#L311)).

> **CRITICAL — the AI propose tools fan out through the TRUSTED service client.**
> `healthcheck.propose.execute` calls
> `rpcClient.forPlugin(HealthCheckApi).createConfiguration(...)`
> ([healthcheck-propose.ts:232](../../core/ai-backend/src/tools/healthcheck-propose.ts#L232)),
> and `automation.propose` does the same. Service-typed callers are **trusted**
> and SKIP the per-user access middleware
> ([rpc.ts:228](../../core/backend-api/src/rpc.ts#L228)). Therefore a gate placed
> ONLY in the create handler would be bypassed by the propose path. The gate must
> ALSO run inside the propose tools with the **real chat principal** — which the
> propose/apply service threads into `dryRun`/`execute` as `principal: AuthUser`
> ([core/ai-backend/src/propose-apply/service.ts:158](../../core/ai-backend/src/propose-apply/service.ts#L158),
> [:285](../../core/ai-backend/src/propose-apply/service.ts#L285); it rejects
> service principals at [:64](../../core/ai-backend/src/propose-apply/service.ts#L64)).

---

## 3. The ACL / grant model

### 3.1 New resource types (no new table)

Register two access rules with `instanceAccess` so the existing engine treats
them as instance-scoped, AND add a `secret.use` / `connection.use` notion. Two
sub-decisions:

**(a) The use-access rule.** Add a NEW access level `use` to the secrets and
integration access definitions, distinct from `read` (name-listing) and `manage`
(CRUD):

```ts
// core/secrets-common/src/access.ts  (EXTEND)
export const secretsAccess = {
  secret: accessPair("secret", {
    read:   { description: "View secret names and metadata (never values)", isDefault: true },
    manage: { description: "Create, rotate, delete secrets and configure backends" },
  }),
  // NEW — instance-scoped "use" rule. isDefault:true keeps the OPEN-BY-DEFAULT
  // posture (no grants ⇒ hasGlobalAccess decides; see §3.3 + §6 rollout) until
  // a grant is created for a given secret.
  use: access("secret", "use", "Reference a secret in a config (resolve at runtime)", {
    idParam: "secretName",   // instanceAccess ⇒ team-grant aware
    isDefault: true,
  }),
};
```

```ts
// core/integration-common/src/access.ts  (EXTEND)
export const integrationAccess = {
  manage: access("integration", "manage", "Manage webhook integrations and view delivery logs"),
  // NEW — instance-scoped connection "use" rule.
  connectionUse: access("integration", "connection-use", "Reference a connection in a config", {
    idParam: "connectionId",
    isDefault: true,
  }),
};
```

> **Why `isDefault: true` on the use rule (RESOLVED, OQ-3).** The
> `checkResourceTeamAccess` engine is **open-by-default**: with no grants for a
> resource it returns `hasGlobalAccess`
> ([router.ts:1804](../../core/auth-backend/src/router.ts#L1804)). Making `use` a
> default rule means EVERY authed user has `hasGlobalAccess === true` for the
> use-rule, so an **ungranted** secret/connection remains usable by anyone — i.e.
> identical to today's behavior. The gate only BITES once an operator creates a
> grant + (optionally) flips `teamOnly`. This is the linchpin that makes the
> rollout non-breaking (§6). Restriction is **opt-in per secret/connection**.

**(b) The qualified resource types.** `qualifyResourceType("secret", "secret")`
⇒ `"secret.secret"`; `qualifyResourceType("integration", "connection")` ⇒
`"integration.connection"`. The grant rows use these as `resourceType` and the
secret NAME / `connectionId` as `resourceId`.

### 3.2 The access-check functions

A new shared helper module (recommended home:
`core/secrets-backend/src/access-check.ts` for secrets and
`core/integration-backend/src/access-check.ts` for connections, OR a single
`@checkstack/backend-api` helper since both call the same engine — see OQ-4).
Each is a thin wrapper over `context.auth` + the existing S2S engine:

```ts
// Pure-ish; delegates the durable answer to the shared-Postgres engine.
export async function isSecretAccessible(input: {
  auth: AuthService;
  principal: AuthUser;        // the ACTING principal
  secretName: string;
}): Promise<boolean>;

export async function isConnectionAccessible(input: {
  auth: AuthService;
  principal: AuthUser;
  connectionId: string;
}): Promise<boolean>;
```

Implementation (both identical except resourceType/idParam):

1. Service principals (`principal.type === "service"`) ⇒ this helper is **never
   called for them** at the use-gate (the gate runs only for real/application
   principals; see §5). If somehow called, return `false` (fail-closed) — a
   service has no team membership and no business "using" a secret on its own
   behalf.
2. Compute `hasGlobalAccess = accessRules.includes("*") ||
   accessRules.includes(qualifiedUseRuleId)`.
3. Return `auth.checkResourceTeamAccess({ userId: principal.id, userType,
   resourceType, resourceId, action: "read", hasGlobalAccess })`'s `hasAccess`.
   (We map "use" onto the engine's `read` action bit — `canRead` on the grant
   means "may use". `canManage` is reserved for who-may-grant if we later want a
   finer split; for v1 `canRead` = may-use.)

Batch helpers `getAccessibleSecretNames` / `getAccessibleConnectionIds` wrap
`auth.getAccessibleResourceIds` so the gate makes ONE S2S call for all
references, not N.

> **State-and-scale.** (1) State lives in `resourceTeamAccess` /
> `resourceAccessSettings` (shared Postgres). (2) The read is a DB query behind
> the S2S endpoint ⇒ **same answer on every pod**. (3) Not duplicated — the
> grant rows are the single source; the helpers are pure derivations of an S2S
> read. No `defineEntity`/reactive state is introduced.

### 3.3 Who may grant use-access

Grants are written via the existing `setResourceTeamAccess` /
`removeResourceTeamAccess` RPCs, gated by `auth.teams.manage`
([auth-common/src/rpc-contract.ts:647](../../core/auth-common/src/rpc-contract.ts#L647)).
For the secret/connection use-grant surface we want managers of the secret /
connection — i.e. a `secret.manage` / `integration.manage` holder — to grant
use-access **without** requiring full `teams.manage`. Decision:

> **RESOLVED (OQ-5): add thin, secret/connection-specific grant RPCs in the
> secrets/integration plugins, gated by `secret.manage` / `integration.manage`,
> that delegate to the auth grant store via the trusted service client.** A
> `secret.manage` holder is exactly the principal who can create/rotate/delete
> the secret, so letting them decide WHO may USE it is the correct authority
> boundary and avoids over-granting `teams.manage`. These new RPCs
> (`grantSecretUse` / `revokeSecretUse` / `listSecretUseGrants`,
> `grantConnectionUse` / …) call `auth.setResourceTeamAccess(...)` S2S with the
> qualified resource type. (Alternatively keep grants purely in the Teams admin
> UI under `teams.manage`; rejected as worse UX — the operator managing a secret
> shouldn't need the global teams role. See OQ-5.)

---

## 4. Referenced-secret/connection extraction (the reusable pure function)

A single, pure, exhaustively-tested module enumerates every referenced secret
name and connectionId from a post-edit config + its schema. **It must subsume
all four reference mechanisms from §2.2** — the existing
`collectDeclaredSecretRefs` is insufficient because it misses `x-secret` leaves
and arbitrary `${{ secrets.* }}` fields.

```ts
// proposed: a -common home so backend + AI + gitops share it, e.g.
// core/secrets-common/src/collect-references.ts (+ a connection collector).
export interface ReferencedAccess {
  /** Distinct secret NAMES the config references. */
  secretNames: string[];
  /** Distinct literal connectionId values the config references. */
  connectionIds: string[];
}

export function collectReferencedAccess(input: {
  /** The post-edit config value tree (strategy config + collectors, OR the
   *  automation definition's action configs). */
  value: unknown;
  /** Optional per-field zod schema enabling the x-secret-leaf walk. When the
   *  schema is unavailable (e.g. arbitrary JSON), fall back to template +
   *  key-based scanning only. */
  schema?: z.ZodTypeAny;
}): ReferencedAccess;
```

**Extraction algorithm (union of all signals, deduplicated):**

1. **`${{ secrets.NAME }}` everywhere** — run `collectSecretNames({ value })`
   over the WHOLE config tree (covers `x-secret` leaves AND any other string
   field). This is the broadest, schema-free net and is already battle-tested.
2. **`secretEnv` maps** — for every `config.secretEnv` record found, normalize
   each value (`normalizeSecretEnvValue`) and `collectSecretNames` over the
   normalized values (a bare `"jira_token"` ⇒ `jira_token`). Reuse the
   nested-action walk shape from `collectDeclaredSecretRefs`
   ([reseed-run-secrets.ts:87](../../core/automation-backend/src/dispatch/reseed-run-secrets.ts#L87))
   for automation, and walk `collectors[].config` for healthcheck.
3. **`x-secret` leaves with literal values** — when a schema is provided, run
   `walkSecretFields({ value, schema, visit })` and, for any `x-secret` leaf
   whose value is NOT a `${{ secrets.* }}` template (an inline literal),
   **there is nothing to gate** (no secret-name reference). When the leaf IS a
   template, step 1 already captured it. So the schema walk mainly DISAMBIGUATES
   inline-literal vs reference; it adds no new names beyond step 1 for the
   reference case. (Documented so a reviewer understands why step 1 is the
   primary collector.)
4. **`connectionId` references** — collect every literal `config.connectionId`
   string that does NOT contain `${{` (templated ids resolve against live scope
   and cannot be statically attributed — same exclusion as
   `collectDeclaredSecretRefs`, [:99](../../core/automation-backend/src/dispatch/reseed-run-secrets.ts#L99)).
   For automation, walk the full nested action tree. For healthcheck, no
   connection references exist today (verified: no `connectionId` /
   `connectionProviderId` in any `plugins/healthcheck-*-backend`), so the
   healthcheck collector returns an empty `connectionIds` list — but the
   function is uniform.

> **Connection-key reliance (FLAGGED, OQ-2).** Step 4 keys on the config KEY
> `connectionId`, the de-facto convention (jira, and the existing
> `collectDeclaredSecretRefs`). This is a **soft convention, not a schema-level
> guarantee** — a future provider could name its connection field differently.
> Two hardening options, recommended together: (a) cross-check against the
> action's `connectionProviderId` (an action WITHOUT one has no connection to
> gate; an action WITH one SHOULD expose a `connectionId` — assert in a test);
> (b) introduce an explicit `x-connection: true` config marker (mirroring
> `x-secret`) as a follow-up so extraction is schema-driven, not key-driven.
> **Recommendation: ship key-based + `connectionProviderId` cross-check for v1,
> add `x-connection` as a fast-follow.** Do NOT silently assume — the test
> matrix (§7) asserts every shipped connection-backed action uses the
> `connectionId` key so drift is caught.

**Two thin call-shape adapters** (so each write path passes the right tree +
schemas):

- `collectHealthcheckReferences({ input, collectorRegistry, healthCheckRegistry })`
  — resolves the strategy schema + each collector's schema and runs
  `collectReferencedAccess` per `config`.
- `collectAutomationReferences({ definition, actionRegistry })` — walks the
  action tree, resolving each provider action's schema via
  `actionRegistry.getAction(action.action)`.

Both return a merged, deduplicated `ReferencedAccess`.

---

## 5. Uniform enforcement — one shared gate

A single shared function, called at EVERY write path:

```ts
// proposed home: core/backend-api/src/assert-referenced-access.ts
// (backend-api already owns AuthService + the qualify helpers).
export async function assertReferencedAccessAuthorized(input: {
  auth: AuthService;
  principal: AuthUser;            // the ACTING principal (never a service)
  references: ReferencedAccess;   // from §4
}): Promise<void>; // throws ORPCError("FORBIDDEN") listing the denied refs
```

Behavior: compute the principal's two batch sets via
`getAccessibleSecretNames` / `getAccessibleConnectionIds`, diff against
`references`, and if ANY referenced secret or connection is not accessible,
throw `FORBIDDEN` with a message naming the denied references (never echoing
secret VALUES — names only, which the principal can already see via
`secret.read`). Authorized ⇒ resolve.

**Call sites (each anchored):**

| # | Path | Where the gate runs | Principal source |
| --- | --- | --- | --- |
| 1 | `createConfiguration` | top of handler before `service.createConfiguration` ([healthcheck-backend/src/router.ts:161](../../core/healthcheck-backend/src/router.ts#L161)) | `context.user` |
| 2 | `updateConfiguration` | after loading existing, before `service.updateConfiguration` ([:188](../../core/healthcheck-backend/src/router.ts#L188)); references computed from the **merged post-edit** config | `context.user` |
| 3 | `validateConfiguration` | inside handler before returning ([:170](../../core/healthcheck-backend/src/router.ts#L170)) — surfaces denial as a validation error (see note) | `context.user` |
| 4 | `createAutomation` | top of handler before `automationStore.create` ([automation-backend/src/router.ts:179](../../core/automation-backend/src/router.ts#L179)) | `context.user` |
| 5 | `updateAutomation` | before `automationStore.update`, references from post-edit definition ([:199](../../core/automation-backend/src/router.ts#L199)) | `context.user` |
| 6 | `validateDefinition` | inside handler ([:257](../../core/automation-backend/src/router.ts#L257)) — NOTE this RPC is gated only `automation.read` ([rpc-contract.ts:118](../../core/automation-common/src/rpc-contract.ts#L118)); the use-gate adds a per-reference check on TOP of read (does not change its access rule) | `context.user` |
| 7 | `automation.propose` | inside `dryRun` (propose) AND `execute` (apply) | `principal` arg ([propose-apply/service.ts:158](../../core/ai-backend/src/propose-apply/service.ts#L158), [:285](../../core/ai-backend/src/propose-apply/service.ts#L285)) |
| 8 | `healthcheck.propose` | inside `dryRun` AND `execute` ([healthcheck-propose.ts:153](../../core/ai-backend/src/tools/healthcheck-propose.ts#L153), [:227](../../core/ai-backend/src/tools/healthcheck-propose.ts#L227)) | `principal` arg |
| 9 | GitOps `reconcileEntity` | see §6.3 (no interactive principal — special handling) | provider-scoped (not a user) |

> **Update = post-edit, all-references.** For paths 2/5 the gate computes
> references from the FINAL config (existing merged with the patch), NOT the
> delta. This is the core security property: editing a script to exfiltrate a
> pre-existing reference is blocked because touching the config re-checks ALL its
> references. `updateConfiguration` takes a partial body
> ([healthcheck-common/src/schemas.ts:142](../../core/healthcheck-common/src/schemas.ts#L142));
> the handler must merge with the loaded config before extraction.

> **Propose `validate*` semantics.** For the `validate*` paths (3/6) the denial
> should be surfaced as a structured validation error (same
> `{ valid:false, errors:[…] }` shape, [healthcheck-common/src/schemas.ts:128](../../core/healthcheck-common/src/schemas.ts#L128)),
> NOT a thrown FORBIDDEN, so the editor/AI confirm card shows "you lack access to
> secret X" inline. The CREATE/UPDATE paths throw FORBIDDEN. The propose tools'
> `dryRun` translates a denial into an `AiProposalPreview` that the confirm card
> renders as a blocked proposal (mirror of the existing
> `HealthcheckProposeValidationError` flow, [healthcheck-propose.ts:40](../../core/ai-backend/src/tools/healthcheck-propose.ts#L40)).

> **New dependency edges.** healthcheck-backend / automation-backend / ai-backend
> already depend on backend-api; the gate living in backend-api adds NO new
> `@checkstack/*` edge there. The extraction in secrets-common adds a
> secrets-common dep to automation-backend/healthcheck-backend IF not already
> present — verify and run `bun run typecheck:references:generate`
> ([.claude/rules/typecheck.md](../rules/typecheck.md)). (automation-backend
> already imports `@checkstack/secrets-common` via reseed-run-secrets, so the
> edge likely exists.)

---

## 6. Rollout / backfill (the riskiest part)

The danger: turning on an all-references gate would immediately lock users out
of EDITING existing configs that reference secrets/connections they currently
lack a grant for — and today NOBODY has a grant (the table is empty for these
new resource types). The design must guarantee **zero disruption on day one**
and a controlled path to enforcement.

### 6.1 The structural safety: open-by-default until restricted

Because the engine returns `hasGlobalAccess` when a resource has no grants
([router.ts:1804](../../core/auth-backend/src/router.ts#L1804)) and the new
`use`/`connection-use` rules are `isDefault: true`, **an ungranted secret is
usable by every authed user — identical to today**. The gate only restricts a
secret once an operator (a) creates ≥1 grant for it AND (b) the engine's
`teamOnly` logic excludes the caller. Concretely:

- A secret with **no grants** ⇒ `hasAccess = true` for everyone (no change).
- A secret with grants but `teamOnly = false` ⇒ a `use`-default holder (everyone)
  still passes via `hasGlobalAccess` ([:1825](../../core/auth-backend/src/router.ts#L1825)).
  So grants alone don't lock anyone out — they ADD team access on top of global.
- A secret with grants AND `teamOnly = true` ⇒ ONLY granted teams pass. **This
  is the only state that restricts**, and it is per-secret opt-in.

So the rollout's enabling lever is **per-secret `teamOnly`**, set deliberately by
an operator, not a global flag flip. There is no big-bang.

### 6.2 Phased enablement

1. **Phase A — ship the gate in SHADOW/WARN mode (default).** The gate runs at
   every write path, computes the denial set, but on denial it **logs a
   structured warning** (`logger.warn` with principal id + denied refs) and
   ALLOWS the write. A platform meta-config flag
   `secretsAccess.enforcement = "off" | "warn" | "enforce"` (stored in the
   existing config/meta surface — recommend a row in the secrets plugin's own
   config store, [core/secrets-backend/src/backend-config-store.ts](../../core/secrets-backend/src/backend-config-store.ts),
   so it is shared-Postgres and same-answer-on-every-pod) gates the throw.
   Default `warn`. This lets operators SEE who would be blocked before any block
   happens, using real traffic, with zero lockout risk.
2. **Phase B — operators backfill grants.** Provide a one-time backfill action
   (an RPC + an admin UI button, gated `secret.manage`) that, for each secret/
   connection, computes the set of teams whose members currently author configs
   referencing it and creates `canRead` grants for those teams. Source of
   "current references" = scan all healthcheck configs + automations once and run
   the §4 extractor (this is read-only and idempotent). **Recommendation
   (RESOLVED, OQ-6): grant by EXISTING REFERENCES, not by all manage-holders.**
   Granting every `*.manage` holder reproduces the flat model and defeats the
   purpose. Granting by current references preserves exactly today's working set
   while making future restriction meaningful. The backfill is OPT-IN and never
   sets `teamOnly`.
3. **Phase C — operator flips `teamOnly` per sensitive secret/connection.** Only
   now does any restriction take effect, and only for the secrets the operator
   chose. Optionally flip the meta-config to `enforce` so denials throw for
   `teamOnly` resources.

> **Why warn-then-enforce and not delta-grandfathering.** A "grandfather existing
> references" exemption (allow refs that predate the gate) would defeat the
> security goal — the whole point is that EDITING a grandfathered config to add
> an exfiltrating `fetch` must be blocked. So we do NOT grandfather at the
> reference level; we make restriction OPT-IN per secret via grants + `teamOnly`,
> and use warn-mode only as an observability ramp, not a permanent exemption.

### 6.3 GitOps-managed configs (no interactive principal)

GitOps reconcile runs `kindDef.reconcile` on whichever pod claims the sync job,
with **no acting user** ([reconciler.ts:309](../../core/gitops-backend/src/sync/reconciler.ts#L309)).
There is no principal to gate against. Decision:

> **RESOLVED (OQ-7): GitOps is gated at the PROVIDER level, not per-reconcile.**
> A GitOps provider is a trusted, operator-configured source (it already has
> `createdBy`, [core/gitops-backend/src/schema.ts:78](../../core/gitops-backend/src/schema.ts#L78),
> and the reconcile path validates referenced secrets EXIST,
> [reconciler.ts:281](../../core/gitops-backend/src/sync/reconciler.ts#L281)).
> Two options: (a) **treat GitOps as a privileged actor** that bypasses the
> use-gate entirely — defensible because configuring a GitOps provider is itself
> an admin act and the YAML is reviewed in git; OR (b) **attribute the reconcile
> to a designated service-team** and gate references against THAT team's grants,
> so an operator can still scope which secrets a given provider may use.
> **Recommendation: (b) with a per-provider "as-team" setting that defaults to a
> built-in `gitops` team granted broadly**, so day-one behavior is unchanged
> (bypass-equivalent) but operators CAN tighten a provider to specific secrets
> later. The reconcile path calls `assertReferencedAccessAuthorized` with a
> synthetic application/team principal derived from the provider's as-team; on
> denial it records a provenance ERROR (the existing error surface,
> [reconciler.ts:475](../../core/gitops-backend/src/sync/reconciler.ts#L475)) and
> skips that entity rather than throwing the whole sync. This keeps GitOps from
> being a use-gate hole while not breaking existing repos.

---

## 7. Phased breakdown + per-phase test matrix

> Sequence rationale: the extractor + access-check are pure substrate everything
> else needs, so they land first and warn-mode (zero risk) ships before any
> enforcement. The grant surface + UI follow. GitOps + enforcement flip last.

### Phase 1 — Extraction + access-check substrate (pure)

Scope: `collectReferencedAccess` + the two adapters (§4); `isSecretAccessible` /
`isConnectionAccessible` + batch variants (§3.2); the new `use` /
`connection-use` access rules (§3.1). No write path changed yet.

Test matrix (all pure / DOM-free):
- **`collect-references.test.ts`**: `${{ secrets.* }}` in arbitrary fields;
  `secretEnv` maps (canonical + bare-name tolerated); nested action trees
  (choose/parallel/repeat/sequence); literal vs templated `connectionId`
  (templated excluded); dedup; healthcheck strategy+collector configs; empty
  config ⇒ empty sets. Cross-check that every shipped connection-backed action
  (`connectionProviderId` set) exposes a `connectionId` key (OQ-2 drift guard).
- **`access-check.test.ts`** (injected fake `AuthService`): no-grant ⇒
  `hasGlobalAccess` decides; `teamOnly` true + member ⇒ allow; non-member ⇒ deny;
  service principal ⇒ deny (fail-closed); batch helper makes ONE S2S call;
  S2S throw ⇒ fail-closed (mirrors [rpc.ts:609](../../core/backend-api/src/rpc.ts#L609)).

### Phase 2 — The shared gate + warn-mode wiring at all write paths

Scope: `assertReferencedAccessAuthorized` (§5); the `enforcement` meta-config
flag (default `warn`); wire the gate into call sites 1–8 (§5 table). In warn
mode it logs + allows; in enforce mode it throws/returns-error.

Test matrix:
- **`assert-referenced-access.test.ts`** (injected fake auth): authorized ⇒
  resolves; one denied secret ⇒ FORBIDDEN naming it; denied connection ⇒
  FORBIDDEN; never echoes a secret value; warn-mode ⇒ resolves + logs.
- **healthcheck router tests**: create/update/validate call the gate with
  `context.user` and the post-edit (merged) config; update merges partial body
  before extraction.
- **automation router tests**: create/update/validate call the gate with the
  post-edit definition.
- **propose-tool tests** (`automation-propose`, `healthcheck-propose`): the gate
  runs in `dryRun` AND `execute` with the chat `principal` (NOT the service
  token); a chat principal lacking access to a referenced secret gets a blocked
  proposal, never a created config. (Anchors the service-client-bypass fix.)

### Phase 3 — Grant-management surface (RPC + UI)

Scope: `grantSecretUse` / `revokeSecretUse` / `listSecretUseGrants` (gated
`secret.manage`) and `grantConnectionUse` / … (gated `integration.manage`),
delegating to `auth.setResourceTeamAccess` S2S (§3.3); the admin UI to view/edit
which teams may use a given secret/connection.

Test matrix:
- **backend**: grant RPC delegates to the auth store with the qualified resource
  type + correct id; gated by manage (a read-only user is refused);
  list returns current grants.
- **frontend (DOM-free logic-split per [code-style-guide.md](../rules/code-style-guide.md))**:
  grant-form state derivation, team-selection payload shape, optimistic
  invalidation of the secrets/integration plugin queries; cross-plugin
  invalidation of auth/teams queries on grant change
  (`queryClient.invalidateQueries({ queryKey: [[authPluginId]] })`).

### Phase 4 — Backfill + GitOps + enforce

Scope: the one-time backfill RPC/UI (§6.2 step 2); the GitOps as-team handling
(§6.3); flipping `enforcement` to `enforce` documented as an operator action.

Test matrix:
- **backfill**: scans configs, extracts references, creates `canRead` grants for
  the right teams, idempotent (re-run is a no-op), never sets `teamOnly`.
- **gitops**: a reconcile with a referenced secret the provider's as-team lacks
  ⇒ provenance ERROR + entity skipped (not a whole-sync throw); with access ⇒
  reconciles; default as-team preserves existing behavior.
- **enforce-mode integration**: with `teamOnly` set + enforce, an update by a
  non-granted principal throws FORBIDDEN; warn-mode same scenario allows + logs.

### Phase 5 — Docs + changeset + wiring

Scope: docs (§8); `typecheck:references:generate`; a changeset (minor, BETA — no
major; note BREAKING-when-enforced semantics in the changeset text per
[.claude/rules/changesets.md](../rules/changesets.md)).

---

## 8. Docs deliverables

Per [.claude/rules/architecture.md](../rules/architecture.md) (platform-contract
change ⇒ same-PR docs):
- A new page under `docs/src/content/docs/` (recommend
  `user-guide/concepts/secret-access-scoping.md` + a developer-guide reference
  page) covering: the use-grant model, open-by-default + `teamOnly` semantics,
  who may grant, the all-references write-gate rationale (incl. the
  script-exfiltration threat), and the warn→enforce rollout.
- Update the Secrets + Integration concept pages and the Automation/Healthcheck
  config pages to mention the use-gate at save time.
- Document the GitOps as-team handling on the GitOps page.

---

## 9. Open questions, each with a recommended resolution

- **OQ-1 — Team-scoped vs per-principal grants.** *Recommend:* reuse the
  team-scoped `resourceTeamAccess` engine; achieve per-principal via single-member
  teams. Avoids duplicating the entire grant/enforcement stack. **Resolved:
  team-scoped (§3.1).**
- **OQ-2 — Connection-reference detection relies on the `connectionId` config
  KEY.** No `x-connection` schema marker exists today. *Recommend:* key-based +
  `connectionProviderId` cross-check for v1 with a drift-guard test; add an
  explicit `x-connection: true` marker as a fast-follow for schema-driven
  extraction. **Flagged + recommended (§4).**
- **OQ-3 — Should the `use` rule be default?** *Recommend:* YES (`isDefault:
  true`) — this is what makes ungranted secrets behave exactly as today and makes
  the rollout non-breaking; restriction is opt-in per secret via grants +
  `teamOnly`. **Resolved (§3.1b).**
- **OQ-4 — Where do the access-check helpers live?** *Recommend:* the gate
  (`assertReferencedAccessAuthorized`) + the two `is*Accessible` helpers in
  `@checkstack/backend-api` (it owns `AuthService` + qualify helpers, so no new
  dep edge); the extractor in `@checkstack/secrets-common` (shared by backend +
  AI + gitops). **Resolved with a stated home.**
- **OQ-5 — Who may grant use-access?** *Recommend:* add thin secret/connection
  grant RPCs gated by `secret.manage` / `integration.manage` that delegate to the
  auth grant store, rather than forcing `teams.manage`. **Resolved (§3.3).**
- **OQ-6 — Backfill basis.** *Recommend:* grant by EXISTING references (preserves
  today's working set, keeps restriction meaningful), NOT by all manage-holders
  (reproduces the flat model). One-time, idempotent, never sets `teamOnly`.
  **Resolved (§6.2).**
- **OQ-7 — GitOps (no principal).** *Recommend:* per-provider as-team, defaulting
  to a broadly-granted built-in `gitops` team (day-one unchanged), gating
  references against that team; denial ⇒ provenance error + skip, not whole-sync
  throw. **Resolved (§6.3).**
- **OQ-8 — `validate*` denial UX.** *Recommend:* surface as a structured
  validation error (inline in editor/confirm card), while create/update THROW
  FORBIDDEN. **Resolved (§5).**
- **OQ-9 — `canRead` vs `canManage` on the grant.** *Recommend:* v1 maps "use" to
  the engine's `read`/`canRead` bit; reserve `canManage` for a future "who may
  re-grant" split. **Resolved with a stated default.**
- **OQ-10 — Enforcement flag granularity.** Global `off/warn/enforce` vs
  per-secret. *Recommend:* a global mode flag controls whether denials THROW, but
  actual restriction is always per-secret (grants + `teamOnly`); the global flag
  is just the warn→enforce ramp. Revisit a per-secret enforce override if needed.
  **Resolved (§6.2).**
- **OQ-11 — Templated `connectionId` / dynamic refs.** Templated ids (`${{ … }}`)
  resolve only against live scope and cannot be statically attributed at write
  time. *Recommend:* exclude them from the write-gate (matching
  `collectDeclaredSecretRefs`); a dynamic-connection feature would need a separate
  runtime gate, out of scope. **Resolved as out-of-scope; flagged as a residual
  hole to document.**
