/**
 * Headless AI agent runner.
 *
 * The chat agent loop is HTTP/streaming/conversation-coupled. This is the
 * transport-agnostic core for running ONE bounded agent task with no human in
 * the loop - the engine behind the automation "AI Action". It is exposed as a
 * service ({@link aiAgentRunnerRef}) so `automation-backend` (which already
 * depends on `ai-backend`) can drive it without ai-backend depending on
 * automation-backend.
 *
 * Security: the runner resolves the allowed tools for the supplied PRINCIPAL
 * (the automation's `runAs` service account) and executes them through the
 * supplied `rpcClient` (bound to that same principal), so every call is
 * authorized exactly as that bounded identity. Destructive tools are NEVER
 * offered (no human to confirm), matching the chat invariant.
 *
 * Tools offered: hand-authored read + mutate tools (run via their own
 * `execute`) AND projected read tools (routed through the live router as the
 * principal via the supplied `getProjectionRoute`). Destructive tools are never
 * offered. Mutating tools auto-apply (executed directly via the principal's
 * client); the propose/apply token gate is a chat/MCP human gate, intentionally
 * bypassed here (the run is unattended and bounded by the principal).
 */
import {
  tool as aiTool,
  stepCountIs,
  generateText,
  generateObject,
  type Tool,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { dateSafeModelSchema, schemaContainsDate } from "./chat/model-schema";
import {
  createServiceRef,
  type AuthUser,
  type RpcClient,
} from "@checkstack/backend-api";
import type {
  OpenAiCompatibleConnection,
  AiToolEffect,
} from "@checkstack/ai-common";
import { extractErrorMessage, type ClientDefinition } from "@checkstack/common";
import type { AiToolResolver } from "./resolver";
import { buildLanguageModel } from "./chat/llm-provider";
import { deferredProjectionExecute } from "./projection";

const DEFAULT_MAX_STEPS = 8;

const DEFAULT_SYSTEM_PROMPT = [
  "You are an automation agent acting UNATTENDED - there is no human to ask.",
  "You run with a bounded service account; you can only do what its permissions allow.",
  "Use the available tools to investigate and act decisively on the task.",
  "If a tool call is refused, do not retry it - work within your permissions.",
  "Never attempt destructive actions. Be concise.",
].join(" ");

/** One tool invocation outcome, surfaced in the action's artifact for audit. */
export interface AgentTaskToolCall {
  tool: string;
  ok: boolean;
}

export interface AgentTaskInput {
  /**
   * The principal the task runs as (the automation's `runAs` service account,
   * already enriched). The runner resolves the allowed tools from it and
   * executes them through `rpcClient`, which must be bound to the SAME
   * identity, so authorization is enforced exactly as that bounded principal.
   */
  principal: AuthUser;
  /** RPC client bound to that same service account (the run's `context.rpcClient`). */
  rpcClient: RpcClient;
  /** Integration connection id for the OpenAI-compatible model. */
  connectionId: string;
  /** Optional model override (validated against the connection's allowlist). */
  model?: string;
  /** Optional system-prompt override. */
  systemPrompt?: string;
  /** The task prompt (the automation injects its trigger/artifact context here). */
  prompt: string;
  /**
   * When provided, after the tool loop the runner runs a structured-output
   * pass to fill this schema - the action's typed artifact.
   */
  outputSchema?: z.ZodType;
  /** Max agent steps (tool-call rounds). Defaults to 8. */
  maxSteps?: number;
}

export interface AgentTaskResult {
  /** The model's free-text result of the loop. */
  text: string;
  /** The structured object, present iff `outputSchema` was provided. */
  object?: unknown;
  /** Per-tool-call outcomes. */
  toolCalls: AgentTaskToolCall[];
}

export type AiAgentRunner = (input: AgentTaskInput) => Promise<AgentTaskResult>;

/** Service ref so `automation-backend` can resolve the runner at action time. */
export const aiAgentRunnerRef =
  createServiceRef<AiAgentRunner>("ai.agentRunner");

/** Injectable model functions (so the runner is unit-testable without a model). */
export interface AgentRunnerModelFns {
  generateText: typeof generateText;
  generateObject: typeof generateObject;
}

export function createAgentRunner({
  resolver,
  resolveConnection,
  getProjectionRoute,
  recordToolCall,
  modelFns,
}: {
  resolver: AiToolResolver;
  resolveConnection: (
    connectionId: string,
  ) => Promise<OpenAiCompatibleConnection | undefined>;
  /**
   * Resolve a projected read tool's underlying procedure routing
   * (`{ pluginId, procedureKey }`). When provided, projected read tools are
   * offered and invoked through the principal's client; when omitted they are
   * not offered (cannot be run headlessly).
   */
  getProjectionRoute?: (
    toolName: string,
  ) => { pluginId: string; procedureKey: string } | undefined;
  /**
   * Best-effort audit hook, called once per tool invocation. Lets the host
   * record the call into the durable AI audit log (with the `automation`
   * transport). Failures here never break the agent loop.
   */
  recordToolCall?: (args: {
    principal: AuthUser;
    toolName: string;
    effect: AiToolEffect;
    input: unknown;
    ok: boolean;
    error?: string;
  }) => Promise<void>;
  modelFns?: Partial<AgentRunnerModelFns>;
}): AiAgentRunner {
  const gen = modelFns?.generateText ?? generateText;
  const genObj = modelFns?.generateObject ?? generateObject;

  return async ({
    principal,
    rpcClient,
    connectionId,
    model,
    systemPrompt,
    prompt,
    outputSchema,
    maxSteps,
  }) => {
    const connection = await resolveConnection(connectionId);
    if (!connection) {
      throw new Error(
        `AI connection "${connectionId}" not found or not a valid OpenAI-compatible connection.`,
      );
    }
    const languageModel: LanguageModel = buildLanguageModel({
      connection,
      model,
    });

    // Offer the principal's read + mutate tools (never destructive - no human
    // to confirm). Hand-authored tools run via their own `execute`; projected
    // read tools (the deferred sentinel) are routed through the live router AS
    // the principal via `rpcClient`, so handler-side authz still holds.
    const offered = resolver
      .resolveTools(principal)
      .filter((t) => t.effect !== "destructive");

    const toolCalls: AgentTaskToolCall[] = [];
    const sdkTools: Record<string, Tool> = {};
    for (const t of offered) {
      const isProjected = t.execute === deferredProjectionExecute;
      const route = isProjected ? getProjectionRoute?.(t.name) : undefined;
      // A projected tool with no resolvable route cannot be invoked headlessly;
      // skip it rather than calling the deferred sentinel (which throws).
      if (isProjected && !route) continue;

      const invoke = route
        ? async (input: unknown) => {
            // `forPlugin` only reads `.pluginId`; this re-enters the live router
            // AS the principal for the projected read's underlying procedure,
            // so handler-side authz applies exactly as a direct call.
            const pluginClient = rpcClient.forPlugin({
              pluginId: route.pluginId,
            } as ClientDefinition) as Record<
              string,
              (i: unknown) => Promise<unknown>
            >;
            return pluginClient[route.procedureKey](input);
          }
        : async (input: unknown) => t.execute({ input, principal, rpcClient });

      sdkTools[t.name] = aiTool({
        description: t.description,
        inputSchema: t.input as z.ZodType,
        execute: async (input: unknown) => {
          try {
            const result = await invoke(input);
            toolCalls.push({ tool: t.name, ok: true });
            if (recordToolCall) {
              await recordToolCall({
                principal,
                toolName: t.name,
                effect: t.effect,
                input,
                ok: true,
              }).catch(() => {});
            }
            return result;
          } catch (error) {
            // Surface the failure to the model (e.g. a missing-permission
            // message) so it can adapt, rather than aborting the whole run.
            const message = extractErrorMessage(error);
            toolCalls.push({ tool: t.name, ok: false });
            if (recordToolCall) {
              await recordToolCall({
                principal,
                toolName: t.name,
                effect: t.effect,
                input,
                ok: false,
                error: message,
              }).catch(() => {});
            }
            return { error: message };
          }
        },
      });
    }

    const { text } = await gen({
      model: languageModel,
      system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      prompt,
      tools: sdkTools,
      stopWhen: stepCountIs(maxSteps ?? DEFAULT_MAX_STEPS),
    });

    let object: unknown;
    if (outputSchema) {
      const res = await genObj({
        model: languageModel,
        // Same model-boundary date handling as the chat tool path: a date in
        // the structured-output schema would otherwise make the SDK's
        // Zod->JSON-Schema conversion throw, and the model's ISO strings need
        // coercing back to Date. Non-date schemas pass through untouched.
        schema: schemaContainsDate(outputSchema)
          ? dateSafeModelSchema(outputSchema)
          : outputSchema,
        system:
          "Produce the structured result from the analysis below. Use only information present in it; do not invent values.",
        prompt: `Task: ${prompt}\n\n--- Analysis ---\n${text}`,
      });
      object = res.object;
    }

    return { text, object, toolCalls };
  };
}
