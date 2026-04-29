import { Label, Toggle, Slider } from "@checkstack/ui";
import type {
  AnomalyDirection,
  AnomalyFieldConfig,
} from "@checkstack/anomaly-common";
import { AnomalyFieldOverridesEditor } from "./AnomalyFieldOverridesEditor";
import type { AnomalyFieldMeta } from "./useAnomalyFields";

export interface AnomalySettingsFormValues {
  enabled: boolean;
  sensitivity: number;
  confirmationWindow: number;
  driftEnabled: boolean;
  driftThreshold: number;
  fieldOverrides: Record<string, AnomalyFieldConfig>;
}

export interface AnomalySettingsFormProps {
  values: AnomalySettingsFormValues;
  onChange: <K extends keyof AnomalySettingsFormValues>(
    key: K,
    value: AnomalySettingsFormValues[K],
  ) => void;
  availableFields: AnomalyFieldMeta[];
  isLocked?: boolean;
  /** Copy variant — template defaults vs assignment overrides. */
  variant: "template" | "assignment";
}

const COPY = {
  template: {
    enabledLabel: "Enable Anomaly Detection by Default",
    enabledDescription:
      "Run background analysis to detect deviations from expected behavior across all systems using this template.",
    sensitivityLabel: "Global Sensitivity Multiplier",
    confirmationLabel: "Confirmation Window",
    fieldOverridesTitle: "Global Field-Level Defaults",
    fieldOverridesDescription:
      "Set default anomaly behavior for specific metrics collected by this health check.",
  },
  assignment: {
    enabledLabel: "Enable Assignment Exceptions",
    enabledDescription: "Run background analysis for this specific system",
    sensitivityLabel: "Sensitivity Multiplier Override",
    confirmationLabel: "Confirmation Window Override",
    fieldOverridesTitle: "Field-Level Overrides",
    fieldOverridesDescription:
      "Override anomaly settings for specific metrics collected by this health check.",
  },
} as const;

export function AnomalySettingsForm({
  values,
  onChange,
  availableFields,
  isLocked,
  variant,
}: AnomalySettingsFormProps) {
  const copy = COPY[variant];
  const {
    enabled,
    sensitivity,
    confirmationWindow,
    driftEnabled,
    driftThreshold,
    fieldOverrides,
  } = values;

  const handleFieldOverrideChange = (
    field: string,
    key: keyof AnomalyFieldConfig,
    value: number | boolean | AnomalyDirection | undefined,
  ) => {
    const next = { ...fieldOverrides };
    next[field] = { ...next[field], [key]: value };
    onChange("fieldOverrides", next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 border rounded-md">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">{copy.enabledLabel}</Label>
          <div className="text-sm text-muted-foreground">{copy.enabledDescription}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{enabled ? "Enabled" : "Disabled"}</span>
          <Toggle
            checked={enabled}
            onCheckedChange={(val) => onChange("enabled", val)}
            disabled={isLocked}
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 p-4 border rounded-md">
        <div className="space-y-2">
          <Label htmlFor="sensitivity">{copy.sensitivityLabel}</Label>
          <div className="pt-4 pb-2 px-1">
            <Slider
              id="sensitivity"
              value={[sensitivity]}
              min={0.5}
              max={3}
              step={0.1}
              onValueChange={(val) => onChange("sensitivity", val[0])}
              disabled={!enabled || isLocked}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-1">
            <span>0.5 (More)</span>
            <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
              {sensitivity.toFixed(1)}x
            </span>
            <span>3.0 (Fewer)</span>
          </div>
          {variant === "template" && (
            <p className="text-xs text-muted-foreground pt-2">
              Higher multiplier = wider expected range (fewer alerts).
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmationWindow">{copy.confirmationLabel}</Label>
          <div className="pt-4 pb-2 px-1">
            <Slider
              id="confirmationWindow"
              value={[confirmationWindow]}
              min={1}
              max={10}
              step={1}
              onValueChange={(val) => onChange("confirmationWindow", val[0])}
              disabled={!enabled || isLocked}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-1">
            <span>1 Run</span>
            <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
              {confirmationWindow} Runs
            </span>
            <span>10 Runs</span>
          </div>
          {variant === "template" && (
            <p className="text-xs text-muted-foreground pt-2">
              Number of consecutive anomalous runs required before an alert is triggered.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 p-4 border rounded-md">
        <div className="flex items-center justify-between md:col-span-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Trend Drift Detection</Label>
            <div className="text-sm text-muted-foreground">
              Catch slow, gradual degradation that never triggers a spike alert.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{driftEnabled ? "Enabled" : "Disabled"}</span>
            <Toggle
              checked={driftEnabled}
              onCheckedChange={(val) => onChange("driftEnabled", val)}
              disabled={!enabled || isLocked}
            />
          </div>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="driftThreshold">Drift Threshold (σ)</Label>
          <div className="pt-4 pb-2 px-1">
            <Slider
              id="driftThreshold"
              value={[driftThreshold]}
              min={1}
              max={4}
              step={0.1}
              onValueChange={(val) => onChange("driftThreshold", val[0])}
              disabled={!enabled || !driftEnabled || isLocked}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-1">
            <span>1.0σ (More)</span>
            <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
              {driftThreshold.toFixed(1)}σ
            </span>
            <span>4.0σ (Fewer)</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Drift fires when the projected change over the baseline window exceeds this many standard deviations.
          </p>
        </div>
      </div>

      <AnomalyFieldOverridesEditor
        title={copy.fieldOverridesTitle}
        description={copy.fieldOverridesDescription}
        availableFields={availableFields}
        fieldOverrides={fieldOverrides}
        onChange={handleFieldOverrideChange}
        parentEnabled={enabled}
        isLocked={isLocked}
        defaultSensitivity={sensitivity}
        defaultConfirmationWindow={confirmationWindow}
        defaultDriftEnabled={driftEnabled}
        defaultDriftThreshold={driftThreshold}
      />
    </div>
  );
}
