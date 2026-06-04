import { and, count, eq, gte } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "../schema";
import type { AuditPrincipal } from "../propose-apply/store";

type AiDatabase = SafeDatabase<typeof schema>;

/**
 * Per-principal tool RATE-LIMIT BUDGET (plan §14.5, P3 review item 3).
 *
 * A shared-Postgres ROLLING-WINDOW counter over `ai_tool_calls`: the budget is
 * the number of rows this principal has written in the trailing window. Because
 * the count is read from the SAME shared Postgres table that every pod writes
 * to (state-and-scale §14.5), the cap holds across ALL pods — an in-memory
 * per-pod limiter would let N pods each allow the cap, i.e. N x the intended
 * limit, which a single-process test would never catch. This mirrors the P2 DCR
 * rate-limiter pattern, reusing the existing `ai_tool_calls_principal_created_idx`
 * index (`principalKind, principalId, createdAt`).
 *
 * Every tool invocation across BOTH transports (MCP `tools/call` and the chat
 * agent loop) writes an `ai_tool_calls` row, so the count is an accurate budget
 * of the principal's tool activity regardless of effect. The check runs BEFORE
 * the call is executed/recorded; over-budget callers are refused.
 */

/** Default rolling window for the per-principal tool budget (1 minute). */
export const TOOL_BUDGET_WINDOW_MS = 60_000;
/** Default max tool calls per principal per window. */
export const TOOL_BUDGET_MAX_CALLS = 60;

export interface ToolBudgetResult {
  /** Tool calls already recorded for this principal in the current window. */
  used: number;
  /** Whether a NEW call is within budget (`used < max`). */
  allowed: boolean;
  /** Trailing window start the count was taken against. */
  windowStart: Date;
}

/**
 * Read the principal's tool-call count over the trailing window and decide
 * whether a new call is within budget. Returns `allowed: false` when the
 * principal has already met or exceeded `max` in the window. The caller decides
 * the response (a 429 for MCP, a friendly error for chat).
 */
export async function checkToolBudget({
  db,
  principal,
  max = TOOL_BUDGET_MAX_CALLS,
  windowMs = TOOL_BUDGET_WINDOW_MS,
  now = new Date(),
}: {
  db: AiDatabase;
  principal: AuditPrincipal;
  max?: number;
  windowMs?: number;
  now?: Date;
}): Promise<ToolBudgetResult> {
  const windowStart = new Date(now.getTime() - windowMs);

  const rows = await db
    .select({ value: count() })
    .from(schema.aiToolCalls)
    .where(
      and(
        eq(schema.aiToolCalls.principalKind, principal.kind),
        eq(schema.aiToolCalls.principalId, principal.id),
        gte(schema.aiToolCalls.createdAt, windowStart),
      ),
    );

  const used = rows[0]?.value ?? 0;
  return { used, allowed: used < max, windowStart };
}

/** Error thrown / mapped to 429 when a principal is over its tool budget. */
export class ToolBudgetExceededError extends Error {
  constructor(
    public readonly used: number,
    public readonly max: number,
  ) {
    super(
      `Tool rate-limit budget exceeded: ${used} calls in the current window (max ${max}). Try again shortly.`,
    );
    this.name = "ToolBudgetExceededError";
  }
}

/**
 * Enforce the budget: throws {@link ToolBudgetExceededError} when over budget.
 * Convenience wrapper used by both transports so the enforcement is identical.
 */
export async function enforceToolBudget(args: {
  db: AiDatabase;
  principal: AuditPrincipal;
  max?: number;
  windowMs?: number;
  now?: Date;
}): Promise<void> {
  const result = await checkToolBudget(args);
  if (!result.allowed) {
    throw new ToolBudgetExceededError(
      result.used,
      args.max ?? TOOL_BUDGET_MAX_CALLS,
    );
  }
}
