import { and, eq, gte, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { AiSpendCap } from "@checkstack/ai-common";
import * as schema from "../schema";
import type { AuditPrincipal } from "../propose-apply/store";

type AiDatabase = SafeDatabase<typeof schema>;

/**
 * Per-integration LLM SPEND CAP (Phase 6, the locked-off knob, now wired).
 *
 * A shared-Postgres ROLLING-WINDOW SUM over `ai_spend`: the spend is the total
 * number of tokens this principal has incurred against THIS integration in the
 * trailing window. Because the sum is read from the SAME shared table that every
 * pod writes to, the cap holds across ALL pods (state-and-scale §14.5) — an
 * in-memory per-pod token counter would let N pods each allow the cap = N x the
 * intended spend, which a single-process test can never catch. Mirrors the
 * per-principal tool rate-limit budget exactly, reusing the
 * `ai_spend_integration_principal_created_idx` index.
 *
 * Token-count (not USD) is deliberate: deterministic + provider-agnostic. Every
 * OpenAI-compatible provider reports tokens via the AI SDK `usage`; only some
 * publish a price table (self-hosted Ollama/vLLM have none), so a USD cap would
 * require a per-model pricing table that drifts and is meaningless for local
 * models. Tokens are the one unit every provider reports.
 *
 * The cap is OFF by default: enforcement only runs when a connection configures
 * `spendCap`. With no cap configured, `enforceSpendCap` is a no-op.
 */

export interface SpendUsageInput {
  inputTokens: number;
  outputTokens: number;
}

export interface SpendCheckResult {
  /** Total tokens already used by this principal+integration in the window. */
  used: number;
  /** Whether a NEW turn is within budget (`used < tokenBudget`). */
  allowed: boolean;
  /** The configured token budget (the cap). */
  tokenBudget: number;
  /** Trailing window start the sum was taken against. */
  windowStart: Date;
}

/**
 * Sum the principal's token usage against an integration over the cap's trailing
 * window and decide whether a new turn is within budget. Returns
 * `allowed: false` once `used >= tokenBudget`.
 */
export async function checkSpendCap({
  db,
  integrationId,
  principal,
  cap,
  now = new Date(),
}: {
  db: AiDatabase;
  integrationId: string;
  principal: AuditPrincipal;
  cap: AiSpendCap;
  now?: Date;
}): Promise<SpendCheckResult> {
  const windowStart = new Date(now.getTime() - cap.windowMinutes * 60_000);

  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.aiSpend.totalTokens}), 0)`,
    })
    .from(schema.aiSpend)
    .where(
      and(
        eq(schema.aiSpend.integrationId, integrationId),
        eq(schema.aiSpend.principalKind, principal.kind),
        eq(schema.aiSpend.principalId, principal.id),
        gte(schema.aiSpend.createdAt, windowStart),
      ),
    );

  // `sum` over an integer column comes back as a numeric string from pg; coerce.
  const used = Number(rows[0]?.total ?? 0);
  return {
    used,
    allowed: used < cap.tokenBudget,
    tokenBudget: cap.tokenBudget,
    windowStart,
  };
}

/** Error thrown when a principal is over an integration's LLM spend cap. */
export class SpendCapExceededError extends Error {
  constructor(
    public readonly used: number,
    public readonly tokenBudget: number,
  ) {
    super(
      `LLM spend/budget exceeded: ${used} tokens used against this integration in the current window (cap ${tokenBudget}). Try again later or raise the integration's spend cap.`,
    );
    this.name = "SpendCapExceededError";
  }
}

/**
 * Enforce the cap BEFORE a chat turn: throws {@link SpendCapExceededError} when
 * the principal is over the integration's configured budget. A no-op when no
 * `cap` is configured (default OFF — no cap unless set on the connection).
 */
export async function enforceSpendCap({
  db,
  integrationId,
  principal,
  cap,
  now,
}: {
  db: AiDatabase;
  integrationId: string;
  principal: AuditPrincipal;
  cap?: AiSpendCap;
  now?: Date;
}): Promise<void> {
  if (!cap) return; // default OFF: no cap unless configured.
  const result = await checkSpendCap({ db, integrationId, principal, cap, now });
  if (!result.allowed) {
    throw new SpendCapExceededError(result.used, result.tokenBudget);
  }
}

/**
 * Record one turn's token usage into the shared `ai_spend` ledger (append-only).
 * Called from the agent loop's `onFinish` with the AI-SDK `totalUsage`. Negative
 * / undefined token counts coerce to 0 so a provider that omits usage never
 * corrupts the ledger.
 */
export async function recordSpend({
  db,
  integrationId,
  principal,
  conversationId,
  model,
  usage,
}: {
  db: AiDatabase;
  integrationId: string;
  principal: AuditPrincipal;
  conversationId?: string;
  model?: string;
  usage: SpendUsageInput;
}): Promise<void> {
  const inputTokens = Math.max(0, Math.trunc(usage.inputTokens || 0));
  const outputTokens = Math.max(0, Math.trunc(usage.outputTokens || 0));
  await db.insert(schema.aiSpend).values({
    integrationId,
    principalKind: principal.kind,
    principalId: principal.id,
    conversationId,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  });
}
