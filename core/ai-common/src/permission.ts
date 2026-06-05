import { z } from "zod";

/**
 * Per-conversation permission mode (Phase 4), Claude-Code-style. Governs ONLY
 * the `mutate` tool branch; reads and destructive tools are NEVER governed by it
 * (see the gating tiers below).
 *
 * The three gating tiers, keyed on a tool's `effect`:
 *
 *  - `read` -> ALWAYS auto-runs, in BOTH modes. Reads are never gated.
 *  - `mutate` -> INHERITS the mode. `auto` auto-applies SERVER-SIDE (the model's
 *    `propose` is applied immediately under the SAME `isAllowed` re-check + audit
 *    the human `applyTool` path uses); `approve` surfaces a confirm card the
 *    operator must approve via `applyTool`.
 *  - `destructive` -> ALWAYS requires the human `applyTool`, in BOTH modes. The
 *    mode is NEVER consulted for destructive tools.
 *
 * SECURITY INVARIANT: destructive tools can never auto-apply. The mode has NO
 * parameter into the destructive apply path - it only governs the `mutate`
 * branch.
 */
export const AiPermissionModeSchema = z.enum(["approve", "auto"]);
export type AiPermissionMode = z.infer<typeof AiPermissionModeSchema>;

/** Safe-by-default: a new conversation requires human approval for changes. */
export const DEFAULT_PERMISSION_MODE: AiPermissionMode = "approve";
