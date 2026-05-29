import React from "react";
import {
  usePluginClient,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  resolveVariableScope,
  type ActionInfo,
  type ActionPath,
  type ArtifactTypeInfo,
  type AutomationDefinition,
  type TriggerInfo,
  type VariableEntry,
} from "@checkstack/automation-common";
import type {
  ShellEnvVar,
  TemplateCompletionProvider,
  TemplateProperty,
  VariableNode,
} from "@checkstack/ui";
import {
  TEMPLATE_FILTERS,
  fieldsToShellEnvVars,
  flattenScopeToFields,
} from "./template-helpers";
import { createTemplateCompletionProvider } from "./template-completion";
import { generateAutomationContextTypes } from "../script-context";

/**
 * Registry context — loads the trigger / action / artifact-type catalog
 * once, exposes it via hooks, and provides a `useVariableScope(path)`
 * shortcut so every template field in the visual editor can get the
 * right `templateProperties` without re-running the scope resolver
 * by hand. The scope hook also returns the hierarchical
 * `VariableNode[]` tree used by `VariablePicker`.
 *
 * Loaded eagerly because: (a) the catalog is small (dozens of items
 * total), (b) every action card in the visual editor needs to look up
 * its own action info to render the right config form, (c) the scope
 * resolver needs the action catalog to compute upstream artifact
 * entries.
 */
interface RegistryContextValue {
  triggers: TriggerInfo[];
  actions: ActionInfo[];
  artifactTypes: ArtifactTypeInfo[];
  /** True until all three queries have resolved. */
  loading: boolean;
}

const RegistryContext = React.createContext<RegistryContextValue | null>(null);

export const AutomationRegistryProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const client = usePluginClient(AutomationApi);
  const triggers = client.listTriggers.useQuery();
  const actions = client.listActions.useQuery();
  const artifactTypes = client.listArtifactTypes.useQuery();

  const value = React.useMemo<RegistryContextValue>(
    () => ({
      triggers: triggers.data?.items ?? [],
      actions: actions.data?.items ?? [],
      artifactTypes: artifactTypes.data?.items ?? [],
      loading:
        triggers.isLoading || actions.isLoading || artifactTypes.isLoading,
    }),
    [triggers, actions, artifactTypes],
  );

  return (
    <RegistryContext.Provider value={value}>
      {children}
    </RegistryContext.Provider>
  );
};

export function useAutomationRegistry(): RegistryContextValue {
  const ctx = React.useContext(RegistryContext);
  if (!ctx) {
    throw new Error(
      "useAutomationRegistry must be used inside <AutomationRegistryProvider>",
    );
  }
  return ctx;
}

/**
 * Resolve the variable scope at a specific action path inside the given
 * automation definition. Returned in both formats the editor needs:
 *
 *   - `templateProperties` for `TemplateValueInput`'s `{{` autocomplete.
 *   - `variableNodes` for `VariablePicker`'s hierarchical tree.
 *
 * Re-runs whenever the definition or path changes — small enough that
 * memoising is a clarity win, not a perf necessity.
 */
export function useVariableScope(args: {
  definition: AutomationDefinition;
  path: ActionPath;
}): {
  /**
   * Flat field list for the legacy `templateProperties` shorthand —
   * consumed by `DynamicForm` config fields that only need simple
   * `{{ path }}` insertion.
   */
  templateProperties: TemplateProperty[];
  /** Hierarchical tree for the explicit "fx" `VariablePicker`. */
  variableNodes: VariableNode[];
  /**
   * Staged completion provider for `{{ … }}` template fields (filter
   * templates, delay templates, …). Fields → comparators/filters →
   * enum values.
   */
  templateCompletion: TemplateCompletionProvider;
  /**
   * Staged completion provider for bare expression fields (conditions /
   * `choose: when` clauses) — same staging, no `{{ }}` wrapper.
   */
  expressionCompletion: TemplateCompletionProvider;
  /**
   * Monaco `addExtraLib` declarations for inline-script action editors
   * (`Run Script (TypeScript)`). Types `context.trigger.payload` as a
   * discriminated union over the automation's subscribed triggers, plus
   * `context.artifacts` / `context.var` / `context.repeat` in scope at
   * this action position — so the script editor autocompletes the real
   * runtime context instead of falling back to an untyped default.
   */
  typeDefinitions: string;
  /**
   * `$CHECKSTACK_*` env var names a shell script action receives, for the
   * shell editor's `$` autocomplete. Mirrors what the backend injects at
   * run time (shell scripts read context from env vars, not `{{ }}`).
   */
  shellEnvVars: ShellEnvVar[];
} {
  const { triggers, actions, artifactTypes } = useAutomationRegistry();
  return React.useMemo(() => {
    const scope = resolveVariableScope({
      definition: args.definition,
      triggers,
      actions,
      artifactTypes,
      path: args.path,
    });
    const fields = flattenScopeToFields(scope);
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: args.definition,
      triggers,
      actions: actions.map((a) => ({
        qualifiedId: a.qualifiedId,
        produces: a.produces,
      })),
      artifactTypes,
      path: args.path,
    });
    return {
      templateProperties: fields.map((f) => ({
        path: f.path,
        type: f.type,
        description: f.description,
        enumValues: f.enumValues,
      })),
      variableNodes: scope.entries.map((child) => toNode(child)),
      templateCompletion: createTemplateCompletionProvider({
        fields,
        filters: [...TEMPLATE_FILTERS],
        mode: "template",
      }),
      expressionCompletion: createTemplateCompletionProvider({
        fields,
        filters: [...TEMPLATE_FILTERS],
        mode: "expression",
      }),
      typeDefinitions,
      shellEnvVars: fieldsToShellEnvVars(fields),
    };
  }, [args.definition, args.path, triggers, actions, artifactTypes]);
}

function toNode(entry: VariableEntry): VariableNode {
  return {
    path: entry.path,
    type: entry.type,
    description: entry.description,
    children: entry.children?.map((child) => toNode(child)),
    conditionalOnTriggers: entry.conditionalOnTriggers,
  };
}
