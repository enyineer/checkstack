import type { DefinitionIssue } from "./editor-validation";

/**
 * Where a blocking issue can be "fixed" from. Drives the click affordance in
 * the save-blockers summary: metadata-field targets focus their input, while
 * definition targets reveal the validated definition (visual editor).
 */
export type BlockingIssueTarget =
  | { kind: "field"; field: "name" | "runAs" }
  | { kind: "definition" };

export interface BlockingIssue {
  /** Human-readable, one-line description of what is incomplete. */
  message: string;
  /** Where the user should go to resolve it. */
  target: BlockingIssueTarget;
}

/**
 * Summarize everything currently blocking a save into a flat, ordered list of
 * actionable items. Mirrors the `canSave` predicate in `AutomationEditPage`
 * (name + run-as + definition validation), so the count shown next to the Save
 * button always matches whether Save is enabled.
 *
 * Pure and DOM-free so it can be unit-tested in isolation; the page wires the
 * resulting `target`s to focus/tab navigation.
 */
export function summarizeBlockingIssues({
  nameError,
  runAsError,
  definitionIssues,
}: {
  nameError?: string;
  runAsError?: string;
  definitionIssues: DefinitionIssue[];
}): BlockingIssue[] {
  const blockers: BlockingIssue[] = [];

  if (nameError) {
    blockers.push({ message: nameError, target: { kind: "field", field: "name" } });
  }
  if (runAsError) {
    blockers.push({
      message: runAsError,
      target: { kind: "field", field: "runAs" },
    });
  }

  for (const issue of definitionIssues) {
    blockers.push({
      message: formatDefinitionIssue(issue),
      target: { kind: "definition" },
    });
  }

  return blockers;
}

/**
 * Render a definition validation issue as a single `path: message` line,
 * matching how the visual editor surfaces unattributed issues. A pathless
 * (top-level) issue shows just its message.
 */
function formatDefinitionIssue(issue: DefinitionIssue): string {
  return issue.path.length > 0
    ? `${issue.path.join(".")}: ${issue.message}`
    : issue.message;
}
