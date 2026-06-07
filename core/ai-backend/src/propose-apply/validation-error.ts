/**
 * The error a proposable tool's `dryRun` throws when the MODEL's drafted input
 * fails semantic validation (e.g. a fabricated `runAs`, an unknown
 * `connectionId`, an unwired artifact reference).
 *
 * This is distinct from {@link ProposeApplyError} (transport/authz/lifecycle
 * faults): a `ToolValidationError` is FEEDBACK the model can act on, not an
 * exceptional fault. The chat agent loop catches it and returns the structured
 * `issues` to the model as the tool result so it can self-correct and re-propose
 * - instead of the issues leaking to the operator as a raw "the assistant hit an
 * error" message and the proposal being lost.
 *
 * Lives in `ai-backend` (not the tool's own package) so every proposable tool -
 * in any plugin that depends on `@checkstack/ai-backend` - throws the SAME type
 * and the loop's catch is plugin-agnostic.
 */
export interface ToolValidationIssue {
  /** Dot-joinable location of the problem, e.g. `["actions", 0, "config"]`. */
  path: Array<string | number>;
  /** Human/model-facing description of what is wrong and how to fix it. */
  message: string;
}

export class ToolValidationError extends Error {
  readonly issues: ToolValidationIssue[];

  constructor(message: string, issues: ToolValidationIssue[]) {
    super(message);
    this.name = "ToolValidationError";
    this.issues = issues;
  }
}
