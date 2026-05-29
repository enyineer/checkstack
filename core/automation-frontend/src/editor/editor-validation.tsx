import React from "react";
import type { ActionPath, ActionPathStep } from "@checkstack/automation-common";

export interface DefinitionIssue {
  path: Array<string | number>;
  message: string;
}

/**
 * Convert an editor `ActionPath` (slot/index segments) into the
 * definition path the validator reports against (e.g.
 * `["actions", 0, "choose", 1, "sequence", 0]`), so a card can find its
 * own issues.
 */
export function actionPathToDefPath(
  path: ActionPath,
): Array<string | number> {
  return path.flatMap((step) => stepToDefSegments(step));
}

function stepToDefSegments(step: ActionPathStep): Array<string | number> {
  switch (step.slot) {
    case "root": {
      return ["actions", step.index];
    }
    case "choose-when": {
      return ["choose", step.whenIndex ?? 0, "sequence", step.index];
    }
    case "choose-else": {
      return ["else", step.index];
    }
    case "parallel": {
      return ["parallel", step.index];
    }
    case "repeat": {
      return ["repeat", "sequence", step.index];
    }
    case "sequence": {
      return ["sequence", step.index];
    }
  }
}

export function defPathKey(path: Array<string | number>): string {
  return path.join("\u0000");
}

/**
 * Parse an issue path into the deepest *action node* that owns it plus
 * the field tail within that action. Walks the action-node grammar
 * (`actions[i]`, then repeating `choose[j].sequence[k]` / `else[k]` /
 * `parallel[k]` / `repeat.sequence[k]` / `sequence[k]`) greedily; the
 * first segment that doesn't continue the grammar starts the field
 * tail. So `actions.0.config.level` → owner `actions.0`, tail
 * `config.level`; `actions.0.choose.0.when` → owner `actions.0`, tail
 * `choose.0.when` (the choose's own condition); a nested provider's
 * config attaches to the nested card.
 *
 * Returns null for non-action issues (triggers / conditions / top-level).
 */
function resolveActionOwner(
  path: Array<string | number>,
): { owner: Array<string | number>; tail: Array<string | number> } | null {
  if (path[0] !== "actions" || typeof path[1] !== "number") return null;
  const owner: Array<string | number> = ["actions", path[1]];
  let i = 2;
  for (;;) {
    const key = path[i];
    if (
      key === "choose" &&
      typeof path[i + 1] === "number" &&
      path[i + 2] === "sequence" &&
      typeof path[i + 3] === "number"
    ) {
      owner.push("choose", path[i + 1]!, "sequence", path[i + 3]!);
      i += 4;
      continue;
    }
    if (key === "else" && typeof path[i + 1] === "number") {
      owner.push("else", path[i + 1]!);
      i += 2;
      continue;
    }
    if (key === "parallel" && typeof path[i + 1] === "number") {
      owner.push("parallel", path[i + 1]!);
      i += 2;
      continue;
    }
    if (
      key === "repeat" &&
      path[i + 1] === "sequence" &&
      typeof path[i + 2] === "number"
    ) {
      owner.push("repeat", "sequence", path[i + 2]!);
      i += 3;
      continue;
    }
    if (key === "sequence" && typeof path[i + 1] === "number") {
      owner.push("sequence", path[i + 1]!);
      i += 2;
      continue;
    }
    break;
  }
  return { owner, tail: path.slice(i) };
}

function formatIssue(tail: Array<string | number>, message: string): string {
  return tail.length > 0 ? `${tail.join(".")}: ${message}` : message;
}

export interface PartitionedIssues {
  /** Keyed by `defPathKey(ownerDefPath)`. */
  actions: Map<string, string[]>;
  /** Keyed by trigger index. */
  triggers: Map<number, string[]>;
  /** Keyed by condition index. */
  conditions: Map<number, string[]>;
  /** Issues not attributable to a specific card (top-level fields). */
  other: string[];
}

/**
 * Group flat validation issues by the editor surface that should
 * display them.
 */
export function partitionIssues(issues: DefinitionIssue[]): PartitionedIssues {
  const actions = new Map<string, string[]>();
  const triggers = new Map<number, string[]>();
  const conditions = new Map<number, string[]>();
  const other: string[] = [];

  const pushTo = <K,>(map: Map<K, string[]>, key: K, value: string): void => {
    const existing = map.get(key) ?? [];
    existing.push(value);
    map.set(key, existing);
  };

  for (const issue of issues) {
    if (issue.path[0] === "triggers" && typeof issue.path[1] === "number") {
      pushTo(triggers, issue.path[1], formatIssue(issue.path.slice(2), issue.message));
      continue;
    }
    if (issue.path[0] === "conditions" && typeof issue.path[1] === "number") {
      pushTo(
        conditions,
        issue.path[1],
        formatIssue(issue.path.slice(2), issue.message),
      );
      continue;
    }
    const owner = resolveActionOwner(issue.path);
    if (owner) {
      pushTo(actions, defPathKey(owner.owner), formatIssue(owner.tail, issue.message));
    } else {
      other.push(formatIssue(issue.path, issue.message));
    }
  }

  return { actions, triggers, conditions, other };
}

// ─── Context ─────────────────────────────────────────────────────────────

const ValidationContext = React.createContext<PartitionedIssues | null>(null);

export const ValidationProvider: React.FC<{
  issues: DefinitionIssue[];
  children: React.ReactNode;
}> = ({ issues, children }) => {
  const partitioned = React.useMemo(() => partitionIssues(issues), [issues]);
  return (
    <ValidationContext.Provider value={partitioned}>
      {children}
    </ValidationContext.Provider>
  );
};

function usePartition(): PartitionedIssues | null {
  return React.useContext(ValidationContext);
}

/** Issues attached to the action at the given editor `ActionPath`. */
export function useActionIssues(path: ActionPath): string[] {
  const partition = usePartition();
  const key = defPathKey(actionPathToDefPath(path));
  return partition?.actions.get(key) ?? [];
}

/** Issues attached to the trigger at the given index. */
export function useTriggerIssues(index: number): string[] {
  const partition = usePartition();
  return partition?.triggers.get(index) ?? [];
}

/** Issues attached to the pre-run condition at the given index. */
export function useConditionIssues(index: number): string[] {
  const partition = usePartition();
  return partition?.conditions.get(index) ?? [];
}
