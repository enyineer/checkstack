import { z } from "zod";
import { Versioned, configString, configNumber } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import type {
  IntegrationProvider,
  TestConnectionResult,
} from "@checkstack/integration-backend";
import {
  OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  OPENAI_COMPATIBLE_PROVIDER_LOCAL_ID,
  type OpenAiCompatibleConnection,
} from "@checkstack/ai-common";
import type { AiSkillResolver } from "./skill-resolver";

/**
 * Connection schema for an OpenAI-compatible LLM provider (OpenAI, Azure,
 * OpenRouter, Ollama, vLLM, LM Studio, ...). Model choice lives on the
 * connection (decision §14.6): `defaultModel` is required, `availableModels`
 * optionally constrains the Phase 4 chat model picker.
 *
 * `apiKey` is marked `x-secret`, so the integration platform stores it in the
 * Secrets Vault and redacts it from every UI / DTO response — the credential
 * never leaves the backend.
 */
/**
 * Normalize the raw `spendCap` input before validation. A spend cap is OPTIONAL
 * (absent = unlimited), and the schema-driven connection form always renders the
 * nested `tokenBudget` / `windowMinutes` fields, so leaving them blank submits a
 * PRESENT-but-empty object (empty strings / `undefined`) rather than omitting
 * `spendCap`. Treat any such empty/incomplete cap as "no cap" so an operator can
 * save a connection without configuring a budget: if either bound is unset or
 * blank, the whole cap collapses to `undefined` (unlimited). A fully-specified
 * cap passes through untouched for the object schema to validate.
 */
function normalizeSpendCap(value: unknown): unknown {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const cap = value as Record<string, unknown>;
    const isBlank = (field: unknown): boolean =>
      field === undefined || field === null || field === "";
    if (isBlank(cap.tokenBudget) || isBlank(cap.windowMinutes)) {
      return undefined;
    }
  }
  return value;
}

export const OpenAiCompatibleConnectionSchema = z.object({
  baseUrl: configString({})
    .url()
    .default(OPENAI_COMPATIBLE_DEFAULT_BASE_URL)
    .describe("OpenAI-compatible base URL (e.g. https://api.openai.com/v1)"),
  apiKey: configString({ "x-secret": true }).describe("API key"),
  defaultModel: configString({})
    .min(1)
    .describe("Default model id (e.g. gpt-4o-mini)"),
  availableModels: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional allowlist of selectable model ids"),
  spendCap: z
    .preprocess(
      normalizeSpendCap,
      z
        .object({
          tokenBudget: configNumber({})
            .int()
            .positive()
            .describe(
              "Max total tokens (input + output) per user per window before chat is refused",
            ),
          windowMinutes: configNumber({})
            .int()
            .positive()
            .describe(
              "Rolling window length in minutes the token budget resets over",
            ),
        })
        .optional(),
    )
    .describe(
      "Optional LLM spend cap (token-count). Leave both fields blank for no cap. Enforced server-side and counted across all pods.",
    ),
}) satisfies z.ZodType<OpenAiCompatibleConnection>;

/**
 * The OpenAI-compatible integration provider. Registering it through
 * `integrationProviderExtensionPoint` makes it appear in the generic
 * Connections settings UI (rendered from `connectionSchema` via `DynamicForm`),
 * exactly like every other integration provider — no AI-specific Settings page
 * is required for credential management.
 */
export function createOpenAiCompatibleProvider({
  skillResolver,
}: {
  /**
   * Optional skill resolver. When present, the provider serves the
   * `aiSkillOptions` dropdown for the `ai_analyze` action's `skillId` field so
   * the automation editor renders a real skill picker (not a raw text input).
   */
  skillResolver?: AiSkillResolver;
} = {}): IntegrationProvider<OpenAiCompatibleConnection> {
  return {
    id: OPENAI_COMPATIBLE_PROVIDER_LOCAL_ID,
    displayName: "OpenAI-compatible",
    description:
      "LLM provider for the AI platform (OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio).",
    icon: "Sparkles",
    connectionSchema: new Versioned({
      version: 1,
      schema: OpenAiCompatibleConnectionSchema,
    }),
    documentation: {
      setupGuide: `
## OpenAI-compatible provider

Configure credentials for any OpenAI-compatible chat-completions endpoint.

1. Set the base URL (defaults to \`https://api.openai.com/v1\`). For other
   providers use their base URL, e.g. \`https://openrouter.ai/api/v1\` or a
   local \`http://localhost:11434/v1\` for Ollama.
2. Paste an API key. It is stored in the Secrets Vault and never returned to
   the browser.
3. Set a default model id (for example \`gpt-4o-mini\`). Optionally add an
   allowlist of selectable models.
      `.trim(),
    },
    async testConnection(
      config: OpenAiCompatibleConnection,
    ): Promise<TestConnectionResult> {
      try {
        // Strip trailing slashes without a backtracking-prone regex
        // (`/\/+$/` is O(n^2) on inputs like "////...x" - CodeQL js/polynomial-redos).
        let base = config.baseUrl;
        while (base.endsWith("/")) base = base.slice(0, -1);
        const response = await fetch(`${base}/models`, {
          headers: { authorization: `Bearer ${config.apiKey}` },
        });
        if (!response.ok) {
          return {
            success: false,
            message: `Provider returned ${response.status} ${response.statusText}`,
          };
        }
        return { success: true, message: "Connection successful" };
      } catch (error) {
        return {
          success: false,
          message: `Failed to reach provider: ${extractErrorMessage(error)}`,
        };
      }
    },
    /**
     * Dropdown options for the `ai_analyze` action's resolver-backed fields.
     * `aiSkillOptions` lists the skills targeting the analyze action (builtin +
     * global user skills); the `connectionId` is intentionally ignored - skills
     * are not connection-scoped.
     */
    async getConnectionOptions({ resolverName }) {
      if (resolverName === "aiSkillOptions" && skillResolver) {
        const skills = await skillResolver.list("ai_analyze");
        return skills.map((skill) => ({ value: skill.id, label: skill.name }));
      }
      return [];
    },
  };
}
