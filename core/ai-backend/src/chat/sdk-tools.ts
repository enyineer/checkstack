import { tool as aiTool, type Tool } from "ai";
import type { AuthUser } from "@checkstack/backend-api";
import type { AiPermissionMode, AiFieldDiff } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "../tool-registry";
import { decideToolDisposition } from "./permission-mode.logic";
import {
  buildAgentToolInputSchema,
  schemaContainsDate,
} from "./tool-input-schema";

/**
 * Result a mutate/destructive tool's `execute` returns to the model in APPROVE
 * mode (and for ALL destructive tools): it does NOT commit. It runs the propose
 * dry-run and returns a CONFIRM CARD the human must approve via `applyTool`. The
 * model can never silently mutate.
 */
export interface ConfirmCardResult {
  __confirm: true;
  toolName: string;
  effect: "mutate" | "destructive";
  summary: string;
  /** Opaque single-use proposal token consumed by `applyTool`. */
  token: string;
  /** Validated, ready-to-apply payload rendered on the card. */
  payload: unknown;
  /** Optional before -> after diff for an update, rendered on the card. */
  diff?: AiFieldDiff[];
  expiresAt: string;
  /**
   * MODEL-FACING guidance (ignored by the UI): tells the agent the proposal was
   * created and shown, so it STOPS instead of re-proposing the same change. The
   * dispatcher saw the model fire the same propose three times in a row.
   */
  note: string;
}

/**
 * Returned to the model when it proposes/auto-applies the SAME tool with the
 * SAME arguments again within ONE turn. Carries no `__confirm`/`__applied`, so
 * the UI renders NO extra card; the model just gets a clear "already handled,
 * stop" signal. Guards against the model spamming duplicate proposals/tokens
 * because it thought the first call did not go through.
 */
export interface DuplicateToolCallResult {
  __duplicate: true;
  toolName: string;
  note: string;
}

/**
 * Result a `mutate` tool's `execute` returns to the model in AUTO mode: the
 * proposal was applied SERVER-SIDE immediately (no human click), under the SAME
 * `isAllowed` re-check + audit row the human `applyTool` path uses. Surfaced to
 * the model so it knows the change took effect. ONLY `mutate` tools reach this
 * (destructive tools always return a `ConfirmCardResult`).
 */
export interface AutoAppliedResult {
  __applied: true;
  toolName: string;
  effect: "mutate";
  summary: string;
  /** The audit row id the apply produced. */
  toolCallId: string;
  /** The tool's `execute` result (e.g. the created automation). */
  result: unknown;
  /** Optional before -> after diff for an update, shown on the applied card. */
  diff?: AiFieldDiff[];
  /** MODEL-FACING guidance (ignored by the UI); see {@link ConfirmCardResult.note}. */
  note: string;
}

/** Callbacks the SDK tool executors delegate to (kept injectable for testing). */
export interface AgentToolCallbacks {
  /** Enforce the per-principal tool budget; throws when over budget. */
  enforceBudget(principal: AuthUser): Promise<void>;
  /** Run a read tool (re-checks authz, records audit). Returns the result. */
  runRead(args: {
    principal: AuthUser;
    tool: RegisteredAiTool;
    input: unknown;
  }): Promise<unknown>;
  /**
   * Propose a mutate/destructive tool; returns a confirm card (no commit), or a
   * {@link DuplicateToolCallResult} if the SAME tool+args was already proposed
   * this turn (so the model cannot spam duplicate cards/tokens).
   */
  propose(args: {
    principal: AuthUser;
    tool: RegisteredAiTool;
    input: unknown;
  }): Promise<ConfirmCardResult | DuplicateToolCallResult>;
  /**
   * AUTO-mode-only: propose AND apply a `mutate` tool SERVER-SIDE in one shot.
   * Runs through the SAME propose/apply service (same `isAllowed` re-check, same
   * `ai_tool_calls` audit rows) the human `applyTool` path uses - never a weaker
   * path. Reached ONLY for `mutate` tools; destructive tools never call this.
   */
  autoApply(args: {
    principal: AuthUser;
    tool: RegisteredAiTool;
    input: unknown;
  }): Promise<AutoAppliedResult | DuplicateToolCallResult>;
}

/**
 * Convert resolver-allowed Checkstack tools into Vercel-AI-SDK `tool()` defs for
 * the agent loop. The disposition is baked into each tool's `execute` by the
 * pure `decideToolDisposition` 3-tier model (Phase 4):
 *
 *  - `read` tools ALWAYS auto-run via `runRead`, in BOTH modes (handler authz
 *    re-checks on execute). The mode never gates reads.
 *  - `mutate` tools INHERIT the conversation's permission mode: in AUTO they
 *    auto-apply SERVER-SIDE via `autoApply` (no human click); in APPROVE they
 *    `propose` and return a CONFIRM CARD the human approves via `applyTool`.
 *  - `destructive` tools ALWAYS `propose` and return a CONFIRM CARD, in BOTH
 *    modes - the mode is NEVER consulted, so a destructive tool can never
 *    auto-apply (the security invariant).
 *
 * Only tools the resolver already allowed for the principal are passed in, so
 * the model is never even offered a forbidden tool; the budget + per-call authz
 * re-check inside the executors (and inside propose/apply) are the server-side
 * authority regardless.
 */
export function buildAgentSdkTools({
  tools,
  principal,
  mode,
  callbacks,
}: {
  tools: RegisteredAiTool[];
  principal: AuthUser;
  /** The conversation's permission mode. Governs the `mutate` branch only. */
  mode: AiPermissionMode;
  callbacks: AgentToolCallbacks;
}): Record<string, Tool> {
  const sdkTools: Record<string, Tool> = {};

  for (const t of tools) {
    const disposition = decideToolDisposition({ effect: t.effect, mode });

    // A raw `z.date()` / `z.coerce.date()` in the input would make the SDK's
    // Zod->JSON-Schema conversion throw ("Date cannot be represented..."),
    // crashing the turn. For date-bearing inputs hand the SDK a date-safe
    // schema + a coercing validator; everything else stays on the native path.
    const inputSchema = schemaContainsDate(t.input)
      ? buildAgentToolInputSchema(t.input)
      : t.input;

    if (disposition === "auto-run") {
      sdkTools[t.name] = aiTool({
        description: t.description,
        inputSchema,
        execute: async (input: unknown) => {
          await callbacks.enforceBudget(principal);
          return callbacks.runRead({ principal, tool: t, input });
        },
      });
      continue;
    }

    if (disposition === "auto-apply") {
      // AUTO mode + mutate: apply immediately server-side. Same propose/apply
      // service (same authz re-check + audit) as a human apply - never weaker.
      sdkTools[t.name] = aiTool({
        description: `${t.description} (auto-applied immediately in this conversation's auto mode)`,
        inputSchema: t.input,
        execute: async (
          input: unknown,
        ): Promise<AutoAppliedResult | DuplicateToolCallResult> => {
          await callbacks.enforceBudget(principal);
          return callbacks.autoApply({ principal, tool: t, input });
        },
      });
      continue;
    }

    // disposition === "propose": mutate-in-APPROVE or ANY destructive tool. The
    // returned confirm card is what the chat UI renders; nothing is committed
    // until the human applies.
    sdkTools[t.name] = aiTool({
      description: `${t.description} (requires human confirmation before it takes effect)`,
      inputSchema: t.input,
      execute: async (
        input: unknown,
      ): Promise<ConfirmCardResult | DuplicateToolCallResult> => {
        await callbacks.enforceBudget(principal);
        return callbacks.propose({ principal, tool: t, input });
      },
    });
  }

  return sdkTools;
}
