---
title: Propose and apply
description: The two-step propose to apply flow that gates every mutating AI tool behind a single-use token and a human, plus the tool-call audit log.
---

Every AI tool declares an `effect`: `read`, `mutate`, or `destructive`. Read tools run directly. Mutating and destructive tools never run directly: they go through a transport-agnostic two-step flow where `propose` runs a dry-run and returns a single-use token, and `apply` consumes the token and commits. This is how the platform keeps a model from silently changing state, and it works identically in the in-app chat and over MCP.

## The two steps

1. `propose(toolName, input)` resolves the tool, re-checks authorization against the tool's `requiredAccessRules`, and runs the tool's `dryRun`. The dry-run validates the input without mutating anything (it reuses the mature validation paths, e.g. the automation plugin's `validateDefinition` or the health-check plugin's `validateConfiguration`). On success it persists a `proposed` audit row and returns a proposal token plus a human-readable summary and the validated payload.
2. `apply(token)` parses the token, fetches the proposal row, verifies the nonce in constant time, checks the TTL and status, re-checks authorization (the principal's rights may have changed since `propose`), then atomically transitions the row to `applied` and runs the tool's `execute`. `apply` executes ONLY the server-stored `proposedPayload` captured at `propose` time; it never accepts caller-supplied arguments. As a belt-and-suspenders guard the stored payload is re-parsed against the tool's input schema immediately before `execute`, so a payload that no longer satisfies an evolved schema is rejected rather than run.

In chat, the summary and payload render a confirm card between the two steps. Over MCP, `propose` returns the token and the client calls `apply` as a follow-up (MCP client elicitation is not universal, so the token is the consent gate).

```ts
// Step 1 — never mutates.
const proposal = await ai.proposeTool({
  toolName: "automation.propose",
  input: { name: "Page on outage", definition: draftDefinition },
});
// proposal = { token, summary, payload, toolCallId, expiresAt }

// Step 2 — a human has reviewed `proposal.summary` / `proposal.payload`.
const applied = await ai.applyTool({ token: proposal.token });
// applied = { toolCallId, result }
```

## When the dry-run rejects: feedback to the model, not an error to the operator

A `dryRun` can fail in two distinct ways, and they are handled differently:

- A **transport/authz/lifecycle fault** (unknown tool, forbidden, malformed token, expired) is a genuine `ProposeApplyError`. It is exceptional and surfaces as an error.
- A **semantic validation failure of the model's drafted input** (a fabricated `runAs`, an unknown `connectionId`, an unwired or wrong-typed artifact reference) is FEEDBACK, not a fault. The tool's `dryRun` throws a `ToolValidationError` carrying structured `issues` (`{ path, message }[]`).

In chat, a `ToolValidationError` is caught and fed back to the MODEL. Because the platform reaches every model through an OpenAI-compatible gateway (no native `is_error` tool-result), a returned value and a failure look identical to the model unless the error channel is used. So the failure is surfaced as a **thrown tool error**: the SDK tool executor detects the validation feedback (and the duplicate-call signal) and throws a `ToolFeedbackError`, which the AI SDK renders as a distinct `tool-error` result part rather than a normal success `tool` message. The error carries a structured `feedback` payload (`{ kind, toolName, issues? }`) alongside the prose guidance, so the model is told the call FAILED and corrects its draft instead of mistaking the feedback for "it worked". The headless agent runner surfaces its tool failures the same way (throwing instead of returning `{ error }`). The operator never sees a raw "the assistant hit an error" message and the proposal is never lost; the eventual valid draft renders its confirm card as normal. The failed attempt is deliberately NOT counted by the per-turn duplicate guard, so the corrected retry is allowed. This holds in both modes: in `auto` mode a draft that fails validation is fed back rather than auto-applied, so a broken automation is never created.

A confirm card is the opposite case: the proposal genuinely SUCCEEDED, so it stays a success result, and it carries a structured `status: "awaiting_operator"` field. The model keys on that state (rather than parsing the prose `note`) to know the proposal landed and it must stop re-proposing and wait for the operator's decision.

Any plugin's proposable tool gets this behavior for free by throwing `ToolValidationError` (exported from `@checkstack/ai-backend`) from its `dryRun` when the model's input is semantically invalid.

## The proposal token

The token format is `propose:<rowId>.<nonce>`. The `proposed` audit row IS the token store: there is no separate ephemeral table.

- The `nonce` is 32 random bytes (hex) stored on the row and compared in constant time at `apply`.
- The TTL is 10 minutes. A token older than that is rejected even if its row was not yet swept.
- `apply` is single-use and atomic: it runs one `UPDATE ... WHERE id = ? AND status = 'proposed' AND proposal_expires_at > now()`. Exactly one caller wins the `proposed -> applied` transition, so a second `apply` (even a concurrent one) is rejected.

A background sweep flips expired `proposed` rows to `expired`, keeping them as audit history. The sweep is hygiene only; correctness never depends on it because `apply` rejects an expired token regardless of the swept status.

> [!IMPORTANT]
> Authorization is re-checked at both `propose` and `apply`. A rule the principal has lost between the two steps blocks `apply`. Service principals can never drive the registry, so a proposal is always bound to a real user or application.

## The flagship flow: automation.propose

`automation.propose` is a hand-authored tool that now lives in and registers from **automation-backend** via `aiToolExtensionPoint` (see [Registering tools](/checkstack/developer-guide/ai/registering-tools/)); `ai-backend` no longer owns it. The model authors a structured draft automation definition; the tool validates it against the live trigger and action registries (the automation plugin's `validateDefinition` dry-run) and returns the validated draft. It never creates an automation at `propose` time. A human reviews the draft (in chat, the confirm card deep-links into the collapsed-card automation editor seeded with the draft) and applies it; only then does `apply` call `createAutomation`.

```ts
// effect: "mutate"; requiredAccessRules: ["automation.automation.manage"]
// dryRun  -> validateDefinition (no mutation); returns the validated draft + YAML
// execute -> createAutomation (reached only via apply)
```

## healthcheck.propose

`healthcheck.propose` mirrors `automation.propose` for health checks (it is what completes the end-to-end "create a script health check" flow, see [Context tools](/checkstack/developer-guide/ai/context-tools/)). Like the automation tools it now lives in and registers from **healthcheck-backend** via `aiToolExtensionPoint` (see [Registering tools](/checkstack/developer-guide/ai/registering-tools/)) rather than from `ai-backend`. The model authors a structured draft configuration; the tool's `dryRun` deep-validates it via the `healthCheckContract.validateConfiguration` RPC. That RPC runs the SAME strategy/collector resolution plus migrate-then-validate-strict logic the create and GitOps-apply paths use, so propose-time errors are identical to apply-time errors: it confirms the `strategyId` and every collector id exist, and validates each config against its registered schema (wrong types, missing required fields, AND unknown/typo'd keys), not just required-field presence. It returns `{ valid, errors: [{ path, message }] }` and persists nothing. On success the tool resolves the strategy/collector display names (`getStrategies` / `getCollectors`) and renders a confirm card describing the strategy, collectors, interval, and any inline script source. It never creates a health check at `propose` time; `apply` calls `healthCheckContract.createConfiguration`.

```ts
// effect: "mutate"; requiredAccessRules: ["healthcheck.healthcheck.manage"]
// dryRun  -> validateConfiguration (deep, no mutation); returns { valid, errors }
// execute -> createConfiguration (reached only via apply)
```

`validateConfiguration` is itself gated by `healthcheck.healthcheck.manage` (the privilege the create form requires) and is the health-check mirror of automation's `validateDefinition`. The shared validator (`collectConfigurationIssues` / `validateVersionedConfigStrict` in `healthcheck-backend`) is the single migrate-then-validate-strict implementation behind both the RPC and the GitOps reconcile path, so the editor, the AI propose tool, and GitOps all agree on what counts as valid.

Creating a health-check configuration is a non-destructive create, so it is `mutate` (not `destructive`): it auto-applies in `auto` mode and is confirm-gated in `approve` mode, exactly like `automation.propose`. A single `requiredAccessRules` of `healthcheck.healthcheck.manage` keeps the framework's all-of (AND) gate correct, and the propose/apply service re-checks `isAllowed` at both `propose` and `apply`.

> [!NOTE]
> A newly created health check does not execute until it is assigned to a system. The `healthcheck.propose` summary and description say so, so the assistant tells the operator to assign it after applying.

## Full CRUD: update and delete tools

Beyond create, the assistant has update and delete tools for both resource types, so it can manage existing objects, not only author new ones. These tools register from their owning plugins too: `automation.update` / `automation.delete` from **automation-backend** and `healthcheck.update` / `healthcheck.delete` from **healthcheck-backend**, both via `aiToolExtensionPoint` (see [Registering tools](/checkstack/developer-guide/ai/registering-tools/)). They follow the same propose/apply gate.

- `healthcheck.update` / `automation.update` (`effect: "mutate"`): take an id plus a partial body. `healthcheck.update` merges the body over the live config and deep-validates the RESULT (the same `validateConfiguration` path as create, including assertion field/operator validation); `automation.update` validates a provided `definition` via `validateDefinition`. Like the propose tools they auto-apply in `auto` mode and confirm in `approve` mode.
- `healthcheck.delete` / `automation.delete` (`effect: "destructive"`): take an id; `dryRun` resolves the target so the confirm card names exactly what is removed. Being destructive, they ALWAYS route through the confirm card in BOTH modes - they can never auto-apply (the `decideToolDisposition` invariant, regression-guarded by each owning plugin's own tests). All four are gated by the same `*.manage` rule as create and re-checked at `propose` and `apply`.

```ts
// healthcheck.update / automation.update  -> effect: "mutate"   (auto-applies in auto mode)
// healthcheck.delete / automation.delete  -> effect: "destructive" (ALWAYS confirm-gated)
```

## Always-visible changes: diffs and the applied card

A change is always shown to the operator, in BOTH modes. An update tool's `dryRun` computes a before -> after field diff (`computeFieldDiff`) and returns it on the proposal preview; it threads through `ProposeResult` to the chat card. In approve mode the confirm card renders that diff (instead of the full payload) so the operator sees exactly what changes before approving. In auto mode the change auto-applies, but the result is NOT silent: the tool returns an `AutoAppliedResult` (`__applied: true`) carrying the same summary + diff, and the chat renders a read-only "Applied" card so the operator still sees what was created or changed. A create has no diff (the whole payload is new), so its card shows the created object.

```ts
// dryRun -> AiProposalPreview { summary, payload, diff? }
// approve mode: ConfirmCardResult { __confirm, ..., diff? }  -> confirm card + diff
// auto mode:    AutoAppliedResult { __applied, summary, result, diff? } -> read-only applied card
```

## Authorization: every tool call runs as the originating user

The model is an untrusted caller. A tool must never let it reach data or mutations the human behind the conversation could not reach directly, even when the request happens to go through a tool or an MCP function. Two layers enforce this:

1. **The resolver gate decides what is OFFERED.** A tool is surfaced to the model only when the principal satisfies its `requiredAccessRules` (`resolveTools` / `isAllowed`). The model is never handed a tool the principal lacks.
2. **A user-scoped RPC client decides what actually RUNS.** Both `dryRun` and `execute` receive an `rpcClient` bound to the ORIGINATING user (built from the request's own session cookie / bearer). Any plugin procedure it calls re-enters the live router AS THAT USER, so the handler runs `autoAuthMiddleware` - access rules AND per-resource/team `instanceAccess` scope - exactly as a direct UI/RPC call. A tool MUST use this client for plugin calls and MUST NEVER capture a trusted service client: the trusted client short-circuits every principal check, so calling it would let the model read or mutate team-scoped resources the user cannot reach - a privilege escalation.

Because the second layer re-enters as the user, a tool can never broaden access beyond the user's own permissions, even for resources gated to a specific team. When a call is refused, the propose/apply service names the missing rule in the error (`Forbidden: <tool> (missing permission: <rules>)`), so the assistant can tell the operator exactly which permission a read, mutation, or delete needs.

Tools register from many plugins (see [Registering tools](/checkstack/developer-guide/ai/registering-tools/)) rather than from a single central spot in `ai-backend`, and every registered tool, wherever it is owned, falls into one category:

- **Mutating tools** (`effect !== "read"`, e.g. `automation.propose`, `healthcheck.propose`/`.update`/`.delete`, `incident.create`/`.update`/`.delete`/`.addUpdate`/`.resolve`/`.addLink`/`.removeLink`, `maintenance.create`/`.update`/`.delete`/`.addUpdate`/`.close`/`.addLink`/`.removeLink`, `catalog.createSystem`/`.updateSystem`/`.deleteSystem`/`.createGroup`/`.updateGroup`/`.deleteGroup`/`.addSystemToGroup`/`.removeSystemFromGroup`) route through the propose/apply service, which re-checks `isAllowed` at both `propose` and `apply`, then runs `dryRun`/`execute` with the user-scoped client (so the underlying create/update/delete RPC enforces handler authz as the user). Each is owned by its plugin and registered via `aiToolExtensionPoint`. A `create`/`update`/`addUpdate`/`resolve`/`close`/`addLink` is `mutate`; a `delete`/`removeLink` is `destructive` (always confirm-gated). Update tools dry-run against the live record and surface a before -> after diff on the card.
- **Composite read tools** (`getScriptContext`, `testScript`, `listCapabilities`, `getCapabilitySchema`, plus `ai-backend`'s own `ai.searchDocs` / `ai.getDoc` / `ai.probeUrl`) run their own `execute` with the user-scoped client; the resolver gate plus that user-scoped fan-out are the authorization authority.
- **Projected read tools** (`incident.list` / `incident.get`, `healthcheck.status`, `anomaly.list`, `maintenance.list` / `maintenance.get`, `catalog.listSystems` / `catalog.listGroups`, `slo.listObjectives`, `dependency.list`) are exposed by their owning plugins via `aiToolProjectionExtensionPoint`; `ai-backend` collects their routing in an `afterPluginsReady` phase. Each carries its source procedure's own access rules and is routed through the live router as the logged-in principal, so handler-side authz holds. (`catalog.listSystems` in particular lets the assistant resolve a system name to its id before creating an incident, maintenance, or health check.)

This invariant is regression-guarded per owner. `ai-backend`'s own tools are covered by `core/ai-backend/src/tools/tool-set.e2e.test.ts` and `core/ai-backend/src/hardening/handler-authz.test.ts`, while each plugin tests the tools and projections it registers, so a tool offered to a principal who lacks its rules fails the suite rather than silently bypassing authz.

## Audit log

Every tool invocation across both transports writes an `ai_tool_calls` row, which doubles as the proposal-token store:

- `read` tools write a row with status `executed`.
- `propose` writes a `proposed` row; `apply` transitions it to `applied`; a failed `execute` is recorded as `failed`; an unconsumed proposal ages to `expired`.
- The row stores a SHA-256 `argsHash` of the canonical-JSON arguments, never the raw arguments (they may carry PII or secrets). The `proposedPayload` column holds the validated, ready-to-apply payload captured at `propose` time.
- The proposer is recorded in `principalKind`/`principalId`. The principal that actually consumes the token at `apply` is recorded separately in `appliedByKind`/`appliedById`. These are normally identical, but a cross-principal apply is RECORDED rather than rejected: the single-use 256-bit token plus the live authorization re-check already hold the security invariant, so the audit log simply attributes the apply to the real applier instead of silently crediting the proposer.

The platform emits an `ai.toolCalled` hook on the shared event bus for each call, carrying only metadata (`principalKind`, `principalId`, `transport`, `toolName`, `effect`, `status`) and never arguments or results. Subscribers react to the fact of a call, not its contents.

## Per-principal tool rate-limit budgets

Every tool invocation across both transports is also rate-limited per principal. The budget is a shared-Postgres rolling-window counter over `ai_tool_calls`: before a tool runs, the platform counts the rows the principal has written in the trailing window (using the `ai_tool_calls_principal_created_idx` index) and refuses the call once the count meets the cap.

```ts
// Enforced before execution on BOTH transports (MCP tools/call + the chat loop).
await enforceToolBudget({ db, principal, max: 60, windowMs: 60_000 });
// throws ToolBudgetExceededError when over budget
```

Because the count is read from the same shared table every pod writes to, the cap holds across all pods. An in-memory per-pod limiter would let N pods each allow the cap (N times the intended limit), which a single-process test would never catch, so the limiter is Postgres-backed by design. This mirrors the Phase 2 DCR rate-limiter pattern. Over MCP an over-budget call returns a JSON-RPC rate-limited error (HTTP 429); in chat it surfaces as a friendly error in the stream.

## State and scale

The audit log, the proposal tokens, and the rate-limit budget counter all live in shared Postgres. A token proposed on one pod is consumable on any other; an expired token is rejected on every pod; the budget count is identical on every pod. No proposal, audit, or budget state is pod-local.

## Related

Proposable tools come from the [tool registry](/checkstack/developer-guide/ai/tool-registry/); the [internal chat](/checkstack/developer-guide/ai/chat/) renders the proposal as a confirm card and the [MCP server](/checkstack/developer-guide/ai/mcp-server/) returns it for a follow-up `apply`. The token lifecycle (single-use, expiry, constant-time nonce) is regression-guarded in `core/ai-backend/src/propose-apply/`, and the per-principal budget is verified cross-pod in `core/ai-backend/src/rate-limit/tool-budget.it.test.ts`. See the [AI platform overview](/checkstack/developer-guide/ai/) for the full security model.

In chat, the [permission mode](/checkstack/developer-guide/ai/permission-mode/) decides whether a `mutate` tool's proposal is auto-applied server-side (`auto`) or surfaced as a confirm card (`approve`). It reuses this exact apply path, so a destructive tool always requires a human apply regardless of the mode.
