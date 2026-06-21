import { tool as aiTool, type Tool } from "ai";
import type { AuthUser } from "@checkstack/backend-api";
import type { AiPermissionMode, AiFieldDiff } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "../tool-registry";
import type { ToolValidationIssue } from "../propose-apply/validation-error";
import { decideToolDisposition } from "./permission-mode.logic";
import { toModelSchema } from "./model-schema";

/**
 * Result a mutate/destructive tool's `execute` returns to the model in APPROVE
 * mode (and for ALL destructive tools): it does NOT commit. It runs the propose
 * dry-run and returns a CONFIRM CARD the human must approve via `applyTool`. The
 * model can never silently mutate.
 *
 * This is a SUCCESS result (the proposal genuinely succeeded), so it is returned
 * as a value, not thrown. The `status: "awaiting_operator"` field is the
 * STRUCTURED signal the model keys on (instead of parsing the prose `note`): the
 * proposal landed and is now blocked on a human decision, so the model must stop
 * rather than re-propose. See {@link ToolFeedbackError} for the FAILURE channel.
 */
export interface ConfirmCardResult {
  __confirm: true;
  /**
   * Structured "proposal succeeded, now blocked on the operator" marker. The
   * model branches on this rather than reading the `note` prose, so a model that
   * skims the result still learns it must stop and wait.
   */
  status: "awaiting_operator";
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
 * Structured payload carried on a {@link ToolFeedbackError} so the failure
 * surfaces with a machine-readable shape (not just prose) when the AI SDK
 * renders the thrown error as a tool-error result part. `kind` distinguishes the
 * two self-correction cases; `issues` is present only for a validation failure.
 */
export interface ToolFeedbackPayload {
  kind: "validation_failed" | "duplicate_call";
  toolName: string;
  issues?: ToolValidationIssue[];
}

/**
 * Thrown from a tool's `execute` to signal a RECOVERABLE FAILURE the model must
 * self-correct (a semantic-validation failure or a duplicate call in one turn).
 *
 * Why throw instead of returning a value: the platform reaches every model
 * through an OpenAI-compatible gateway, where a returned object and a thrown
 * error look identical UNLESS the error channel is used. The AI SDK renders a
 * thrown `execute` error as a distinct `tool-error` result part (not a normal
 * success `tool` message), so the model is told the call FAILED and must retry,
 * instead of treating `{ __validationFailed: true, ... }` as "it worked". The
 * structured {@link ToolFeedbackPayload} travels in `feedback` and the
 * model-facing guidance is the error `message` (belt and suspenders: both the
 * error signal AND the prose).
 */
export class ToolFeedbackError extends Error {
  readonly feedback: ToolFeedbackPayload;
  constructor(message: string, feedback: ToolFeedbackPayload) {
    super(message);
    this.name = "ToolFeedbackError";
    this.feedback = feedback;
  }
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
 * Returned to the model when its drafted input fails the tool's `dryRun`
 * semantic validation (a {@link ToolValidationError} - e.g. a fabricated
 * `runAs`, an unknown `connectionId`, an unwired artifact reference). Carries no
 * `__confirm`/`__applied`, so the UI renders NO card; the model gets the
 * structured `issues` and is told to fix them and call the tool again.
 *
 * This closes the feedback loop: validation issues are computed specifically so
 * the model can self-correct, so they must reach the MODEL as a tool result -
 * not leak to the operator as a raw stream error with the proposal lost.
 */
export interface ValidationFeedbackResult {
  __validationFailed: true;
  toolName: string;
  issues: ToolValidationIssue[];
  /** MODEL-FACING guidance: fix each issue and retry; do not claim success. */
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
  }): Promise<
    ConfirmCardResult | DuplicateToolCallResult | ValidationFeedbackResult
  >;
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
  }): Promise<
    AutoAppliedResult | DuplicateToolCallResult | ValidationFeedbackResult
  >;
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

    // Single model-boundary date handling (see toModelSchema): a raw z.date() /
    // z.coerce.date() input would otherwise make the SDK's Zod->JSON-Schema
    // conversion throw "Date cannot be represented...", crashing the turn.
    const inputSchema = toModelSchema(t.input);

    // Disposition decides ONLY which callback runs; the tool is constructed in
    // ONE place below so the schema/budget wiring can never drift between
    // branches (the bug this consolidation removes).
    //
    // The description is left STABLE across permission modes on purpose: the
    // conversation's mode is conveyed ONCE, by the system prompt's
    // `permissionModeInstruction` line, not by mutating each tool's
    // description. Appending a per-mode note (" (auto-applied...)" /
    // " (requires human confirmation...)") would couple tool identity to
    // conversation state and invalidate any tool-block prompt cache on a mode
    // toggle, for a signal the prompt already carries.
    const run: (input: unknown) => Promise<unknown> =
      disposition === "auto-run"
        ? (input) => callbacks.runRead({ principal, tool: t, input })
        : disposition === "auto-apply"
          ? // AUTO mode + mutate: apply immediately server-side under the SAME
            // propose/apply service (authz re-check + audit) as a human apply.
            (input) => callbacks.autoApply({ principal, tool: t, input })
          : // propose: mutate-in-APPROVE or ANY destructive tool. Returns a
            // confirm card; nothing commits until the human applies.
            (input) => callbacks.propose({ principal, tool: t, input });

    sdkTools[t.name] = aiTool({
      description: t.description,
      inputSchema,
      execute: async (input: unknown) => {
        await callbacks.enforceBudget(principal);
        const result = await run(input);
        // SELF-CORRECTION CHANNEL: a validation failure or a duplicate call is a
        // FAILED tool call, so surface it as a thrown error (which the AI SDK
        // renders as a distinct `tool-error` result part) rather than a normal
        // success value. Without this, success and failure are isomorphic JSON
        // and the model frequently treats "validation failed" as "it worked".
        // A confirm card / auto-applied result is a SUCCESS and passes through.
        throwIfFeedbackFailure(result);
        return result;
      },
    });
  }

  return sdkTools;
}

/** Type guard: a value is a {@link ValidationFeedbackResult}. */
function isValidationFeedback(
  value: unknown,
): value is ValidationFeedbackResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "__validationFailed" in value &&
    (value as { __validationFailed?: unknown }).__validationFailed === true
  );
}

/** Type guard: a value is a {@link DuplicateToolCallResult}. */
function isDuplicateCall(value: unknown): value is DuplicateToolCallResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "__duplicate" in value &&
    (value as { __duplicate?: unknown }).__duplicate === true
  );
}

/**
 * If `result` is a self-correction FAILURE (validation or duplicate), throw a
 * {@link ToolFeedbackError} so the AI SDK renders it as a `tool-error` part. A
 * confirm card / auto-applied / read result is a success and returns silently.
 */
function throwIfFeedbackFailure(result: unknown): void {
  if (isValidationFeedback(result)) {
    throw new ToolFeedbackError(result.note, {
      kind: "validation_failed",
      toolName: result.toolName,
      issues: result.issues,
    });
  }
  if (isDuplicateCall(result)) {
    throw new ToolFeedbackError(result.note, {
      kind: "duplicate_call",
      toolName: result.toolName,
    });
  }
}
