import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@checkstack/ui";
import type { AutomationDefinition } from "@checkstack/automation-common";
import {
  AutomationDefinitionProvider,
} from "./AutomationDefinitionContext";
import {
  AutomationRegistryProvider,
  useAutomationRegistry,
  useVariableScope,
} from "./registry-context";
import { TriggersEditor } from "./TriggersEditor";
import { ConditionsEditor } from "./ConditionsEditor";
import { ActionListEditor } from "./ActionListEditor";
import { ValidationProvider, type DefinitionIssue } from "./editor-validation";
import { useScriptDiagnostics } from "./useScriptDiagnostics";
import { collectScriptActions } from "./script-actions";
import { ScriptServicesBooter } from "./ScriptServicesBooter";

export interface AutomationDefinitionEditorProps {
  value: AutomationDefinition;
  onChange: (next: AutomationDefinition) => void;
  disabled?: boolean;
  /**
   * Id of the automation being edited, if it already exists (omitted for
   * a brand-new, unsaved automation). Enables the script-test "Load from
   * run" picker, which lists this automation's prior runs.
   */
  automationId?: string;
  /**
   * Structural validation issues (from the backend `validateDefinition`),
   * merged here with the live, frontend-computed inline-script TYPE issues so
   * both surface through the same per-card badges. Script type-checking lives
   * inside this component because it needs the registry (trigger/action
   * catalog) the `AutomationRegistryProvider` supplies.
   */
  structuralIssues?: DefinitionIssue[];
}

/**
 * Top-level visual editor for an `AutomationDefinition`. Composes the
 * three sections (triggers, pre-run conditions, actions) and threads
 * the live definition through the registry + definition contexts so
 * every nested template field can resolve its scope independently.
 *
 * Pure composition — no internal state. The parent (`AutomationEditPage`)
 * owns the definition and decides when to save.
 */
export const AutomationDefinitionEditor: React.FC<
  AutomationDefinitionEditorProps
> = (props) => (
  <AutomationRegistryProvider automationId={props.automationId}>
    <AutomationDefinitionProvider definition={props.value}>
      <EditorBody {...props} />
    </AutomationDefinitionProvider>
  </AutomationRegistryProvider>
);

const EditorBody: React.FC<AutomationDefinitionEditorProps> = ({
  value,
  onChange,
  disabled,
  structuralIssues = [],
}) => {
  const { loading, actions } = useAutomationRegistry();

  // Live type-check of every inline script action (collapsed cards included),
  // merged with the backend's structural issues so both drive the same
  // per-card badges via `ValidationProvider`.
  const scriptIssues = useScriptDiagnostics({ definition: value });
  const issues = React.useMemo(
    () => [...structuralIssues, ...scriptIssues],
    [structuralIssues, scriptIssues],
  );

  // When the automation already contains inline scripts, boot the editor
  // services up-front (a hidden editor) so those scripts validate the moment
  // the automation opens - not only after a card is expanded.
  const hasScriptActions = React.useMemo(
    () => collectScriptActions({ definition: value, actions }).length > 0,
    [value, actions],
  );

  // Scope at the root path = `trigger.*` only. The conditions editor
  // uses `variableNodes` for the explicit "fx" tree and
  // `expressionCompletion` for the staged inline autocomplete (bare
  // expression mode — pre-run conditions aren't `{{ }}`-wrapped).
  const { variableNodes, expressionCompletion } = useVariableScope({
    definition: value,
    path: [{ slot: "root", index: 0 }],
  });

  return (
    <ValidationProvider issues={issues}>
    {hasScriptActions && <ScriptServicesBooter />}
    <div className="space-y-4">
      {loading && (
        <Card className="border-dashed">
          <CardContent className="p-3">
            <p className="text-xs italic text-muted-foreground">
              Loading registry…
            </p>
          </CardContent>
        </Card>
      )}

      <TriggersEditor
        value={value.triggers}
        onChange={(triggers) => onChange({ ...value, triggers })}
        disabled={disabled}
      />

      <ConditionsEditor
        value={value.conditions}
        onChange={(conditions) => onChange({ ...value, conditions })}
        variableNodes={variableNodes}
        completionProvider={expressionCompletion}
        disabled={disabled}
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-3">
          <ActionListEditor
            value={value.actions}
            onChange={(actions) => onChange({ ...value, actions })}
            parentPath={[]}
            slotForChildren={{ slot: "root" }}
            disabled={disabled}
          />
        </CardContent>
      </Card>
    </div>
    </ValidationProvider>
  );
};
