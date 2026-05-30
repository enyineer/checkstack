import type { Action } from "@checkstack/automation-common";

/**
 * The action primitive discriminator kinds. Mirrors the keys in the
 * Home-Assistant-style schema (`action`, `choose`, `parallel`, …).
 *
 * `sequence` is included so a list of actions can be wrapped as a single
 * Action — primarily to support multi-action branches inside `parallel`.
 */
export type ActionKind =
  | "action"
  | "choose"
  | "parallel"
  | "delay"
  | "repeat"
  | "variables"
  | "condition"
  | "stop"
  | "wait_for_trigger"
  | "wait_until"
  | "sequence";

/**
 * Decide which primitive an action is by inspecting which discriminator
 * key it carries. The zod schema guarantees exactly one key is present
 * across the union — this function relies on that contract.
 */
export function detectActionKind(action: Action): ActionKind {
  const a = action as Record<string, unknown>;
  if ("action" in a) return "action";
  if ("choose" in a) return "choose";
  if ("parallel" in a) return "parallel";
  if ("delay" in a) return "delay";
  if ("repeat" in a) return "repeat";
  if ("variables" in a) return "variables";
  if ("condition" in a) return "condition";
  if ("stop" in a) return "stop";
  if ("wait_for_trigger" in a) return "wait_for_trigger";
  if ("wait_until" in a) return "wait_until";
  if ("sequence" in a) return "sequence";
  throw new Error(
    `Unknown action shape — none of the discriminator keys are present: ${JSON.stringify(
      Object.keys(a),
    )}`,
  );
}
