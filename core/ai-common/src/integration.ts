/**
 * Shape of an OpenAI-compatible integration connection.
 *
 * The runtime zod schema (with `x-secret` on `apiKey` and the `Versioned`
 * wrapper) lives in `@checkstack/ai-backend` because it depends on backend-only
 * helpers (`configString` / `Versioned`). This type is the cross-package
 * contract for the same shape.
 *
 * Model choice is a property of the credential / provider (decision §14.6), so
 * it lives on the connection, not a separate global setting:
 * - `baseUrl`     — provider base URL (default `https://api.openai.com/v1`).
 * - `apiKey`      — secret API key (`x-secret`, stored in the Secrets Vault).
 * - `defaultModel` — required; used unless a conversation overrides it.
 * - `availableModels` — optional allowlist; when present the chat model picker
 *   is constrained to it, otherwise a free-text field is shown (Phase 4).
 * - `spendCap` — OPTIONAL per-integration LLM spend cap (Phase 6). Off unless
 *   configured. A token-count budget over a rolling window, enforced server-side
 *   and counted across all pods from the shared `ai_spend` ledger.
 */
export interface OpenAiCompatibleConnection {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  availableModels?: string[];
  spendCap?: AiSpendCap;
}

/**
 * Optional per-integration LLM spend cap (Phase 6). Token-count, not USD:
 * deterministic and provider-agnostic (OpenAI / Azure / OpenRouter / Ollama /
 * vLLM all report tokens via the AI SDK; only some have a price table). When set,
 * the chat agent loop refuses a new turn once the principal's token usage against
 * this integration in the trailing `windowMinutes` reaches `tokenBudget`. Absent
 * = no cap.
 */
export interface AiSpendCap {
  /** Max total tokens (input + output) per principal per window. Must be > 0. */
  tokenBudget: number;
  /** Rolling window length in minutes the budget is measured over. Must be > 0. */
  windowMinutes: number;
}

/** Local provider id; namespaced on registration to `ai.openai-compatible`. */
export const OPENAI_COMPATIBLE_PROVIDER_LOCAL_ID = "openai-compatible";

/** Default OpenAI-compatible base URL. */
export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "https://api.openai.com/v1";
