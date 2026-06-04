/**
 * Pure helpers for the post-confirm-card "decision acknowledgment" turn.
 *
 * When the operator applies or declines a confirm card, the actual apply runs
 * through the unchanged `applyTool` propose/apply path. This turn is purely the
 * MODEL's reaction: it is told the operator's decision and streams a short
 * acknowledgment so the conversation does not dead-end on "waiting for your
 * confirmation". The note is built SERVER-SIDE from the stored proposal (tool
 * name + the summary captured at propose time) - no client-supplied text ever
 * reaches the model - and is EPHEMERAL: it is appended to the model-call history
 * for this turn only, never persisted. The assistant's reply carries the
 * outcome forward into the persisted transcript.
 */

/** A human decision on a proposed mutate/destructive tool's confirm card. */
export type DecisionKind = "apply" | "decline";

/**
 * Build the ephemeral note that informs the model of the operator's decision.
 * `summary` is the proposal's stored one-line summary (e.g. "Create health
 * check ..."); when absent we fall back to the tool name so the note is still
 * meaningful.
 */
export function buildDecisionNote({
  decision,
  toolName,
  summary,
}: {
  decision: DecisionKind;
  toolName: string;
  summary?: string;
}): string {
  const what =
    summary && summary.trim().length > 0
      ? summary.trim()
      : `the proposed "${toolName}" action`;

  if (decision === "apply") {
    return [
      "[system note] The operator APPROVED your previous proposal and it has",
      "been APPLIED successfully and is now live:",
      `${what}.`,
      "Confirm to the operator in one or two short sentences what is now in",
      "effect, then suggest a sensible next step. Do NOT propose it again.",
    ].join(" ");
  }

  return [
    "[system note] The operator DECLINED your previous proposal",
    `(${what}). Nothing was changed.`,
    "Acknowledge briefly and ask what they would like to adjust.",
    "Do NOT re-propose it unless the operator asks.",
  ].join(" ");
}
