---
title: Capability catalog tools
description: Per-plugin read-only AI tools that let the chat assistant discover the available health-check and automation kinds and pull one kind's full config schema on demand.
---

The chat assistant needs to know which strategies, collectors, triggers, actions, and artifact types exist before it can help you configure one. Per-plugin read-only tools surface that information from the platform's own registry-introspection RPCs, the same source the editor UI pickers read. The design is two-level: a broad, compact catalog plus a precise, full schema pulled on demand, so the model keeps a small context while still getting accurate field shapes when it matters.

These tools are owned by and registered from their plugins (health-check kinds from `healthcheck-backend`, automation kinds from `automation-backend`) via the `aiToolExtensionPoint`. See [Registering AI tools](/checkstack/developer-guide/ai/registering-tools/) for how a plugin contributes them.

## The two-level design

Each plugin contributes a pair of tools. The catalog is split per context, so there are two list tools and two schema tools:

- `healthcheck.listCapabilities({})` / `automation.listCapabilities({})` return the broad catalog for their context. Each entry carries its id, display name, a short description, the normalized role, and a COMPACT config summary (field names, types, and which are required). The compact summary is intentionally lossy so the whole catalog fits comfortably in one model turn. Input is an empty object - the context is implicit in which tool you call.
- `healthcheck.getCapabilitySchema({ kind })` / `automation.getCapabilitySchema({ kind })` return the FULL config JSON Schema for ONE kind, intact - the same schema that powers the UI config form, with exact field shapes, types, required fields, and enums. The model pulls this only for the specific kind it is configuring.

All four tools are `effect: "read"`, so they auto-run in chat and over MCP. There is no propose/apply step; nothing is mutated.

## Contexts and roles

Each plugin's pair reads its own registry:

- Health-check (`healthcheck-backend`): health-check strategies (`role: "strategy"`) and their collectors (`role: "collector"`), from `getStrategies` and `getCollectors`.
- Automation (`automation-backend`): automation triggers (`role: "trigger"`), actions (`role: "action"`), and artifact types (`role: "artifact-type"`), from `listTriggers`, `listActions`, and `listArtifactTypes`.

GitOps kinds are out of scope for the first version.

## Size gating

Each `listCapabilities` tool returns a compact `configSummary` per entry only when its catalog has at most twelve entries. Above that, the per-entry summaries are dropped (identity and role always survive) and `truncated: true` is set. The model then narrows to the kind it needs and calls the matching `getCapabilitySchema` for the full detail. This keeps the broad list small without ever hiding which kinds exist.

## Authorization

Each tool is gated directly by its context's read rule at the resolver, so it is only surfaced to a principal who can read that context:

- `healthcheck.listCapabilities` and `healthcheck.getCapabilitySchema` require `healthcheck.healthcheck.configuration.read`.
- `automation.listCapabilities` and `automation.getCapabilitySchema` require `automation.automation.read`.

Because the tools are split per plugin, each one lives entirely inside a single context. There is no cross-context read to guard against and no in-`execute` `assertContextAllowed` step: the per-tool resolver gate decides what is offered. The catalog read in `execute` runs through the per-call user-scoped `rpcClient`, so it re-enters the router as the originating user and the same rule is re-enforced handler-side - the tool can never read a catalog as anyone but the human who asked.

## Output shapes

The output shapes are unchanged from the previous single-tool design. Each output still carries a `context` field, now set to the tool's implicit context.

```ts
// {healthcheck,automation}.listCapabilities output
{
  context: "healthcheck" | "automation";
  entries: Array<{
    id: string;            // "healthcheck-http.http", "incident.created"
    displayName: string;
    description?: string;
    role: "strategy" | "collector" | "trigger" | "action" | "artifact-type";
    category?: string;
    configSummary?: Array<{ name: string; type: string; required: boolean }>;
  }>;
  truncated: boolean;      // true when configSummary was dropped to fit budget
}

// {healthcheck,automation}.getCapabilitySchema output
{
  context: "healthcheck" | "automation";
  id: string;
  displayName: string;
  description?: string;
  role: "strategy" | "collector" | "trigger" | "action" | "artifact-type";
  configSchema: Record<string, unknown>;  // the full JSON Schema, intact
  // Collectors ONLY: the assertable result fields + the operator vocabulary.
  resultSchema?: Record<string, unknown>;          // top-level fields are assertable
  assertionOperators?: Record<string, string[]>;   // valid operators per JSON type
}
```

> [!NOTE]
> The compact summary derivation (`summarizeConfigSchema`) and the size gate (`applyCapabilitySizeGate`) are pure, deterministic functions in `@checkstack/ai-common`, shared by both plugins. They never pull in a JSON Schema library, so they stay trivially testable and identical on every pod.

## Assertion vocabulary for collectors

A health-check collector's assertions (`field`/`operator`) are typed as free-form strings in the config schema, and `validateConfiguration` does not check them, so a model that guesses (`field: "status", operator: "eq"`) would produce a config that saves but renders as empty dropdowns in the editor. To prevent that, `healthcheck.getCapabilitySchema` returns, for collectors only, the collector's `resultSchema` (whose top-level fields are the assertable fields, e.g. `statusCode`) and `assertionOperators` (the valid operators per JSON type, e.g. `equals`, `greaterThanOrEqual`). These come from the SAME canonical operator enums the runtime evaluator and the editor's AssertionBuilder use (`@checkstack/backend-api`).

The `healthcheck.propose` and `healthcheck.update` tools ALSO validate every assertion at propose time against the collector's result schema and that operator vocabulary (`validateCollectorAssertions`), rejecting a bad `field`/`operator` with a precise, self-correcting error that lists the valid options - so the model fixes it before a human ever sees the card.
