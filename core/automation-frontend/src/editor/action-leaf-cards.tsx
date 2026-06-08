import React from "react";
import { Link } from "react-router-dom";
import { resolveRoute } from "@checkstack/common";
import { integrationRoutes } from "@checkstack/integration-common";
import {
  DynamicForm,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TemplateValueInput,
  Toggle,
  KeyValueEditor,
  customShellEnvVars,
  type ShellEnvVar,
  type TemplateCompletionProvider,
  type VariableNode,
} from "@checkstack/ui";
import type {
  ConditionGuardInput,
  ConditionInput,
  DelayInput,
  ProviderAction,
  StopInput,
  VariablesInput,
  WaitForTriggerInput,
  WaitUntilInput,
} from "@checkstack/automation-common";
import { useAutomationRegistry } from "./registry-context";
import { ItemPicker } from "./ItemPicker";
import { ConditionEditor } from "./ConditionEditor";
import { useActionOptionResolvers } from "./useActionOptionResolvers";
import { automationScriptTestRenderer } from "./ScriptTestRenderer";
import {
  useScriptPackageTypeAcquisition,
  useSdkTypeInjection,
} from "@checkstack/script-packages-frontend";
import { useSecretNames } from "@checkstack/secrets-frontend";
import { generateSecretEnvTypes, secretEnvEnvNames } from "../script-context";

/**
 * Provider action body. Picks an action id from `listActions()` then
 * renders the action's `configJsonSchema` via `DynamicForm`. The staged
 * `completionProvider` (template mode) is handed to DynamicForm so every
 * plain string config field (e.g. a log action's `message`) gets inline
 * `{{ … }}` field / comparator / value / filter autocomplete;
 * `templateProperties` still feeds the Monaco-backed multi-type editor
 * fields.
 */
export const ProviderActionBody: React.FC<{
  value: ProviderAction;
  onChange: (next: ProviderAction) => void;
  templateProperties: Array<{ path: string; type: string; description?: string }>;
  completionProvider: TemplateCompletionProvider;
  /**
   * Monaco `declare const context: …` lib for inline-script action
   * editors (`Run Script (TypeScript)`), so `context.trigger.payload`
   * is typed as the automation's trigger union instead of an untyped
   * default.
   */
  typeDefinitions: string;
  /**
   * `$CHECKSTACK_*` env var names for the shell script editor's `$`
   * autocomplete — the names the backend injects from the run scope.
   */
  shellEnvVars: ShellEnvVar[];
  // Accepted for a uniform body signature, but unused: the action is fixed
  // once created (no switcher), and `DynamicForm` has no read-only mode yet,
  // so there is nothing here to disable.
  disabled?: boolean;
}> = ({
  value,
  onChange,
  templateProperties,
  completionProvider,
  typeDefinitions,
  shellEnvVars,
}) => {
  const { actions, loading } = useAutomationRegistry();
  // Lazy ATA: the editor fetches + registers the `.d.ts` of any npm package
  // the script imports (incl. its `@types/*` companion), so
  // `import { debounce } from "lodash"` autocompletes. Coexists with the
  // scope-derived `context` ambient types already threaded down.
  // `importablePackages` drives import-specifier name completion (the package
  // name itself) before any module is registered.
  const { acquireTypes, acquireResetKey, importablePackages } =
    useScriptPackageTypeAcquisition();
  // SDK editor types so `@checkstack/sdk/integration` imports resolve.
  const { sdkTypes, sdkTypesResetKey } = useSdkTypeInjection();
  // Secret names (never values) for the secret -> env mapping editor's
  // ${{ secrets.* }} autocomplete.
  const { secretNames } = useSecretNames();
  // The shell script action exposes a user-editable `env` field; surface
  // its keys as `$`-completions alongside the run-scope `$CHECKSTACK_*`
  // vars (memoised so the editor's completion provider isn't re-registered
  // on every keystroke).
  const mergedShellEnvVars = React.useMemo(
    // User's own declared `env` keys first (most relevant), then the
    // run-scope `$CHECKSTACK_*` vars — the suggest list orders by insertion.
    () => [...customShellEnvVars(value.config.env), ...shellEnvVars],
    [shellEnvVars, value.config.env],
  );
  // The action is chosen up front in the add-step picker and fixed for the
  // life of the step — to use a different action, add a new step and delete
  // this one. So the card just resolves the registry entry and renders its
  // config; there is no in-card action switcher.
  const selected = actions.find((action) => action.qualifiedId === value.action);
  // Type the inline TS/JS editor's `process.env.<ENV_NAME>` from the action's
  // own `secretEnv` mapping: the declared env-var keys (located by the
  // `x-secret-env` schema annotation, never a hard-coded field name) become
  // ambient `ProcessEnv` members so they autocomplete and are typed `string`.
  // Merged onto the scope-derived `context` types; re-derived when the
  // secretEnv keys change (or the action's schema does). Coexists with
  // @types/node's existing index signature — this only adds known keys.
  const mergedTypeDefinitions = React.useMemo(() => {
    const envNames = secretEnvEnvNames({
      configSchema: selected?.configSchema,
      config: value.config,
    });
    const secretEnvLib = generateSecretEnvTypes({ envNames });
    return [typeDefinitions, secretEnvLib].filter(Boolean).join("\n\n");
  }, [typeDefinitions, selected?.configSchema, value.config]);
  // Connection-backed actions (Jira / Teams / Webex) declare a
  // `connectionProviderId`; the bridge turns their `x-options-resolver`
  // fields into a live connection picker + cascading provider dropdowns.
  // Non-connection actions get an empty map (no-op) since the id is absent.
  const optionsResolvers = useActionOptionResolvers(
    selected?.connectionProviderId,
  );

  if (!selected) {
    // Registry still loading vs. a genuinely unresolvable action id. The
    // latter can't be fixed in place (no switcher), so point the operator at
    // the add-a-new-step path.
    return loading ? (
      <p className="text-xs italic text-muted-foreground">Loading action…</p>
    ) : (
      <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Unknown action{" "}
        <code className="font-mono">{value.action || "(none)"}</code>. Delete
        this step and add a new one.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {selected.consumes && selected.consumes.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Consumes:{" "}
          <code className="font-mono">{selected.consumes.join(", ")}</code>
        </p>
      )}
      <div className="space-y-1">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Configuration
        </span>
        {selected.connectionProviderId && (
          <p className="text-[10px] text-muted-foreground">
            Connections are managed under{" "}
            <Link
              to={resolveRoute(integrationRoutes.routes.list)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Integrations
            </Link>
            . Create one there if the picker is empty.
          </p>
        )}
      </div>
      <DynamicForm
        schema={selected.configSchema}
        value={value.config}
        onChange={(next) => onChange({ ...value, config: next })}
        optionsResolvers={optionsResolvers}
        templateProperties={templateProperties}
        templateCompletionProvider={completionProvider}
        typeDefinitions={mergedTypeDefinitions}
        shellEnvVars={mergedShellEnvVars}
        scriptTestRenderer={automationScriptTestRenderer}
        secretNames={secretNames}
        acquireTypes={acquireTypes}
        acquireResetKey={acquireResetKey}
        sdkTypes={sdkTypes}
        sdkTypesResetKey={sdkTypesResetKey}
        importablePackages={importablePackages}
      />
    </div>
  );
};

export const VariablesActionBody: React.FC<{
  value: VariablesInput;
  onChange: (next: VariablesInput) => void;
  templateProperties: Array<{ path: string; type: string; description?: string }>;
  disabled?: boolean;
}> = ({ value, onChange, templateProperties, disabled }) => {
  const pairs = React.useMemo(
    () =>
      Object.entries(value.variables).map(([key, raw]) => ({
        key,
        value: typeof raw === "string" ? raw : JSON.stringify(raw),
      })),
    [value.variables],
  );

  const handleChange = (
    next: Array<{ key: string; value: string }>,
  ): void => {
    const record: Record<string, unknown> = {};
    for (const pair of next) {
      if (!pair.key) continue;
      // Try parsing as JSON; fall back to raw string. Lets the operator
      // write either a literal template `"{{ trigger.payload.x }}"` or
      // a structured value like `42` / `true` / `{...}`.
      try {
        record[pair.key] = JSON.parse(pair.value);
      } catch {
        record[pair.key] = pair.value;
      }
    }
    onChange({ ...value, variables: record });
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs">Variables</Label>
      <KeyValueEditor
        id="vars"
        value={pairs}
        onChange={handleChange}
        keyPlaceholder="name"
        valuePlaceholder='"literal" or {{ template }}'
        templateProperties={templateProperties}
      />
      <p className="text-[10px] text-muted-foreground">
        Values parsed as JSON when possible; otherwise treated as a string
        / template. Disabled state from the parent card is honoured.
      </p>
      {disabled && (
        <p className="text-[10px] italic text-muted-foreground">
          Read-only.
        </p>
      )}
    </div>
  );
};

export const StopActionBody: React.FC<{
  value: StopInput;
  onChange: (next: StopInput) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
  <div className="space-y-3">
    <div className="space-y-1">
      <Label className="text-xs">Reason</Label>
      <Input
        value={value.stop.reason ?? ""}
        onChange={(event) =>
          onChange({
            ...value,
            stop: { ...value.stop, reason: event.target.value || undefined },
          })
        }
        placeholder="Stopping because…"
        disabled={disabled}
      />
    </div>
    <div className="flex items-center justify-between">
      <Label className="text-xs">Mark run as failed</Label>
      <Toggle
        checked={value.stop.error === true}
        onCheckedChange={(error) =>
          onChange({ ...value, stop: { ...value.stop, error } })
        }
        disabled={disabled}
      />
    </div>
  </div>
);

export const DelayActionBody: React.FC<{
  value: DelayInput;
  onChange: (next: DelayInput) => void;
  completionProvider: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({ value, onChange, completionProvider, disabled }) => {
  const useTemplate = "template" in value.delay;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Source</Label>
        <Select
          value={useTemplate ? "template" : "seconds"}
          onValueChange={(next) => {
            if (next === "seconds") {
              onChange({ ...value, delay: { seconds: 30 } });
            } else {
              onChange({ ...value, delay: { template: "" } });
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="seconds">Seconds</SelectItem>
            <SelectItem value="template">Template</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {useTemplate ? (
        <div className="space-y-1">
          <Label className="text-xs">Template (renders to seconds)</Label>
          <TemplateValueInput
            value={(value.delay as { template: string }).template}
            onChange={(next) =>
              onChange({ ...value, delay: { template: next } })
            }
            placeholder="{{ trigger.payload.delaySeconds }}"
            completionProvider={completionProvider}
            disabled={disabled}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Seconds</Label>
          <Input
            type="number"
            min={0}
            max={86_400}
            value={(value.delay as { seconds: number }).seconds}
            onChange={(event) =>
              onChange({
                ...value,
                delay: { seconds: Math.max(0, Number(event.target.value)) },
              })
            }
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
};

export const WaitForTriggerActionBody: React.FC<{
  value: WaitForTriggerInput;
  onChange: (next: WaitForTriggerInput) => void;
  completionProvider: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({ value, onChange, completionProvider, disabled }) => {
  const { triggers } = useAutomationRegistry();
  const pickerItems = React.useMemo(
    () =>
      triggers.map((trigger) => ({
        id: trigger.qualifiedId,
        label: trigger.displayName,
        description: trigger.description,
        category: trigger.category,
      })),
    [triggers],
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Event to wait for</Label>
        <ItemPicker
          items={pickerItems}
          value={value.wait_for_trigger.event}
          onSelect={(id) =>
            onChange({
              ...value,
              wait_for_trigger: { ...value.wait_for_trigger, event: id },
            })
          }
          placeholder="Pick a trigger event"
          disabled={disabled}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Filter template</Label>
          <TemplateValueInput
            value={value.wait_for_trigger.filter ?? ""}
            onChange={(next) =>
              onChange({
                ...value,
                wait_for_trigger: {
                  ...value.wait_for_trigger,
                  filter: next || undefined,
                },
              })
            }
            placeholder="{{ trigger.payload.id == var.targetId }}"
            completionProvider={completionProvider}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Timeout (seconds)</Label>
          <Input
            type="number"
            min={1}
            value={value.wait_for_trigger.timeout_seconds ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                wait_for_trigger: {
                  ...value.wait_for_trigger,
                  timeout_seconds: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                },
              })
            }
            disabled={disabled}
            placeholder="No timeout"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Context key (optional)</Label>
        <Input
          value={value.wait_for_trigger.context_key ?? ""}
          onChange={(event) =>
            onChange({
              ...value,
              wait_for_trigger: {
                ...value.wait_for_trigger,
                context_key: event.target.value || undefined,
              },
            })
          }
          placeholder="Defaults to the triggering event's contextKey"
          disabled={disabled}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
};

export const ConditionGuardActionBody: React.FC<{
  value: ConditionGuardInput;
  onChange: (next: ConditionGuardInput) => void;
  variableNodes: VariableNode[];
  completionProvider: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({ value, onChange, variableNodes, completionProvider }) => (
  <div className="space-y-1">
    <Label className="text-xs">Condition</Label>
    <ConditionEditor
      value={value.condition}
      onChange={(next: ConditionInput) =>
        onChange({ ...value, condition: next })
      }
      variableNodes={variableNodes}
      completionProvider={completionProvider}
      bare
    />
  </div>
);

/**
 * `wait_until` card — mirrors {@link WaitForTriggerActionBody} but waits on
 * a CONDITION (re-checked on a poll interval) rather than an event. Reuses
 * the expression-based {@link ConditionEditor}; the structured
 * numeric/time/state condition branches arrive with the rest of the
 * sensing-layer editor work.
 */
export const WaitUntilActionBody: React.FC<{
  value: WaitUntilInput;
  onChange: (next: WaitUntilInput) => void;
  variableNodes: VariableNode[];
  completionProvider: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({ value, onChange, variableNodes, completionProvider, disabled }) => {
  const wu = value.wait_until;
  const patch = (next: Partial<WaitUntilInput["wait_until"]>) =>
    onChange({ ...value, wait_until: { ...wu, ...next } });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Wait until condition</Label>
        <ConditionEditor
          value={wu.condition}
          onChange={(next: ConditionInput) => patch({ condition: next })}
          variableNodes={variableNodes}
          completionProvider={completionProvider}
          bare
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Timeout (seconds)</Label>
        <Input
          type="number"
          min={1}
          value={wu.timeout_seconds ?? ""}
          onChange={(event) =>
            patch({
              timeout_seconds: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
          disabled={disabled}
          placeholder="No timeout"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">
          Continue on timeout (off = fail the run on timeout)
        </Label>
        <Toggle
          checked={wu.continue_on_timeout ?? true}
          onCheckedChange={(checked) => patch({ continue_on_timeout: checked })}
          disabled={disabled}
        />
      </div>
    </div>
  );
};
