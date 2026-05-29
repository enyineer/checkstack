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

export interface AutomationDefinitionEditorProps {
  value: AutomationDefinition;
  onChange: (next: AutomationDefinition) => void;
  disabled?: boolean;
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
  <AutomationRegistryProvider>
    <AutomationDefinitionProvider definition={props.value}>
      <EditorBody {...props} />
    </AutomationDefinitionProvider>
  </AutomationRegistryProvider>
);

const EditorBody: React.FC<AutomationDefinitionEditorProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { loading } = useAutomationRegistry();

  // Scope at the root path = `trigger.*` only. The conditions editor
  // uses `variableNodes` for the explicit "fx" tree and
  // `expressionCompletion` for the staged inline autocomplete (bare
  // expression mode — pre-run conditions aren't `{{ }}`-wrapped).
  const { variableNodes, expressionCompletion } = useVariableScope({
    definition: value,
    path: [{ slot: "root", index: 0 }],
  });

  return (
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
  );
};
