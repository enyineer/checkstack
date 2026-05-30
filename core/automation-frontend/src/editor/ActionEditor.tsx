import React from "react";
import {
  ActionCard,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import type {
  ActionInput,
  ActionPath,
  AutomationDefinition,
  ChooseInput,
  ConditionGuardInput,
  DelayInput,
  ParallelInput,
  ProviderAction,
  RepeatInput,
  SequenceInput,
  StopInput,
  VariablesInput,
  WaitForTriggerInput,
} from "@checkstack/automation-common";
import {
  ACTION_KIND_META,
  ACTION_KINDS,
  actionDisplayName,
  actionKindOf,
  assignDefaultIds,
  collectActionIds,
  defaultActionId,
  makeEmptyAction,
} from "./action-helpers";
import { useAutomationRegistry, useVariableScope } from "./registry-context";
import { useActionIssues } from "./editor-validation";
import {
  ConditionGuardActionBody,
  DelayActionBody,
  ProviderActionBody,
  StopActionBody,
  VariablesActionBody,
  WaitForTriggerActionBody,
} from "./action-leaf-cards";
import {
  ChooseActionBody,
  ParallelActionBody,
  RepeatActionBody,
  SequenceActionBody,
} from "./action-composite-cards";

export interface ActionEditorProps {
  value: ActionInput;
  onChange: (next: ActionInput) => void;
  onDelete: () => void;
  path: ActionPath;
  definition: AutomationDefinition;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  stableId: string;
  disabled?: boolean;
}

/**
 * Dispatch component — given an `ActionInput`, picks the right card
 * body and wraps it in a shared `ActionCard` from `@checkstack/ui` so
 * every action has the same collapsible header, enable toggle, drag
 * handle, and delete button.
 *
 * Re-deriving the kind on every render is fine: the discriminator is
 * structural and cheap to check.
 */
export const ActionEditor: React.FC<ActionEditorProps> = ({
  value,
  onChange,
  onDelete,
  path,
  definition,
  dragHandleProps,
  stableId,
  disabled,
}) => {
  const { actions } = useAutomationRegistry();
  const kind = actionKindOf(value);
  const meta = ACTION_KIND_META[kind];
  const {
    templateProperties,
    variableNodes,
    templateCompletion,
    expressionCompletion,
    typeDefinitions,
    shellEnvVars,
  } = useVariableScope({
    definition,
    path,
  });

  const title = actionDisplayName(value, (qualified) =>
    actions.find((a) => a.qualifiedId === qualified)?.displayName,
  );

  const description =
    value.description ?? (value.id ? `id: ${value.id}` : undefined);

  const enabledValue = value.enabled !== false;
  const issues = useActionIssues(path);

  return (
    <ActionCard
      id={stableId}
      title={title}
      description={description}
      category={meta.label}
      icon={meta.icon}
      enabled={enabledValue}
      onEnabledChange={
        disabled
          ? undefined
          : (next) => onChange({ ...value, enabled: next })
      }
      onDelete={disabled ? undefined : onDelete}
      dragHandleProps={disabled ? undefined : dragHandleProps}
      errors={issues}
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={kind}
            onValueChange={(next) => {
              if (next === kind) return;
              // Swap the action shape entirely — preserve only the
              // top-level metadata (id, description, enabled,
              // continue_on_error) so the operator doesn't lose them
              // when experimenting with kinds.
              const fresh = makeEmptyAction(
                next as (typeof ACTION_KINDS)[number],
              );
              // Assign default ids to any nested starter actions a composite
              // kind primes itself with, deduped against the rest of the
              // automation (excluding this action's own preserved id).
              const taken = collectActionIds(definition.actions);
              if (value.id) taken.delete(value.id);
              const [withIds] = assignDefaultIds([fresh], taken);
              onChange({
                ...withIds!,
                id: value.id ?? withIds!.id,
                description: value.description,
                enabled: value.enabled ?? true,
                continue_on_error: value.continue_on_error ?? false,
              } as ActionInput);
            }}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {ACTION_KIND_META[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <input
              id={`${stableId}-continue`}
              type="checkbox"
              checked={value.continue_on_error === true}
              onChange={(event) =>
                onChange({ ...value, continue_on_error: event.target.checked })
              }
              disabled={disabled}
              className="h-3 w-3"
            />
            <label
              htmlFor={`${stableId}-continue`}
              className="text-xs text-muted-foreground"
            >
              Continue on error
            </label>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Id
            </span>
            <Input
              value={value.id ?? ""}
              onChange={(event) =>
                onChange({ ...value, id: event.target.value || undefined })
              }
              onBlur={() => {
                // Never leave the id blank: re-fill a unique, log-friendly
                // default so the action stays referenceable
                // (artifacts.<id>.<name>) and parseable in run logs.
                if (value.id) return;
                const taken = collectActionIds(definition.actions);
                onChange({ ...value, id: defaultActionId(value, taken) });
              }}
              placeholder="Generated on blur"
              disabled={disabled}
              className="h-8 text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Description
            </span>
            <Input
              value={value.description ?? ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  description: event.target.value || undefined,
                })
              }
              placeholder="Optional note"
              disabled={disabled}
              className="h-8 text-xs"
            />
          </label>
        </div>

        <ActionBody
          kind={kind}
          value={value}
          onChange={onChange}
          path={path}
          templateProperties={templateProperties}
          variableNodes={variableNodes}
          templateCompletion={templateCompletion}
          expressionCompletion={expressionCompletion}
          typeDefinitions={typeDefinitions}
          shellEnvVars={shellEnvVars}
          disabled={disabled}
        />
      </div>
    </ActionCard>
  );
};

const ActionBody: React.FC<{
  kind: ReturnType<typeof actionKindOf>;
  value: ActionInput;
  onChange: (next: ActionInput) => void;
  path: ActionPath;
  templateProperties: Array<{ path: string; type: string; description?: string }>;
  variableNodes: Parameters<typeof ConditionGuardActionBody>[0]["variableNodes"];
  templateCompletion: Parameters<typeof DelayActionBody>[0]["completionProvider"];
  expressionCompletion: Parameters<
    typeof ConditionGuardActionBody
  >[0]["completionProvider"];
  typeDefinitions: string;
  shellEnvVars: Parameters<typeof ProviderActionBody>[0]["shellEnvVars"];
  disabled?: boolean;
}> = ({
  kind,
  value,
  onChange,
  path,
  templateProperties,
  variableNodes,
  templateCompletion,
  expressionCompletion,
  typeDefinitions,
  shellEnvVars,
  disabled,
}) => {
  switch (kind) {
    case "action": {
      return (
        <ProviderActionBody
          value={value as ProviderAction}
          onChange={(next) => onChange(next)}
          templateProperties={templateProperties}
          completionProvider={templateCompletion}
          typeDefinitions={typeDefinitions}
          shellEnvVars={shellEnvVars}
          disabled={disabled}
        />
      );
    }
    case "choose": {
      return (
        <ChooseActionBody
          value={value as ChooseInput}
          onChange={(next) => onChange(next)}
          path={path}
          variableNodes={variableNodes}
          expressionCompletion={expressionCompletion}
          disabled={disabled}
        />
      );
    }
    case "parallel": {
      return (
        <ParallelActionBody
          value={value as ParallelInput}
          onChange={(next) => onChange(next)}
          path={path}
          disabled={disabled}
        />
      );
    }
    case "repeat": {
      return (
        <RepeatActionBody
          value={value as RepeatInput}
          onChange={(next) => onChange(next)}
          path={path}
          completionProvider={templateCompletion}
          disabled={disabled}
        />
      );
    }
    case "variables": {
      return (
        <VariablesActionBody
          value={value as VariablesInput}
          onChange={(next) => onChange(next)}
          templateProperties={templateProperties}
          disabled={disabled}
        />
      );
    }
    case "condition": {
      return (
        <ConditionGuardActionBody
          value={value as ConditionGuardInput}
          onChange={(next) => onChange(next)}
          variableNodes={variableNodes}
          completionProvider={expressionCompletion}
          disabled={disabled}
        />
      );
    }
    case "stop": {
      return (
        <StopActionBody
          value={value as StopInput}
          onChange={(next) => onChange(next)}
          disabled={disabled}
        />
      );
    }
    case "wait_for_trigger": {
      return (
        <WaitForTriggerActionBody
          value={value as WaitForTriggerInput}
          onChange={(next) => onChange(next)}
          completionProvider={templateCompletion}
          disabled={disabled}
        />
      );
    }
    case "sequence": {
      return (
        <SequenceActionBody
          value={value as SequenceInput}
          onChange={(next) => onChange(next)}
          path={path}
          disabled={disabled}
        />
      );
    }
    case "delay": {
      return (
        <DelayActionBody
          value={value as DelayInput}
          onChange={(next) => onChange(next)}
          completionProvider={templateCompletion}
          disabled={disabled}
        />
      );
    }
  }
};
