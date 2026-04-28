import React from "react";
import {
  Label,
  Input,
  Toggle,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@checkstack/ui";
import type {
  AnomalyFieldConfig,
  AnomalyDirection,
} from "@checkstack/anomaly-common";
import type { AnomalyFieldMeta } from "./useAnomalyFields";

interface AnomalyFieldOverridesEditorProps {
  title: string;
  description: string;
  availableFields: AnomalyFieldMeta[];
  fieldOverrides: Record<string, AnomalyFieldConfig>;
  onChange: (
    field: string,
    key: keyof AnomalyFieldConfig,
    value: number | boolean | AnomalyDirection | undefined,
  ) => void;
  parentEnabled: boolean;
  isLocked?: boolean;
  defaultSensitivity: number;
  defaultConfirmationWindow: number;
}

export function AnomalyFieldOverridesEditor({
  title,
  description,
  availableFields,
  fieldOverrides,
  onChange,
  parentEnabled,
  isLocked,
  defaultSensitivity,
  defaultConfirmationWindow,
}: AnomalyFieldOverridesEditorProps) {
  if (availableFields.length === 0) {
    return <></>;
  }

  // A field is only considered "overridden" if its configured values differ from the parent defaults.
  const isFieldOverridden = (fieldMeta: AnomalyFieldMeta) => {
    const override = fieldOverrides[fieldMeta.path];
    if (!override) return false;

    if (override.enabled !== undefined && override.enabled !== fieldMeta.defaultEnabled)
      return true;
    if (
      override.sensitivity !== undefined &&
      override.sensitivity !== (fieldMeta.defaultSensitivity ?? defaultSensitivity)
    )
      return true;
    if (
      override.confirmationWindow !== undefined &&
      override.confirmationWindow !== (fieldMeta.defaultConfirmationWindow ?? defaultConfirmationWindow)
    )
      return true;
    if (override.direction !== undefined) return true;

    return false;
  };

  // Auto-expand overridden fields
  const overriddenFields = availableFields
    .filter((fieldMeta) => isFieldOverridden(fieldMeta))
    .map(meta => meta.path);

  return (
    <div className="mt-10 space-y-6">
      <div>
        <h3 className="text-lg font-medium tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <Accordion
        type="multiple"
        defaultValue={overriddenFields}
        className="w-full space-y-3"
      >
        {availableFields.map((fieldMeta) => {
          const field = fieldMeta.path;
          const override = fieldOverrides[field];
          const isOverridden = isFieldOverridden(fieldMeta);
          const fieldEnabled = override?.enabled ?? fieldMeta.defaultEnabled;

          // Split the field path into namespace breadcrumbs and the actual property name
          const parts = field.split(".");
          const fieldName = parts.pop() || field;
          const pathParts = parts;

          return (
            <AccordionItem
              key={field}
              value={field}
              className={`
                rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-200 overflow-hidden
                ${isOverridden ? "border-primary/40 shadow-md" : "border-border/40 opacity-80 hover:opacity-100"}
              `}
            >
              <AccordionTrigger className="hover:no-underline px-5 py-4">
                <div className="flex flex-1 items-center justify-between gap-4 mr-4">
                  <div className="space-y-1 text-left">
                    {pathParts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground font-mono">
                        {pathParts.map((part, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && <span className="opacity-40">▶</span>}
                            <span>{part}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    <div
                      className={`text-sm font-semibold tracking-tight font-mono ${isOverridden ? "text-primary" : ""}`}
                    >
                      {fieldName}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {isOverridden ? (
                      <Badge
                        variant={fieldEnabled ? "default" : "secondary"}
                        className="text-[10px] uppercase tracking-wider font-semibold"
                      >
                        {fieldEnabled ? "Custom Override" : "Ignored"}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider font-semibold opacity-50"
                      >
                        Default Settings
                      </Badge>
                    )}
                  </div>
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-5 pb-5 pt-2 border-t border-border/30">
                <div className="space-y-6 mt-4">
                  <div className="flex items-center justify-between bg-muted/30 p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">
                        Enable Custom Monitoring
                      </Label>
                      <div className="text-xs text-muted-foreground">
                        Toggle to ignore anomalies for this specific field.
                      </div>
                    </div>
                    <Toggle
                      checked={fieldEnabled}
                      onCheckedChange={(val) => onChange(field, "enabled", val)}
                      disabled={!parentEnabled || isLocked}
                    />
                  </div>

                  {fieldEnabled && (
                    <div className="grid gap-6 lg:grid-cols-3">
                      <div className="space-y-2 flex flex-col">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Sensitivity Multiplier
                        </Label>
                        <Input
                          type="number"
                          min={0.5}
                          max={3}
                          step={0.1}
                          className="h-10 font-mono bg-background/50 focus:bg-background transition-colors"
                          value={override?.sensitivity ?? fieldMeta.defaultSensitivity ?? defaultSensitivity}
                          onChange={(e) =>
                            onChange(
                              field,
                              "sensitivity",
                              Number.parseFloat(e.target.value),
                            )
                          }
                          disabled={!parentEnabled || isLocked}
                        />
                        <p className="text-[10.5px] text-muted-foreground leading-relaxed pt-1">
                          Controls the strictness of the baseline boundaries. A higher multiplier widens the acceptable range, resulting in fewer alerts (lower sensitivity).
                        </p>
                      </div>
                      <div className="space-y-2 flex flex-col">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Confirmation Window
                        </Label>
                        <div className="relative">
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            className="h-10 font-mono bg-background/50 focus:bg-background transition-colors pr-12"
                            value={
                              override?.confirmationWindow ??
                              fieldMeta.defaultConfirmationWindow ??
                              defaultConfirmationWindow
                            }
                            onChange={(e) =>
                              onChange(
                                field,
                                "confirmationWindow",
                                Number.parseInt(e.target.value, 10),
                              )
                            }
                            disabled={!parentEnabled || isLocked}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium select-none pointer-events-none">
                            runs
                          </span>
                        </div>
                        <p className="text-[10.5px] text-muted-foreground leading-relaxed pt-1">
                          Consecutive anomalous data points required before an alert is officially raised, preventing alert fatigue from isolated network spikes.
                        </p>
                      </div>
                      <div className="space-y-2 flex flex-col">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Behavior
                        </Label>
                        <Select
                          value={override?.direction ?? "auto"}
                          onValueChange={(val) =>
                            onChange(
                              field,
                              "direction",
                              val === "auto"
                                ? undefined
                                : (val as AnomalyDirection),
                            )
                          }
                          disabled={!parentEnabled || isLocked}
                        >
                          <SelectTrigger className="h-10 bg-background/50 focus:bg-background transition-colors">
                            <SelectValue placeholder="Auto-inferred" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto-inferred</SelectItem>
                            <SelectItem value="deviation">
                              Any Deviation
                            </SelectItem>
                            <SelectItem value="higher-is-better">
                              Higher is Better
                            </SelectItem>
                            <SelectItem value="lower-is-better">
                              Lower is Better
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[10.5px] text-muted-foreground leading-relaxed pt-1">
                          Override the auto-inferred behavior logic. "Higher is Better" ignores positive spikes, while "Lower is Better" ignores sudden drops.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
