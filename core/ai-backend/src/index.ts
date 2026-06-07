import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import {
  aiAccessRules,
  aiContract,
  pluginMetadata,
  OPENAI_COMPATIBLE_PROVIDER_LOCAL_ID,
} from "@checkstack/ai-common";
import {
  integrationProviderExtensionPoint,
  connectionStoreRef,
} from "@checkstack/integration-backend";
import type { IntegrationProvider } from "@checkstack/integration-backend";
import type { OpenAiCompatibleConnection } from "@checkstack/ai-common";
import {
  aiToolExtensionPoint,
  aiToolProjectionExtensionPoint,
  systemSignalsExtensionPoint,
} from "./extension-points";
import { createAiToolRegistry } from "./tool-registry";
import { createAiToolResolver } from "./resolver";
import {
  createRegistryExtensionPoints,
  createSystemSignalsExtensionPoint,
} from "./registry-wiring";
import { buildCompositeTools } from "./tools/composite-tools";
import { createSystemIssuesTool } from "./tools/system-issues";
import { createOpenAiCompatibleProvider } from "./openai-provider";
import { createAiRouter } from "./router";
import { createMcpRequestHandler } from "./mcp/server";
import type { McpExecutableTool } from "./mcp/server";
import { createMcpToolInvoker } from "./mcp/tool-invoker";
import { createMcpConnectionRegistry } from "./mcp/connection-registry";
import { createAiToolCallStore } from "./propose-apply/store";
import { hashToolArgs } from "./propose-apply/args-hash";
import { createProposeApplyService } from "./propose-apply/service";
import { createAgentRunner, aiAgentRunnerRef } from "./agent-runner";
import { createAiConversationStore } from "./chat/conversation-store";
import { createChatService } from "./chat/chat-service";
import type {
  ChatConnectionResolver,
  ChatService,
} from "./chat/chat-service";
import { createChatRequestHandler } from "./chat/chat-handler";
import { createChatReadInvoker } from "./chat/read-invoker";
import { enforceToolBudget } from "./rate-limit/tool-budget";
import { OpenAiCompatibleConnectionSchema } from "./openai-provider";
import * as schema from "./schema";

/** How often the background sweep flips expired `proposed` rows to `expired`. */
const PROPOSAL_SWEEP_INTERVAL_MS = 60_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI Platform Plugin — Phase 1 (spine + integration)
//
// Delivers the transport-agnostic tool registry (the spine), the two
// extension points, the principal -> allowed-tools resolver, the shared
// zod -> JSON-Schema serializer, the OpenAI-compatible integration provider,
// and a handful of read-only projected tools. Transports (MCP, chat) and
// mutating propose/apply land in later phases.
//
// State & scale: the only state Phase 1 introduces is the in-memory tool
// REGISTRY, which is rebuilt identically from buffered extension-point
// registrations on every pod at boot (it is derived, deterministic, and not a
// queryable source of truth) — every pod resolves the same tool set for the
// same principal. No durable AI state ships in this phase.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const registry = createAiToolRegistry();
    const resolver = createAiToolResolver({ registry });

    env.registerAccessRules(aiAccessRules);

    const { toolExtensionPoint, projectionExtensionPoint, exposedProjections } =
      createRegistryExtensionPoints({ registry });

    // System-signals contributors: each plugin that owns a kind of problem state
    // registers ONE contributor from its OWN init; the `system.issues` composite
    // tool fans out across this SAME array at execute time. ai-backend imports no
    // plugin's `*-common` to collect them.
    const { systemSignalsExtensionPoint: systemSignalsExt, contributors } =
      createSystemSignalsExtensionPoint();

    // Path 1 — hand-authored composite tools.
    env.registerExtensionPoint(aiToolExtensionPoint, toolExtensionPoint);
    // Path 2 — opt-in projection of an existing oRPC procedure. Plugins call
    // `expose(...)` from their OWN init; ai-backend collects the routing in
    // afterPluginsReady (below) without importing any plugin's `*-common`.
    env.registerExtensionPoint(
      aiToolProjectionExtensionPoint,
      projectionExtensionPoint,
    );
    env.registerExtensionPoint(systemSignalsExtensionPoint, systemSignalsExt);

    // Live MCP connection registry — the ONE allowed pod-local thing
    // (declareNonReactiveState({ reason: "bookkeeping" }), decision 9). Created
    // in register() and reused by the HTTP handler; never a source of truth.
    const mcpConnections = createMcpConnectionRegistry();

    // Shared, register-scope refs so BOTH init (which builds the MCP + chat
    // handlers) and afterPluginsReady (which fills routing once every plugin has
    // exposed its projections) reach the same instances. mcpExecutableTools is
    // the SAME array the MCP handler holds (it reads it lazily on first request).
    const mcpExecutableTools: McpExecutableTool[] = [];
    let chatService: ChatService | undefined;

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        auth: coreServices.auth,
        eventBus: coreServices.eventBus,
      },
      init: async ({ logger, database, rpc, auth, eventBus }) => {
        logger.debug("🔌 Initializing AI Backend...");

        const db = database as SafeDatabase<typeof schema>;

        // Loopback base URL for the user-scoped RPC clients (chat + router
        // propose/apply) and the MCP/read invokers: they re-enter `/api` as the
        // ORIGINATING user so handler authz + per-resource/team scope apply.
        const internalUrl = process.env.INTERNAL_URL || "http://localhost:3000";

        // Phase 3: the audit log + propose/apply token store (the proposed row
        // IS the token). Shared Postgres — scale-correct across pods.
        const store = createAiToolCallStore({ db });
        const proposeApply = createProposeApplyService({
          registry,
          resolver,
          store,
          eventBus,
        });

        // Phase 4: durable conversation + message persistence (shared Postgres,
        // continuable from any pod — state-and-scale §9).
        const conversations = createAiConversationStore({ db });

        // Lists selectable AI integrations for the chat picker (§14.6). Reads
        // the REDACTED connection config (configPreview) — the apiKey is never
        // present here, only the non-secret model UX metadata.
        const openAiProviderId = `${pluginMetadata.pluginId}.${OPENAI_COMPATIBLE_PROVIDER_LOCAL_ID}`;
        const chatIntegrationLister = {
          async list() {
            const connectionStore = await env.getService(connectionStoreRef);
            const connections =
              await connectionStore.listConnections(openAiProviderId);
            return connections.flatMap((conn) => {
              const preview = conn.configPreview;
              const defaultModel = preview.defaultModel;
              if (typeof defaultModel !== "string") return [];
              const availableModels = Array.isArray(preview.availableModels)
                ? preview.availableModels.filter(
                    (m): m is string => typeof m === "string",
                  )
                : undefined;
              return [
                {
                  connectionId: conn.id,
                  name: conn.name,
                  defaultModel,
                  availableModels,
                },
              ];
            });
          },
        };

        // Register ALL hand-authored composite tools through the SAME extension
        // point external plugins use, from the SINGLE shared `buildCompositeTools`
        // factory. The factory is the one source of truth for the composite set
        // (the two propose tools + docs grounding + script context/test +
        // capability catalog), and the systemic-authz / e2e tests build their
        // registry from the SAME factory, so a new fan-out read tool added here
        // is automatically covered by the authz guard. The underlying RPC calls
        // go through the trusted service client; the resolver gate + the
        // propose/apply re-check (mutate tools) and the in-`execute` per-context
        // re-check (composite read tools) are the authorization authority.
        const toolExt = env.getExtensionPoint(aiToolExtensionPoint);
        for (const tool of buildCompositeTools()) {
          toolExt.registerTool(tool, pluginMetadata);
        }

        // The `system.issues` aggregator: ONE "what are the current issues"
        // read tool that fans out across every registered SystemSignalsContributor
        // and merges their global maps. Registered through the same extension
        // point external plugins use; gated by catalog.system.read (per-source
        // access is enforced inside each contributor). The `contributors` array
        // is the live register-scope array, read at execute time, so plugins that
        // contribute during their own init are seen.
        toolExt.registerTool(
          createSystemIssuesTool({ contributors }),
          pluginMetadata,
        );


        // Register the OpenAI-compatible integration provider so it appears in
        // the generic Connections settings UI (DynamicForm-driven). Done at
        // init so `integrationProviderExtensionPoint` is resolvable.
        const integrationExt = env.getExtensionPoint(
          integrationProviderExtensionPoint,
        );
        integrationExt.addProvider(
          createOpenAiCompatibleProvider() as IntegrationProvider<unknown>,
          pluginMetadata,
        );

        // Read-only PROJECTIONS are exposed by their OWNING plugins (incident /
        // healthcheck / anomaly) via aiToolProjectionExtensionPoint from their
        // own init. ai-backend collects their routing in afterPluginsReady once
        // every plugin has registered (see below) - it imports no plugin commons.
        // `mcpExecutableTools` (register-scope) is filled there; the MCP handler
        // created below holds this same array and reads it lazily on first call.

        // Expose the AI introspection + propose/apply + conversation contract.
        rpc.registerRouter(
          createAiRouter({
            resolver,
            proposeApply,
            conversations,
            integrations: chatIntegrationLister,
            internalUrl,
          }),
          aiContract,
        );

        // Per-principal tool RATE-LIMIT BUDGET (§14.5): a shared-Postgres
        // rolling-window counter over ai_tool_calls. Enforced on tool execution
        // by BOTH transports (MCP tools/call below + the chat agent loop), so
        // the cap holds across all pods.
        const enforceBudget = async (principal: {
          kind: "user" | "application";
          id: string;
        }): Promise<void> => {
          await enforceToolBudget({ db, principal });
        };

        // Mount the read-only Streamable-HTTP MCP endpoint at /api/ai/mcp.
        // Authn: the bearer OAuth token resolves to a narrowed principal via
        // the platform auth strategy; tools/call re-enters the live router so
        // handler authz holds. The endpoint is always mounted; whether a token
        // can be MINTED is gated by the auth-backend MCP/OAuth enable toggle.
        const mcpHandler = createMcpRequestHandler({
          tools: mcpExecutableTools,
          resolver,
          invoker: createMcpToolInvoker({ internalUrl }),
          auth,
          connections: mcpConnections,
          enforceBudget,
          recordExecuted: async ({ principal, toolName, argsHash }) => {
            await store.recordExecuted({
              principal,
              transport: "mcp",
              toolName,
              argsHash,
            });
          },
        });
        rpc.registerHttpHandler(mcpHandler, "/mcp");

        // Phase 4: the streaming chat agent loop at /api/ai/chat. Credentials
        // are resolved BACKEND-side from the integration connection store and
        // never leave the backend. Read tools re-enter the live router as the
        // logged-in user (handler authz holds); mutating/destructive tools go
        // through propose/apply and surface a confirm card.
        const chatConnectionResolver: ChatConnectionResolver = {
          async resolve({ connectionId }) {
            const connectionStore = await env.getService(connectionStoreRef);
            const conn =
              await connectionStore.getConnectionWithCredentials(connectionId);
            if (!conn) return;
            const parsed = OpenAiCompatibleConnectionSchema.safeParse(
              conn.config,
            );
            if (!parsed.success) return;
            return parsed.data satisfies OpenAiCompatibleConnection;
          },
        };

        // Headless agent runner (the engine behind the automation "AI Action").
        // Exposed as a service so automation-backend can drive a bounded agent
        // task as the run's `runAs` principal without ai-backend depending on
        // automation-backend. Reuses the same resolver + connection resolution
        // as chat; runs no human-gated propose/apply (the action auto-applies
        // non-destructive tools through the principal's own client).
        env.registerService(
          aiAgentRunnerRef,
          createAgentRunner({
            resolver,
            resolveConnection: (connectionId) =>
              chatConnectionResolver.resolve({ connectionId }),
            // Projected read tools route through the live router as the
            // principal. `exposedProjections` is populated in afterPluginsReady,
            // before any agent task can run, so this lookup is live at call time.
            getProjectionRoute: (toolName) => {
              const route = exposedProjections.find(
                (r) => r.toolName === toolName,
              );
              return route
                ? { pluginId: route.pluginId, procedureKey: route.procedureKey }
                : undefined;
            },
            // Audit every AI-action tool call into the durable AI tool-call log
            // under the `automation` transport (best-effort).
            recordToolCall: async ({
              principal,
              toolName,
              effect,
              input,
              ok,
              error,
            }) => {
              if (principal.type !== "user" && principal.type !== "application") {
                return;
              }
              const auditPrincipal = {
                kind: principal.type,
                id: principal.id,
              } as const;
              const argsHash = hashToolArgs(input);
              try {
                await (ok
                  ? store.recordExecuted({
                      principal: auditPrincipal,
                      transport: "automation",
                      toolName,
                      argsHash,
                    })
                  : store.recordFailed({
                      principal: auditPrincipal,
                      transport: "automation",
                      toolName,
                      effect,
                      argsHash,
                      error: error ?? "unknown error",
                    }));
              } catch {
                // Best-effort audit; never break the agent loop.
              }
            },
          }),
        );
        chatService = createChatService({
          resolver,
          proposeApply,
          conversations,
          connections: chatConnectionResolver,
          readInvoker: createChatReadInvoker({ internalUrl }),
          recordExecuted: async ({
            principal,
            conversationId,
            toolName,
            argsHash,
          }) => {
            await store.recordExecuted({
              principal,
              transport: "chat",
              conversationId,
              toolName,
              argsHash,
            });
          },
          db,
          logger,
          internalUrl,
        });
        // Read-tool routing for the chat loop is seeded in afterPluginsReady
        // (below), once every plugin has exposed its read projections.
        rpc.registerHttpHandler(
          createChatRequestHandler({ chatService, auth }),
          "/chat",
        );

        // Background sweep: flip expired `proposed` rows to `expired`, keeping
        // them as audit history (§13.4). This is purely audit hygiene — the
        // apply path rejects an expired token even if the row is still
        // `proposed`, so correctness never depends on the sweep. Runs on every
        // pod against shared Postgres; the UPDATE is idempotent so concurrent
        // sweeps are harmless. `unref()` so it never holds the process open.
        const sweepTimer = setInterval(() => {
          void store
            .expireStaleProposals()
            .catch((error: unknown) =>
              logger.warn(
                `[ai-backend] proposal sweep failed: ${String(error)}`,
              ),
            );
        }, PROPOSAL_SWEEP_INTERVAL_MS);
        sweepTimer.unref?.();

        logger.debug(
          `🤖 AI Backend init complete with ${registry.getTools().length} tools; MCP endpoint at /api/ai/mcp`,
        );
      },
      // Phase 3: every plugin has now run init, so all read projections have been
      // exposed via aiToolProjectionExtensionPoint. Collect their routing into
      // the shared `mcpExecutableTools` array (read lazily by the MCP handler on
      // first request) and seed the chat loop's read-tool routing. This is the
      // ONLY place ai-backend learns which plugins projected read tools - it
      // never imports a plugin's `*-common`.
      afterPluginsReady: async ({ logger }) => {
        for (const route of exposedProjections) {
          const tool = registry.getTool(route.toolName);
          if (!tool) continue;
          mcpExecutableTools.push({
            tool,
            pluginId: route.pluginId,
            procedureKey: route.procedureKey,
          });
          if (tool.effect === "read") {
            chatService?.readRouting.set(tool.name, {
              pluginId: route.pluginId,
              procedureKey: route.procedureKey,
            });
          }
        }
        logger.debug(
          `🤖 AI Backend wired ${mcpExecutableTools.length} projected read tool(s) from plugins: ${mcpExecutableTools.map((t) => t.tool.name).join(", ") || "(none)"}`,
        );
      },
    });
  },
});

// ─── Re-exports (public backend surface) ────────────────────────────────
export {
  aiToolExtensionPoint,
  aiToolProjectionExtensionPoint,
  systemSignalsExtensionPoint,
  principalGrantedRuleIds,
} from "./extension-points";
export type {
  AiToolExtensionPoint,
  AiToolProjectionExtensionPoint,
  SystemSignalsExtensionPoint,
  SystemSignalsContributor,
  SystemSignalsContribution,
} from "./extension-points";
export {
  createSystemIssuesTool,
  mergeSystemSignalsMaps,
  collectSystemSignals,
  toSystemIssuesOutput,
  SystemIssuesInputSchema,
  SystemIssuesOutputSchema,
  type SystemIssuesInput,
  type SystemIssuesOutput,
} from "./tools/system-issues";
export {
  createAiToolRegistry,
  type AiToolRegistry,
  type RegisteredAiTool,
} from "./tool-registry";
export {
  createAiToolResolver,
  isToolAllowed,
  principalSatisfiesRules,
  type AiToolResolver,
} from "./resolver";
export {
  buildProjectedTool,
  deferredProjectionExecute,
  type ProjectToolInput,
} from "./projection";
export {
  createAgentRunner,
  aiAgentRunnerRef,
  type AiAgentRunner,
  type AgentTaskInput,
  type AgentTaskResult,
  type AgentTaskToolCall,
  type AgentRunnerModelFns,
} from "./agent-runner";
export { serializeTool, serializeTools } from "./serializer";
export {
  createOpenAiCompatibleProvider,
  OpenAiCompatibleConnectionSchema,
} from "./openai-provider";
export {
  createProposeApplyService,
  ProposeApplyError,
  type ProposeApplyService,
  type ProposeApplyErrorCode,
  type ProposeResult,
  type ApplyResult,
  type ProposalDescription,
} from "./propose-apply/service";
export {
  createAiToolCallStore,
  PROPOSAL_TTL_MS,
  type AiToolCallStore,
  type AuditPrincipal,
} from "./propose-apply/store";
export {
  formatProposalToken,
  parseProposalToken,
  generateProposalNonce,
  nonceMatches,
} from "./propose-apply/token";
export { hashToolArgs } from "./propose-apply/args-hash";
// Automation + health-check AI tools now live in their owning plugins
// (@checkstack/automation-backend / @checkstack/healthcheck-backend), registered
// via aiToolExtensionPoint, not in ai-backend's public surface.
export { buildCompositeTools } from "./tools/composite-tools";
// Script-context TOOLS now live per-plugin (healthcheck-backend /
// automation-backend); ai-backend keeps only the plugin-agnostic machinery
// (resolveScriptContext + descriptors below) for plugins to import.
export {
  resolveScriptContext,
  extractDeclareModuleBlock,
  renderShellEnvDeclarations,
  buildStarterExample,
  ScriptContextExtractionError,
  SCRIPT_CONTEXT_DESCRIPTORS,
  HEALTHCHECK_SHELL_ENV,
  AUTOMATION_SHELL_ENV,
  type ScriptContextDescriptor,
  type ResolvedScriptContext,
} from "./tools/script-context-extract";
// Capability catalog tools are now per-plugin (healthcheck-backend /
// automation-backend), registered via aiToolExtensionPoint.
// The capability-summary + field-diff helpers now live in @checkstack/ai-common
// (pure, shareable). Import them from there.
export { aiHooks, type AiToolCalledPayload } from "./hooks";
export {
  aiToolCalls,
  aiConversations,
  aiMessages,
} from "./schema";
export {
  createAiConversationStore,
  type AiConversationStore,
  type AiMessageRole,
} from "./chat/conversation-store";
export {
  createChatService,
  buildChatToolCallbacks,
  toModelMessages,
  type ChatService,
  type ChatConnectionResolver,
  type ChatRecordExecuted,
  type ChatTurnInput,
  type ChatDecisionInput,
} from "./chat/chat-service";
export { createChatRequestHandler } from "./chat/chat-handler";
export {
  disposeAgentTool,
  offeredTools,
  type AgentToolDisposition,
} from "./chat/agent-loop";
export {
  buildLanguageModel,
  resolveModelId,
} from "./chat/llm-provider";
export {
  checkToolBudget,
  enforceToolBudget,
  ToolBudgetExceededError,
  TOOL_BUDGET_MAX_CALLS,
  TOOL_BUDGET_WINDOW_MS,
} from "./rate-limit/tool-budget";
export {
  checkSpendCap,
  enforceSpendCap,
  recordSpend,
  SpendCapExceededError,
  type SpendCheckResult,
  type SpendUsageInput,
} from "./rate-limit/spend-ledger";
export {
  scrubContent,
  scrubModelMessages,
  REDACTED,
} from "./chat/scrub-content";
export { aiSpend } from "./schema";
