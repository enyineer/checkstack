/**
 * Agent step-budget guard, shared by the chat loop and the headless runner.
 *
 * Both loops cap tool-call rounds with `stopWhen: stepCountIs(MAX_STEPS)`. If
 * the model spends the LAST allowed step on a tool call (e.g. it keeps searching
 * the docs without converging), the loop terminates on a tool step and NO final
 * text is ever generated - the operator gets a blank reply / the AI action gets
 * an empty summary. This is especially acute with REASONING models (e.g.
 * DeepSeek-R1 style), which pour their work into the hidden `reasoning` channel
 * and tool calls and will keep "thinking about searching" forever unless told to
 * stop and answer.
 *
 * On the final allowed step we therefore (1) REMOVE all tools via
 * `activeTools: []`, and (2) override the step system prompt to explicitly tell
 * the model its tool budget is spent and it must write its final answer NOW from
 * what it has gathered. Together these guarantee a non-empty, useful turn.
 *
 * IMPORTANT: this uses `activeTools: []` (tools removed from the request), NOT
 * `toolChoice: "none"` (tools present but forbidden). With some OpenAI-compatible
 * models (e.g. DeepSeek) `toolChoice: "none"` makes the model emit its raw
 * tool-call markup as the answer text; removing the tools entirely avoids that
 * path. `activeTools: []` ALONE is still not enough for a reasoning model - the
 * system instruction is what makes it actually emit a final answer.
 */

/**
 * Final-step instruction: the model can no longer call tools, so it must answer
 * from what it already gathered. Kept deliberately tool/domain-agnostic so it is
 * safe for both the chat assistant and the headless AI action.
 */
export const FINAL_ANSWER_SYSTEM =
  "You can no longer call any tools. Using ONLY the information already gathered " +
  "in this conversation, write your final answer to the user's question NOW. Be " +
  "concise. If what you gathered does not clearly answer the question (for " +
  "example the docs do not cover it), say so plainly and state what is and is " +
  "not known - do not guess and do not ask to search again.";

export function prepareFinalAnswerStep({
  stepNumber,
  maxSteps,
}: {
  /** Zero-based index of the step about to run (AI SDK `prepareStep` arg). */
  stepNumber: number;
  /** The hard step cap (`stepCountIs(maxSteps)`). */
  maxSteps: number;
}): { activeTools: []; system: string } | Record<string, never> {
  // The last permitted step is index `maxSteps - 1`. Guard `>=` so a
  // mis-set/edge value can never let the final step keep calling tools.
  return stepNumber >= maxSteps - 1
    ? { activeTools: [], system: FINAL_ANSWER_SYSTEM }
    : {};
}
