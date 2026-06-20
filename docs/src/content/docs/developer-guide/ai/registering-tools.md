---
title: Registering AI tools from a plugin
description: How any plugin (first- or third-party) contributes AI assistant tools without ai-backend depending on it, via the tool and projection extension points.
---

AI tools are owned by the plugins whose domain they act on, not by `ai-backend`. A plugin contributes tools by registering them through `ai-backend`'s extension points from its own `init` (or `register`). The dependency direction is always plugin -> `@checkstack/ai-backend`; `ai-backend` never depends on a capability plugin's `*-common`. This is the contract an external plugin author follows, and it is exactly how the first-party health-check and automation tools are wired.

## The two extension points

- `aiToolExtensionPoint` - register a hand-authored tool (a `RegisteredAiTool` with its own `execute` / `dryRun`): propose/apply mutations, capability catalogs, script-context tools, URL probes, anything self-contained.
- `aiToolProjectionExtensionPoint` - expose an existing oRPC read procedure as a read tool. The projected tool inherits the procedure's input schema and access rules verbatim; its execution is routed by the transport (MCP / chat) back through the live router as the principal, so handler-side authz holds.

Both come from `@checkstack/ai-backend`. Because `ai-backend` registers the extension points in its `register()`, and your plugin depends on `@checkstack/ai-backend`, your plugin loads after it - so `env.getExtensionPoint(...)` resolves.

## Register a hand-authored tool

```ts
import { aiToolExtensionPoint, type RegisteredAiTool } from "@checkstack/ai-backend";
import { pluginMetadata, MyApi, myAccess } from "@checkstack/my-common";
import { qualifyAccessRuleId } from "@checkstack/common";

function buildMyAiTools(): RegisteredAiTool[] {
  return [
    {
      name: "my.doThing", // already qualified -> kept as-is
      description: "Do the thing. Requires confirmation before it takes effect.",
      effect: "mutate", // "read" | "mutate" | "destructive"
      input: MyDoThingInputSchema,
      requiredAccessRules: [qualifyAccessRuleId(pluginMetadata, myAccess.manage)],
      // `rpcClient` is the USER-SCOPED client: it re-enters the router as the
      // originating user, so the procedure's own handler authz (access rules +
      // per-resource/team scope) applies. Resolve the plugin client INSIDE the
      // handler from this arg. NEVER capture a trusted service client at factory
      // scope - that bypasses the user's authorization (privilege escalation).
      dryRun: async ({ input, principal, rpcClient }) => ({ summary: "...", payload: input }),
      execute: async ({ input, principal, rpcClient }) =>
        rpcClient.forPlugin(MyApi).doThing(input),
    },
  ];
}

// in registerInit({ init }):
const aiToolExt = env.getExtensionPoint(aiToolExtensionPoint);
for (const tool of buildMyAiTools()) {
  aiToolExt.registerTool(tool, pluginMetadata);
}
```

An unqualified `name` is auto-qualified to `<pluginId>.<name>` on registration; an already-qualified name (e.g. `my.doThing`) is kept. `mutate`/`destructive` tools route through [propose and apply](/checkstack/developer-guide/ai/propose-apply/) - they never run inline.

> [!IMPORTANT]
> Always call plugin procedures through the `rpcClient` handed to `dryRun` /
> `execute`. It is bound to the user who triggered the tool, so original
> access controls (including team-scoped resources) still apply, scoped to that
> user. A tool must not broaden what the user can access just because the
> request arrived via a tool or MCP function.

## Expose a read procedure as a projection

```ts
import { aiToolProjectionExtensionPoint, deferredProjectionExecute } from "@checkstack/ai-backend";
import { pluginMetadata, myContract } from "@checkstack/my-common";

// in init (or register):
env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
  procedure: myContract.listThings,
  sourcePluginMetadata: pluginMetadata,
  procedureKey: "listThings",
  name: "my.list",
  description: "List things. Read-only.",
  effect: "read",
  execute: deferredProjectionExecute, // routed by the transport, never run directly
});
```

`ai-backend` collects each exposed projection's routing (`{ pluginId, procedureKey }`) in its `afterPluginsReady` phase - once every plugin has exposed - and wires it into the MCP transport and the chat read-loop. You never tell `ai-backend` your plugin exists; it discovers your projection through the extension point.

### Lean the result for the model with `projectResult`

A read procedure built for the UI often returns more than the model needs (opaque ids it only echoes, denormalized fields). Since the chat loop replays history verbatim every turn, verbose rows burn context repeatedly. An optional `projectResult` maps the procedure's FULL output into a leaner model-facing shape - applied only on the chat/MCP read path, after the transport re-enters the live router as the principal, so authorization and the audit log see the full result unchanged:

```ts
env.getExtensionPoint(aiToolProjectionExtensionPoint).expose({
  procedure: myContract.listThings,
  sourcePluginMetadata: pluginMetadata,
  procedureKey: "listThings",
  name: "my.list",
  description: "List things. Read-only.",
  effect: "read",
  execute: deferredProjectionExecute,
  // Drop fields the model doesn't need before they enter its context window.
  projectResult: (out) => ({ things: out.things.map((t) => ({ name: t.name, status: t.status })) }),
});
```

Keep `projectResult` defensive (return the input unchanged on an unexpected shape): the generic [result clamp](/checkstack/developer-guide/ai/chat/) is the backstop, so a mismatch never crashes the read. For broad "how often / how much over a period" questions, prefer exposing an AGGREGATE procedure (counts/percentiles) over a row-returning one - far cheaper than leaning thousands of rows. `healthcheck.runStats` is the reference example; `healthcheck.runHistory` keeps a `projectResult` for the small-window case.

### Project a system-scoped read so the model can attribute data

A global "list everything" read is convenient, but if its rows carry no system
attribution the model cannot answer "which of these belongs to system X" - it
can only guess. Project the per-system read too, keyed by `systemId`, so the
model can resolve the question instead of inferring it. The assistant resolves a
system NAME to its id with `catalog.listSystems`, then calls your system-scoped
tool with that id; a `parentScope` instance-access rule
(`{ resourceType: "catalog.system", action: "read", idParam: "systemId" }`) on
the source procedure keeps it team-scoped for free.

`healthcheck.listSystemChecks` (projecting `getSystemConfigurations`) is the
reference example: `healthcheck.status` lists every check globally with no
system mapping, so the per-system projection is what lets the assistant say
"check Y is the one assigned to system X" rather than guessing. When you expose a
global list, ask whether the model will also need it sliced per system - and if
so, project both, with the description pointing at `catalog.listSystems` for id
resolution.

## Why ai-backend stays plugin-agnostic

`ai-backend` is the AI platform: the tool registry + resolver, the projection mechanism, the chat agent loop, the MCP server, propose/apply, and a few genuinely cross-plugin tools (docs grounding, URL probe). It imports no capability plugin's `*-common`. Pure, shareable helpers a tool author needs - `computeFieldDiff`, the capability-summary helpers, `ScriptContextKind` - live in `@checkstack/ai-common`; `resolveScriptContext` and `buildProjectedTool` are exported from `@checkstack/ai-backend`. So a third-party plugin can author rich AI tools (including assertion diffs and script-context grounding) using only the platform packages, and adding or removing a plugin never touches `ai-backend`.
