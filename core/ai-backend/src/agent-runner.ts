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
import { toModelSchema } from "./chat/model-schema";
import {
  buildDateTimeContext,
  buildHeadlessSystemPrompt,
} from "./chat/system-prompt";
import { prepareFinalAnswerStep } from "./step-budget.logic";
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

// The last step is reserved for the forced answer (tools removed via
// `prepareStep`), so an action gets `DEFAULT_MAX_STEPS - 1` rounds of tool use
// by default. Authors can override per-action up to the config schema's cap.
const DEFAULT_MAX_STEPS = 12;

/** Provider-safe name of the memory-save tool (dots map to underscores). */
const MEMORY_SAVE_TOOL_NAME = "ai_saveMemory";
/** Max `saveMemory` calls one unattended run may make (see the per-run cap). */
export const MAX_MEMORY_SAVES_PER_RUN = 3;

/** Whether another `saveMemory` is allowed given how many a run has already done. */
export function memorySaveAllowed(savesSoFar: number): boolean {
  return savesSoFar < MAX_MEMORY_SAVES_PER_RUN;
}

/**
 * How many times the structured-output pass re-prompts the model after its
 * output fails the author's schema before giving up. The validated artifact
 * contract is non-negotiable (a malformed object must never reach a downstream
 * `choose`/`condition`), but a near-miss is usually recoverable - so we feed the
 * failure back and let the model self-correct rather than hard-failing the step.
 */
const MAX_OUTPUT_REPAIR_ATTEMPTS = 2;

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
    // Per-run cap on memory writes: the unattended agent auto-applies mutates
    // with no human confirm, so bound how many memories one run can save (the
    // prompt also asks for at most one). Prevents a looping run from flooding
    // memory. Recall/search is unbounded.
    let memorySaves = 0;
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
        // Single model-boundary date handling, same as the chat tool path.
        inputSchema: toModelSchema(t.input as z.ZodType),
        execute: async (input: unknown) => {
          // Enforce the per-run memory-save cap before invoking. Surface the
          // limit to the model (not a throw) so it adapts gracefully.
          if (t.name === MEMORY_SAVE_TOOL_NAME && !memorySaveAllowed(memorySaves)) {
            const message = `Memory save limit for this run reached (${MAX_MEMORY_SAVES_PER_RUN}); not saving again.`;
            toolCalls.push({ tool: t.name, ok: false });
            return { error: message };
          }
          try {
            const result = await invoke(input);
            if (t.name === MEMORY_SAVE_TOOL_NAME) memorySaves += 1;
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

    // Append the date/time context at call time (NOT module load) so the model
    // gets the CURRENT instant and the host-zone wire contract. Headless: no
    // operator, so the reference zone is the host/container TZ.
    const dateContext = buildDateTimeContext({ audience: "headless" });
    const effectiveMaxSteps = maxSteps ?? DEFAULT_MAX_STEPS;
    const { text } = await gen({
      model: languageModel,
      // The non-negotiable headless baseline plus any author override (appended,
      // never substituted), so an override can add task framing but can never
      // drop a boundary/safety line - then the live date/time context.
      system: `${buildHeadlessSystemPrompt({ override: systemPrompt })} ${dateContext}`,
      prompt,
      tools: sdkTools,
      stopWhen: stepCountIs(effectiveMaxSteps),
      // On the final step, remove all tools so the action always produces a
      // text summary instead of an empty one (model spent its last step on a
      // tool call). activeTools:[] avoids the toolChoice:"none" markup-leak path.
      prepareStep: ({ stepNumber }) =>
        prepareFinalAnswerStep({ stepNumber, maxSteps: effectiveMaxSteps }),
    });

    let object: unknown;
    if (outputSchema) {
      object = await generateStructuredWithRepair({
        genObj,
        languageModel,
        outputSchema,
        taskPrompt: prompt,
        analysis: text,
      });
    }

    return { text, object, toolCalls };
  };
}

/**
 * Run the structured-output pass with a bounded self-correction loop: if the
 * model's output fails the schema, feed the validation error back and retry up
 * to {@link MAX_OUTPUT_REPAIR_ATTEMPTS} times before giving up. This closes the
 * feedback loop so a recoverable near-miss (e.g. an enum value just outside the
 * allowed set) self-corrects instead of failing the whole action - while the
 * schema contract still holds: after the retries are exhausted the last error
 * propagates and the step fails rather than emitting a malformed artifact.
 *
 * We retry on ANY thrown error (bounded), feeding its message back as guidance:
 * a schema mismatch is by far the dominant `generateObject` failure, and harm-
 * lessly re-attempting a transient fault a couple of times is acceptable. The
 * final failure is re-thrown for the caller (the AI action) to surface.
 */
async function generateStructuredWithRepair({
  genObj,
  languageModel,
  outputSchema,
  taskPrompt,
  analysis,
}: {
  genObj: typeof generateObject;
  languageModel: LanguageModel;
  outputSchema: z.ZodType;
  taskPrompt: string;
  analysis: string;
}): Promise<unknown> {
  // Same single model-boundary date handling as the tool path: the schema's
  // dates must serialize AND the model's ISO strings coerce back to Date.
  const schema = toModelSchema(outputSchema);
  const baseSystem =
    "Produce the structured result from the analysis below. Use only information present in it; do not invent values.";
  let repairNote = "";
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_OUTPUT_REPAIR_ATTEMPTS; attempt++) {
    try {
      const res = await genObj({
        model: languageModel,
        schema,
        system: `${baseSystem}${repairNote}`,
        prompt: `Task: ${taskPrompt}\n\n--- Analysis ---\n${analysis}`,
      });
      return res.object;
    } catch (error) {
      lastError = error;
      repairNote = ` Your previous output was rejected: ${extractErrorMessage(
        error,
      )}. Return ONLY a value that exactly matches the required schema.`;
    }
  }
  throw lastError;
}
