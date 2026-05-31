import React from "react";
import type {
  CollectorConfigEntry,
  CollectorDto,
} from "@checkstack/healthcheck-common";
import {
  Button,
  DynamicForm,
  Label,
  healthcheckScriptContext,
} from "@checkstack/ui";
import { Trash2 } from "lucide-react";
import { useScriptPackageTypes } from "@checkstack/script-packages-frontend";
import { useSecretNames } from "@checkstack/secrets-frontend";
import { AssertionBuilder, type Assertion } from "../AssertionBuilder";
import { createCollectorScriptTestRenderer } from "./CollectorScriptTestRenderer";

interface CollectorSectionProps {
  entry: CollectorConfigEntry;
  collectorDef: CollectorDto | undefined;
  onConfigChange: (config: Record<string, unknown>) => void;
  onAssertionsChange: (assertions: CollectorConfigEntry["assertions"]) => void;
  onValidChange: (isValid: boolean) => void;
  onRemove: () => void;
}

export const CollectorSection: React.FC<CollectorSectionProps> = ({
  entry,
  collectorDef,
  onConfigChange,
  onAssertionsChange,
  onValidChange,
  onRemove,
}) => {
  const scriptTestRenderer = React.useMemo(
    () => createCollectorScriptTestRenderer(entry.config),
    [entry.config],
  );
  const { dts: packageTypes } = useScriptPackageTypes();
  // Secret names (never values) for the secret -> env mapping editor.
  const { secretNames } = useSecretNames();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {collectorDef?.displayName ?? entry.collectorId}
          </h2>
          {collectorDef?.description && (
            <p className="text-sm text-muted-foreground">
              {collectorDef.description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive shrink-0"
          onClick={onRemove}
          title="Remove collector"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Configuration */}
      {collectorDef?.configSchema && (
        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">Configuration</Label>
            <p className="text-xs text-muted-foreground">
              Configure how this check item behaves.
            </p>
          </div>
          {(() => {
            const ctx = healthcheckScriptContext({
              collectorConfigSchema: collectorDef.configSchema,
              // Surface the user's own `env` keys as `$`-completions.
              customEnv: entry.config.env,
            });
            // Append installed npm-package `.d.ts` so collector scripts get
            // package IntelliSense on top of the `context`/config types.
            const typeDefinitions =
              packageTypes.length > 0
                ? `${ctx.typeDefinitions}\n${packageTypes}`
                : ctx.typeDefinitions;
            return (
              <DynamicForm
                schema={collectorDef.configSchema}
                value={entry.config}
                onChange={onConfigChange}
                onValidChange={onValidChange}
                {...ctx}
                typeDefinitions={typeDefinitions}
                scriptTestRenderer={scriptTestRenderer}
                secretNames={secretNames}
              />
            );
          })()}
        </div>
      )}

      {/* Assertions */}
      {collectorDef?.resultSchema && (
        <div className="space-y-3 pt-2 border-t">
          <div>
            <Label className="text-sm font-semibold">Assertions</Label>
            <p className="text-xs text-muted-foreground">
              Define conditions that must be met for this check to pass.
            </p>
          </div>
          <AssertionBuilder
            resultSchema={collectorDef.resultSchema}
            assertions={
              (entry.assertions as unknown as Assertion[]) ?? []
            }
            onChange={(assertions) =>
              onAssertionsChange(
                assertions as unknown as CollectorConfigEntry["assertions"],
              )
            }
          />
        </div>
      )}
    </div>
  );
};
