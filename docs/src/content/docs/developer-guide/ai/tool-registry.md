---
title: Tool registry
description: The AiTool contract, the registerTool and expose extension points, effect classification, and the principal-to-allowed-tools resolver.
---

The tool registry is the spine of the AI platform. Plugins contribute tools through two extension points, the resolver decides which tools a principal may see, and one serializer turns a tool into the JSON Schema both transports consume. This page is the Phase 1 reference for those contracts.

## The AiTool contract

A tool is a transport-agnostic, callable descriptor. The same shape backs both the chat agent loop and the MCP server.

```ts
import { z } from "zod";

export interface AiTool<TInput = unknown, TOutput = unknown, TPrincipal = unknown> {
  /** Auto-qualified by plugin id on registration, e.g. "automation.propose". */
  name: string;
  /** Model-facing description (becomes the OpenAI / MCP tool description). */
  description: string;
  /** zod input; serialized to JSON Schema via toJsonSchema() for both transports. */
  input: z.ZodType<TInput>;
  /** Optional zod output; documents the tool result shape to the model. */
  output?: z.ZodType<TOutput>;
  /** Effect classification. REQUIRED. Never inferred from the verb. */
  effect: "read" | "mutate" | "destructive";
  /** Fully-qualified access-rule IDs: same vocabulary autoAuthMiddleware enforces. */
  requiredAccessRules: string[];
  /** Optional dry-run for mutate / destructive tools (Phase 3). */
  dryRun?(args: { input: TInput; principal: TPrincipal }): Promise<unknown>;
  /** The actual call. For mutate / destructive this is only reached via apply. */
  execute(args: { input: TInput; principal: TPrincipal }): Promise<TOutput>;
}
```

## Effect classification

Every tool declares an `effect`. It is required and is never inferred from the procedure verb, because a `mutation` operation type is not the same as a destructive effect.

- `read` tools auto-run.
- `mutate` and `destructive` tools are gated behind the two-step [propose then apply](/checkstack/developer-guide/ai/propose-apply/) flow. `destructive` carries stronger confirmation UX.

Tools are owned by the plugins whose domain they act on: each plugin registers its own through these extension points from its own init, and `ai-backend` never depends on a capability plugin. For a worked, end-to-end example see [Registering AI tools from a plugin](/checkstack/developer-guide/ai/registering-tools/).

## Path 1: hand-authored composite tools

Register a purpose-built tool through `aiToolExtensionPoint.registerTool` when the model needs a coarser or curated surface than raw CRUD. The name is qualified with the registering plugin id.

```ts
import { aiToolExtensionPoint } from "@checkstack/ai-backend";
import { z } from "zod";

env.getExtensionPoint(aiToolExtensionPoint).registerTool(
  {
    name: "incident.summarize",
    description: "Summarize open incidents for a system.",
    effect: "read",
    input: z.object({ systemId: z.string() }),
    requiredAccessRules: ["incident.incident.read"],
    execute: async ({ input, principal }) => {
      // ... call into your plugin's services as the resolved principal
      return { summary: "..." };
    },
  },
  pluginMetadata,
);
```

## Path 2: opt-in projection of an oRPC procedure

Project an existing procedure with `aiToolProjectionExtensionPoint.expose`. The procedure's access rules and input schema are read verbatim, so nothing is duplicated. Pass the metadata of the plugin that owns the procedure, so its access rules qualify to the same `<plugin>.<resource>.<level>` ids `autoAuthMiddleware` enforces.

```ts
import { aiToolProjectionExtensionPoint } from "@checkstack/ai-backend";
import { incidentContract, pluginMetadata as incidentMeta } from "@checkstack/incident-common";

env.getExtensionPoint(aiToolProjectionExtensionPoint).expose(
  {
    procedure: incidentContract.listIncidents,
    sourcePluginMetadata: incidentMeta,
    procedureKey: "listIncidents",
    name: "incident.list",
    description: "List incidents with optional status/system filters. Read-only.",
    effect: "read",
    execute: async ({ input, principal }) => {
      // Invoking the live procedure as the resolved principal is wired by the
      // transport that runs the tool (MCP in Phase 2, chat in Phase 4).
      throw new Error("not yet invocable");
    },
  },
  pluginMetadata,
);
```

`expose` throws at registration if `effect` is omitted, or if the value passed as `procedure` is not an oRPC contract procedure.

## The resolver

The resolver maps a principal to the subset of registered tools it may see or call. A tool is allowed if and only if every entry in `requiredAccessRules` is satisfied by the principal's `accessRules`, with the `"*"` admin escape.

```ts
import { createAiToolResolver } from "@checkstack/ai-backend";

const resolver = createAiToolResolver({ registry });
const tools = resolver.resolveTools(principal); // tools the principal may see
const ok = resolver.isAllowed({ principal, tool }); // re-checked at execute / apply
```

This is the exact predicate `autoAuthMiddleware` applies to global rules, so the resolver can never surface a tool the handler would then reject, and a scope-narrowed principal (a strictly smaller `accessRules` set) can only ever see fewer tools. Team-scoped (instance) rules are not pre-filtered here; per-call team checks run handler-side. The handler is the single enforcement point: the resolver hiding a tool is defense in depth, not the authorization boundary.

## The serializer

`serializeTool` turns a registered tool into its transport-facing descriptor. It wraps the platform `toJsonSchema()`, so a tool's input schema is the same JSON Schema substrate the OpenAPI generator emits for the source procedure. There is no second serializer to drift. The descriptor carries only JSON Schema and metadata, never an executor closure or any secret value.

```ts
import { serializeTool } from "@checkstack/ai-backend";

const descriptor = serializeTool({ tool });
// { name, description, effect, inputSchema, outputSchema?, requiredAccessRules }
```

## Introspection

The `listTools` RPC (gated by `ai.tools.manage`) returns the serialized resolver output for the calling principal.

```ts
const { tools } = await aiClient.listTools();
```

## Related

The resolver output drives both transports: the [MCP server](/checkstack/developer-guide/ai/mcp-server/) lists and runs read tools, and the [internal chat](/checkstack/developer-guide/ai/chat/) offers the same set to the model. The principal a tool is filtered against is produced by [OAuth scope narrowing](/checkstack/developer-guide/ai/oauth-and-scopes/), and mutating tools are gated by [propose and apply](/checkstack/developer-guide/ai/propose-apply/). The resolver predicate (which mirrors the authorization middleware and can never widen a principal) is regression-guarded in `core/ai-backend/src/resolver.test.ts` and `core/ai-backend/src/hardening/handler-authz.test.ts`. See the [AI platform overview](/checkstack/developer-guide/ai/) for the full security model.
