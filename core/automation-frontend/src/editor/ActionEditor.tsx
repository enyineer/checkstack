import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionCard,
  type ActionCardMenuItem,
  Checkbox,
  cn,
  Input,
  Label,
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
  WaitUntilInput,
} from "@checkstack/automation-common";
import {
  ACTION_KIND_META,
  actionDisplayName,
  actionKindOf,
  collectActionIds,
  defaultActionId,
} from "./action-helpers";
import { summarizeAction } from "./item-summary";
import { ItemSheet } from "./ItemSheet";
import { useAutomationRegistry, useVariableScope } from "./registry-context";
import { useActionIssues } from "./editor-validation";
import {
  ConditionGuardActionBody,
  DelayActionBody,
  ProviderActionBody,
  StopActionBody,
  VariablesActionBody,
  WaitForTriggerActionBody,
  WaitUntilActionBody,
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
  /** Clone this action (fresh ids) directly after itself. Omit to hide. */
  onDuplicate?: () => void;
  path: ActionPath;
  definition: AutomationDefinition;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  stableId: string;
  disabled?: boolean;
}

/**
 * Compact, uppercase "eyebrow" label for the action's secondary metadata
 * fields (type / id / description / failure behaviour). Deliberately
 * smaller and quieter than the `DynamicForm` config field labels so the
 * action's own configuration stays the focal point of the card.
 */
const MetaField: React.FC<{
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, children }) => (
  <div className="space-y-1.5">
    <label
      htmlFor={htmlFor}
      className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {label}
    </label>
    {children}
  </div>
);

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
  onDuplicate,
  path,
  definition,
  dragHandleProps,
  stableId,
  disabled,
}) => {
  const { actions } = useAutomationRegistry();
  const kind = actionKindOf(value);
  const meta = ACTION_KIND_META[kind];
  const [sheetOpen, setSheetOpen] = React.useState(false);
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

  // Collapsed-row summary derived from the config; falls back to the
  // operator's description/id note when there's no derivable summary.
  const summary =
    summarizeAction(value) ??
    value.description ??
    (value.id ? `id: ${value.id}` : undefined);

  const enabledValue = value.enabled !== false;
  const issues = useActionIssues(path);
  // `id` auto-fills on blur, so it isn't a meaningful "advanced was
  // customised" signal; open the metadata disclosure only when the operator
  // set a description or flipped the failure behaviour.
  const hasAdvancedMeta =
    value.description !== undefined || value.continue_on_error === true;

  // Validation issues (structural + inline-script type errors) surface only as
  // the card's error badge - never auto-open the sheet. Auto-opening would pop
  // multiple sheets at once when several cards have errors (e.g. every script
  // action after a trigger change), so the badge is the single, calm signal and
  // the operator clicks in for detail.

  const menuItems: ActionCardMenuItem[] = disabled
    ? []
    : [
        {
          label: enabledValue ? "Disable" : "Enable",
          icon: enabledValue ? "PowerOff" : "Power",
          onClick: () => onChange({ ...value, enabled: !enabledValue }),
        },
        ...(onDuplicate
          ? [
              {
                label: "Duplicate",
                icon: "Copy" as const,
                onClick: onDuplicate,
              },
            ]
          : []),
        {
          label: "Delete",
          icon: "Trash2",
          onClick: onDelete,
          variant: "destructive",
        },
      ];

  return (
    <>
      <ActionCard
        id={stableId}
        title={title}
        summary={summary}
        category={meta.label}
        icon={meta.icon}
        enabled={enabledValue}
        onOpenSheet={() => setSheetOpen(true)}
        actions={menuItems}
        dragHandleProps={disabled ? undefined : dragHandleProps}
        errors={issues}
      />
      <ItemSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={title}
        description={meta.label}
      >
      <div className="space-y-4">
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

        {/* Per-action metadata — id, description, failure behaviour — tucked
            behind a collapsed disclosure so the action's own configuration
            above reads as the primary content of the card. The action's kind
            is fixed at creation; to change it, add a new step and delete this
            one. Enable/disable lives on the card header, not here. */}
        <Accordion
          type="single"
          collapsible
          defaultValue={hasAdvancedMeta ? "advanced" : undefined}
          className="w-full"
        >
          <AccordionItem value="advanced" className="border-b-0">
            <AccordionTrigger className="py-2 text-xs hover:no-underline">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Advanced
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  <MetaField label="Id" htmlFor={`${stableId}-id`}>
                    <Input
                      id={`${stableId}-id`}
                      value={value.id ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          id: event.target.value || undefined,
                        })
                      }
                      onBlur={() => {
                        // Never leave the id blank: re-fill a unique,
                        // log-friendly default so the action stays
                        // referenceable (artifacts.<id>.<name>) and parseable
                        // in run logs.
                        if (value.id) return;
                        const taken = collectActionIds(definition.actions);
                        onChange({
                          ...value,
                          id: defaultActionId(value, taken),
                        });
                      }}
                      placeholder="Generated on blur"
                      disabled={disabled}
                      className="h-8 text-xs"
                    />
                  </MetaField>

                  <MetaField label="Description" htmlFor={`${stableId}-desc`}>
                    <Input
                      id={`${stableId}-desc`}
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
                  </MetaField>
                </div>

                <MetaField label="On failure">
                  <div
                    className={cn(
                      "flex h-8 items-center gap-2 select-none",
                      disabled ? "cursor-not-allowed" : "cursor-pointer",
                    )}
                    onClick={() =>
                      !disabled &&
                      onChange({
                        ...value,
                        continue_on_error: value.continue_on_error !== true,
                      })
                    }
                  >
                    <Checkbox
                      checked={value.continue_on_error === true}
                      disabled={disabled}
                    />
                    <Label className="text-xs font-normal text-muted-foreground cursor-pointer">
                      Continue on error
                    </Label>
                  </div>
                </MetaField>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      </ItemSheet>
    </>
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
    case "wait_until": {
      return (
        <WaitUntilActionBody
          value={value as WaitUntilInput}
          onChange={(next) => onChange(next)}
          variableNodes={variableNodes}
          completionProvider={expressionCompletion}
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
