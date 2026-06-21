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
  /**
   * OPTIONAL context-window size (in tokens) of the configured model. When set,
   * the chat loop estimates the prompt size and COMPACTS old turns (folds them
   * into a running summary) before they overflow the window, instead of letting
   * the provider 400. Leave blank to use a conservative built-in default. Set it
   * to your model's real window (e.g. 128000) for tighter, more accurate use.
   */
  contextWindowTokens?: number;
  /**
   * OPTIONAL declared model family behind the OpenAI-compatible gateway
   * (`"anthropic"` | `"openai"` | `"generic"`, default `"generic"`). This is an
   * explicit operator declaration, NOT inferred from the model-id string (which
   * is brittle). The transport stays `@ai-sdk/openai-compatible`
   * (`/chat/completions`) for every family; the family is only a SEAM so
   * downstream code can branch later.
   *
   * Native Anthropic features (adaptive thinking, prompt-caching headers,
   * `refusal` handling) are NOT available on the chat-completions path itself.
   * They require either a native Anthropic provider or a gateway that forwards
   * `anthropic-beta` / `cache-control` — a GATEWAY capability, not something the
   * chat-completions shape exposes. Setting this to `"anthropic"` records the
   * intent; it does not enable those features on its own.
   */
  modelFamily?: AiModelFamily;
  /**
   * OPTIONAL: turn OFF the cheap topical pre-classifier round-trip (default
   * OFF-the-toggle, i.e. the classifier RUNS by default). The chat system prompt
   * ALREADY instructs the model to decline off-topic requests, so on a capable
   * model the extra per-first-message classifier call is redundant latency and
   * cost. Set this `true` on a deployment that trusts the in-prompt decline to
   * skip the round-trip. Leave blank/false to keep the belt-and-suspenders
   * pre-classifier (the safe default for smaller/local models).
   */
  disableTopicalClassifier?: boolean;
}

/**
 * Declared model family behind an OpenAI-compatible gateway. A seam for
 * future family-specific steering (caching breakpoints, lighter prompt
 * wording); the transport is identical for every value today.
 */
export type AiModelFamily = "anthropic" | "openai" | "generic";

/** Allowed `modelFamily` values, shared by the zod schema and any branching. */
export const AI_MODEL_FAMILIES = ["anthropic", "openai", "generic"] as const;

/** Default family when a connection does not declare one. */
export const DEFAULT_AI_MODEL_FAMILY: AiModelFamily = "generic";

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
