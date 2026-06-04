import type { AiToolEffect } from "@checkstack/ai-common";
import type { AiPermissionMode } from "@checkstack/ai-common";

/**
 * The disposition the agent loop bakes into a tool's `execute`, decided purely
 * from the tool's `effect` and the conversation's permission mode. This is the
 * single source of truth for the 3-tier gating model (Phase 4) and is kept
 * DOM-free / dependency-free so it is exhaustively unit-testable.
 *
 *  - `auto-run`    -> run the read directly (read tools, BOTH modes).
 *  - `auto-apply`  -> propose + apply SERVER-SIDE in one shot, no human click
 *                     (mutate tools, `auto` mode ONLY).
 *  - `propose`     -> propose + return a confirm card the human must `applyTool`
 *                     (mutate tools in `approve` mode; ALL destructive tools in
 *                     BOTH modes).
 */
export type ToolDisposition = "auto-run" | "auto-apply" | "propose";

/**
 * Decide a tool's disposition from its effect + the conversation's mode.
 *
 * SECURITY INVARIANT (structurally enforced here): `destructive` ALWAYS returns
 * `propose`, regardless of `mode`. The `mode` parameter is consulted ONLY for
 * the `mutate` branch, so there is no `(effect, mode)` pair that lets a
 * destructive tool reach `auto-apply`. The accompanying tests assert that no
 * mode value changes a destructive tool's `propose` disposition.
 */
export function decideToolDisposition({
  effect,
  mode,
}: {
  effect: AiToolEffect;
  mode: AiPermissionMode;
}): ToolDisposition {
  // Tier 1: reads ALWAYS auto-run, in BOTH modes. Mode never gates reads.
  if (effect === "read") return "auto-run";

  // Tier 3: destructive ALWAYS requires a human apply, in BOTH modes. The mode
  // is NEVER consulted here -> destructive can never auto-apply.
  if (effect === "destructive") return "propose";

  // Tier 2: mutate INHERITS the mode. `auto` auto-applies server-side; `approve`
  // surfaces a confirm card. This is the ONLY branch the mode governs.
  return mode === "auto" ? "auto-apply" : "propose";
}
