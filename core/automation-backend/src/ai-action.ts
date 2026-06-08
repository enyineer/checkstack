/**
 * The "AI Analysis" automation action.
 *
 * Runs a bounded AI agent on the automation's run context (trigger payload +
 * upstream artifacts). The agent can investigate and act through the SAME tools
 * the chat assistant uses - but as the automation's `runAs` SERVICE ACCOUNT, so
 * it can never exceed that identity's permissions. It optionally produces a
 * structured, author-defined artifact (e.g. a "severity" field) that downstream
 * actions can consume and branch on.
 *
 * The agent loop itself lives in `@checkstack/ai-backend` (the AI platform) and
 * is consumed here via the `aiAgentRunnerRef` service - automation-backend
 * already depends on ai-backend, so this is a one-directional consumer.
 */
import { z } from "zod";
import {
  Versioned,
  coreServices,
  configString,
  type AuthUser,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import { aiAgentRunnerRef } from "@checkstack/ai-backend";
import {
  pluginMetadata as aiPluginMetadata,
  OPENAI_COMPATIBLE_PROVIDER_LOCAL_ID,
} from "@checkstack/ai-common";
import { AuthApi } from "@checkstack/auth-common";

import type { ActionDefinition, ActionRunScope } from "./action-types";

/**
 * Fully-qualified id of the OpenAI-compatible integration provider (owned by
 * ai-backend). Setting it as the action's `connectionProviderId` lets the
 * automation editor render a connection picker for the `connectionId` field
 * (bridged to `listConnections` via the `"connectionOptions"` resolver).
 */
const AI_CONNECTION_PROVIDER_ID = `${aiPluginMetadata.pluginId}.${OPENAI_COMPATIBLE_PROVIDER_LOCAL_ID}`;

// ─── Config ──────────────────────────────────────────────────────────────

const outputFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .describe("Artifact field name (a downstream action reads it by this key)"),
  type: z
    .enum(["string", "number", "boolean", "enum"])
    .describe("Field type the AI must produce"),
  description: z
    .string()
    .min(1)
    .describe("What this field means - guides the AI"),
  options: z
    .array(z.string())
    .optional()
    .describe("Allowed values when type is 'enum'"),
});

export type AiOutputField = z.infer<typeof outputFieldSchema>;

const aiActionConfigSchema = z.object({
  // `connectionOptions` is the editor convention: combined with the action's
  // `connectionProviderId`, the editor renders a connection picker populated
  // from `listConnections` for that provider.
  connectionId: configString({ "x-options-resolver": "connectionOptions" })
    .min(1)
    .describe("AI integration connection (OpenAI-compatible) to use"),
  model: z
    .string()
    .optional()
    .describe("Model override; defaults to the connection's default model"),
  prompt: z
    .string()
    .min(1)
    .describe(
      "What the AI should do. The automation's trigger payload and upstream artifacts are appended automatically.",
    ),
  systemPrompt: z
    .string()
    .optional()
    .describe("Optional system-prompt override for the agent"),
  maxSteps: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Max tool-call rounds (defaults to 12)"),
  outputFields: z
    .array(outputFieldSchema)
    .max(20)
    .default([])
    .describe(
      "Optional structured output fields. When set, the AI fills them and they become the action's artifact.",
    ),
});

export type AiActionConfig = z.infer<typeof aiActionConfigSchema>;

// ─── Artifact ──────────────────────────────────────────────────────────────

const aiAnalysisArtifactSchema = z.object({
  /** The agent's free-text result. */
  summary: z.string(),
  /** The author-defined structured object (null when no outputFields set). */
  data: z.unknown(),
  /** Per-tool-call outcomes for run-detail visibility. */
  toolCalls: z.array(z.object({ tool: z.string(), ok: z.boolean() })),
});

export type AiAnalysisArtifact = z.infer<typeof aiAnalysisArtifactSchema>;

export const aiAnalysisArtifactType = {
  id: "analysis",
  displayName: "AI Analysis",
  description:
    "Result of an `ai_analyze` action: a summary plus the author-defined structured fields and the tools the agent used",
  schema: aiAnalysisArtifactSchema,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a zod object schema from the action's author-defined output fields, to
 * drive the agent's structured-output pass. An `enum` field with no options
 * degrades to a free string (the editor should require options, but we never
 * throw at run time over a misconfigured field).
 */
export function buildOutputSchema(fields: AiOutputField[]): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let fieldSchema: z.ZodTypeAny;
    switch (field.type) {
      case "number": {
        fieldSchema = z.number();
        break;
      }
      case "boolean": {
        fieldSchema = z.boolean();
        break;
      }
      case "enum": {
        // Dynamic enum from runtime config: zod needs a non-empty tuple type
        // here, which a runtime `string[]` cannot express; the values are
        // validated by zod at parse time regardless. This is the one
        // unavoidable cast (a config-driven enum). No options -> free string.
        fieldSchema =
          field.options && field.options.length > 0
            ? z.enum(field.options as [string, ...string[]])
            : z.string();
        break;
      }
      default: {
        fieldSchema = z.string();
        break;
      }
    }
    shape[field.key] = fieldSchema.describe(field.description);
  }
  return z.object(shape);
}

/** Compose the agent prompt: the author's instruction + the run context. */
export function buildAgentPrompt(
  userPrompt: string,
  scope: ActionRunScope | undefined,
): string {
  const context = scope
    ? JSON.stringify(
        { trigger: scope.trigger, artifacts: scope.artifacts, vars: scope.vars },
        null,
        2,
      )
    : "{}";
  return `${userPrompt}\n\n--- Automation context ---\n${context}`;
}

// ─── Action ──────────────────────────────────────────────────────────────

export const aiAnalyzeAction: ActionDefinition<
  AiActionConfig,
  AiAnalysisArtifact
> = {
  id: "ai_analyze",
  displayName: "AI Analysis",
  description:
    "Run an AI agent on the automation context. It can investigate and act through tools as the automation's service account, and optionally produce structured output for later actions.",
  category: "AI",
  icon: "Sparkles",
  connectionProviderId: AI_CONNECTION_PROVIDER_ID,
  config: new Versioned({ version: 1, schema: aiActionConfigSchema }),
  produces: "automation.analysis",
  execute: async ({ config, scope, logger, rpcClient, getService, runAs }) => {
    if (!runAs) {
      return {
        success: false,
        error:
          "The AI action requires the automation to have a service account (runAs).",
      };
    }

    try {
      // Resolve the run's PRINCIPAL (rules + teams) so the agent runner offers
      // exactly the tools this service account may use. Enrichment is a trusted
      // S2S read of the app's own rules - distinct from the bounded `rpcClient`
      // the agent actually executes tools with.
      const serviceClient = await getService(coreServices.rpcClient);
      const enriched = await serviceClient
        .forPlugin(AuthApi)
        .enrichApplicationPrincipal({ applicationId: runAs });
      if (!enriched) {
        return {
          success: false,
          error: `Service account "${runAs}" could not be resolved.`,
        };
      }
      const principal: AuthUser = {
        type: "application",
        id: enriched.id,
        name: enriched.name,
        roles: enriched.roles,
        accessRules: enriched.accessRules,
        teamIds: enriched.teamIds,
      };

      const runner = await getService(aiAgentRunnerRef);
      const outputSchema =
        config.outputFields.length > 0
          ? buildOutputSchema(config.outputFields)
          : undefined;

      const result = await runner({
        principal,
        rpcClient,
        connectionId: config.connectionId,
        model: config.model,
        systemPrompt: config.systemPrompt,
        prompt: buildAgentPrompt(config.prompt, scope),
        outputSchema,
        maxSteps: config.maxSteps,
      });

      const usedTools = result.toolCalls.map((c) => c.tool).join(", ") || "none";
      logger.info(
        `ai_analyze: ${result.toolCalls.length} tool call(s) [${usedTools}]`,
      );

      return {
        success: true,
        artifact: {
          summary: result.text,
          data: result.object ?? null,
          toolCalls: result.toolCalls,
        },
      };
    } catch (error) {
      const message = extractErrorMessage(error);
      logger.error(`ai_analyze failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
