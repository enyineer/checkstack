import type {
  ActionInfo,
  ActionInput,
  ActionPath,
  ActionPathStep,
  AutomationDefinition,
} from "@checkstack/automation-common";
import type { EditorType } from "@checkstack/common";
import { actionPathToDefPath, defPathKey } from "./editor-validation";
import { secretEnvEnvNames } from "../script-context";

/**
 * A single inline-script action found in a definition, with everything the
 * headless validator + issue mapping need - independent of whether the action's
 * editor card is mounted/expanded. `collectScriptActions` walks the whole
 * action tree (including collapsed and nested actions) so every script is
 * validated, not just the one on screen.
 */
export interface ScriptActionRef {
  /** Stable key (the issue-path joined) used to correlate validator results. */
  id: string;
  /** Editor path to this action - drives `generateAutomationContextTypes`. */
  path: ActionPath;
  /** Definition path of the script field, e.g. `["actions",0,"config","script"]`. */
  issuePath: Array<string | number>;
  /** The script source. */
  source: string;
  language: "typescript" | "javascript";
  /** Declared `secretEnv` var names, for the `process.env.*` augmentation. */
  secretEnvNames: string[];
}

/** Narrow an `unknown` to a plain (non-array) object record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // The lone cast: `typeof === "object"` cannot itself produce the index
    // signature, and re-validating an arbitrary JSON-schema/config record with
    // zod here would be wasteful. Mirrors the same helper in `script-context`.
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Find the script field in an action's config JSON schema by the
 * `x-editor-types` annotation (NOT a hard-coded field name) and report the
 * field key + the TS/JS language it should validate as. Returns undefined for
 * actions with no typescript/javascript editor field (e.g. a shell action, or
 * a non-script provider action).
 */
function scriptFieldOf(
  configSchema: Record<string, unknown>,
): { fieldKey: string; language: "typescript" | "javascript" } | undefined {
  const properties = asRecord(configSchema.properties);
  if (!properties) return undefined;
  for (const [key, prop] of Object.entries(properties)) {
    const editorTypes = asRecord(prop)?.["x-editor-types"];
    if (!Array.isArray(editorTypes)) continue;
    const types = new Set(
      editorTypes.filter((t): t is EditorType => typeof t === "string"),
    );
    if (types.has("typescript")) {
      return { fieldKey: key, language: "typescript" };
    }
    if (types.has("javascript")) {
      return { fieldKey: key, language: "javascript" };
    }
  }
  return undefined;
}

/**
 * Walk an automation definition's whole action tree and return every inline
 * TS/JS script action with a non-empty source. The `actions` registry supplies
 * each action's config schema (so the script field + secretEnv mapping are
 * located by annotation, never by a hard-coded key).
 *
 * The walk mirrors the editor's `ActionPath` slot grammar exactly, so the
 * derived definition paths line up with both the backend validator's issue
 * paths and `useActionIssues` card lookups.
 */
export function collectScriptActions({
  definition,
  actions,
}: {
  definition: AutomationDefinition;
  actions: ActionInfo[];
}): ScriptActionRef[] {
  const infoById = new Map(actions.map((action) => [action.qualifiedId, action]));
  const refs: ScriptActionRef[] = [];

  const visit = (
    list: ActionInput[],
    parentPath: ActionPath,
    slot: ActionPathStep["slot"],
    whenIndex?: number,
  ): void => {
    for (const [index, action] of list.entries()) {
      const step: ActionPathStep =
        whenIndex === undefined ? { slot, index } : { slot, whenIndex, index };
      const path: ActionPath = [...parentPath, step];

      if ("action" in action) {
        const info = infoById.get(action.action);
        const field = info ? scriptFieldOf(info.configSchema) : undefined;
        if (info && field) {
          const config = asRecord(action.config) ?? {};
          const raw = config[field.fieldKey];
          const source = typeof raw === "string" ? raw : "";
          if (source.trim() !== "") {
            const issuePath = [
              ...actionPathToDefPath(path),
              "config",
              field.fieldKey,
            ];
            refs.push({
              id: defPathKey(issuePath),
              path,
              issuePath,
              source,
              language: field.language,
              secretEnvNames: secretEnvEnvNames({
                configSchema: info.configSchema,
                config: action.config,
              }),
            });
          }
        }
      } else if ("choose" in action) {
        for (const [whenIdx, branch] of action.choose.entries()) {
          visit(branch.sequence, path, "choose-when", whenIdx);
        }
        if (action.else) visit(action.else, path, "choose-else");
      } else if ("parallel" in action) {
        visit(action.parallel, path, "parallel");
      } else if ("repeat" in action) {
        visit(action.repeat.sequence, path, "repeat");
      } else if ("sequence" in action) {
        visit(action.sequence, path, "sequence");
      }
    }
  };

  visit(definition.actions, [], "root");
  return refs;
}
