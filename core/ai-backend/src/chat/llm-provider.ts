import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { OpenAiCompatibleConnection } from "@checkstack/ai-common";

/**
 * Build a provider-agnostic language model from an OpenAI-compatible connection
 * (decision §14.6). The `baseURL` override is what makes this work against
 * OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio, etc. - any endpoint that
 * speaks the OpenAI CHAT-COMPLETIONS wire format.
 *
 * Why `@ai-sdk/openai-compatible` and NOT `@ai-sdk/openai`: the strict OpenAI
 * provider (`@ai-sdk/openai` v3) defaults to OpenAI's `/responses` API, which
 * sends `reasoning` / `reasoning_text` message parts that third-party gateways
 * (OpenRouter, DeepSeek, Ollama, ...) do not implement - they reject it with
 * HTTP 400 `invalid_prompt` "Invalid Responses API request". The compatible
 * provider talks plain `/chat/completions` and omits OpenAI-only request fields,
 * which is exactly what an "OpenAI-compatible connection" needs.
 *
 * CRITICAL (security): the credential (`apiKey`) is read here, on the BACKEND,
 * and handed to the SDK provider (as a `Bearer` Authorization header). It never
 * crosses an RPC/DTO boundary to the browser - the chat UI only ever receives
 * streamed tokens + tool events.
 *
 * The requested model id is ALWAYS coerced through {@link resolveModelId}
 * against the connection's `availableModels` allowlist, so a model id from the
 * wire (untrusted) can never bypass the per-integration model/cost control. The
 * model id used by the provider is the resolved one, never the raw request.
 */
export function buildLanguageModel({
  connection,
  model,
}: {
  connection: OpenAiCompatibleConnection;
  /** Conversation-selected model id; revalidated against the connection. */
  model?: string;
}): LanguageModel {
  const provider = createOpenAICompatible({
    name: "checkstack-openai-compatible",
    baseURL: connection.baseUrl,
    apiKey: connection.apiKey,
  });
  const modelId = resolveModelId({ connection, requested: model });
  // `.chatModel` pins the `/chat/completions` API (see the Responses-API note
  // above), the lingua franca every OpenAI-compatible gateway supports.
  return provider.chatModel(modelId);
}

/**
 * Resolve the effective model id for a conversation against the connection's
 * allowlist (§14.6). A requested model not in a non-empty `availableModels`
 * allowlist falls back to `defaultModel` (the model picker is constrained UI
 * side, but the model is untrusted input from the wire, so we re-check).
 */
export function resolveModelId({
  connection,
  requested,
}: {
  connection: OpenAiCompatibleConnection;
  requested?: string;
}): string {
  if (!requested) return connection.defaultModel;
  const allow = connection.availableModels;
  if (allow && allow.length > 0 && !allow.includes(requested)) {
    return connection.defaultModel;
  }
  return requested;
}
