import {
  Label,
  Toggle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import type {
  AnomalyDirection,
  AnomalyFieldConfig,
} from "@checkstack/anomaly-common";
import { AnomalyFieldOverridesEditor } from "./AnomalyFieldOverridesEditor";
import type { AnomalyFieldMeta } from "./useAnomalyFields";

export interface AnomalySettingsFormValues {
  enabled: boolean;
  baselineWindow: string;
  notify: boolean;
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
    enabledLabel: "Enable anomaly detection by default",
    enabledDescription:
      "Run background analysis to detect deviations from expected behavior across all systems using this template.",
    fieldOverridesTitle: "Field-level defaults",
    fieldOverridesDescription:
      "Tune anomaly detection for specific metrics. Each field uses the plugin's tuned defaults until you override it here.",
    notifyLabel: "Send notifications on confirmed anomalies",
    notifyDescription:
      "Page the assigned subscribers when an anomaly transitions to confirmed.",
  },
  assignment: {
    enabledLabel: "Enable assignment exceptions",
    enabledDescription:
      "Run background analysis for this specific system assignment.",
    fieldOverridesTitle: "Field-level overrides",
    fieldOverridesDescription:
      "Override anomaly settings for specific metrics on this system. Other systems using the same template are unaffected.",
    notifyLabel: "Send notifications on confirmed anomalies",
    notifyDescription:
      "Page the assigned subscribers for this system when an anomaly transitions to confirmed.",
  },
} as const;

const BASELINE_WINDOW_OPTIONS: { value: string; label: string }[] = [
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days (recommended)" },
  { value: "14d", label: "14 days" },
  { value: "30d", label: "30 days" },
];

export function AnomalySettingsForm({
  values,
  onChange,
  availableFields,
  isLocked,
  variant,
}: AnomalySettingsFormProps) {
  const copy = COPY[variant];
  const { enabled, baselineWindow, notify, fieldOverrides } = values;

  const handleFieldOverrideChange = (
    field: string,
    key: keyof AnomalyFieldConfig,
    value: number | boolean | AnomalyDirection | undefined,
  ) => {
    const next = { ...fieldOverrides };
    next[field] = { ...next[field], [key]: value };
    onChange("fieldOverrides", next);
  };

  const handleFieldPatch = (
    field: string,
    patch: Partial<AnomalyFieldConfig>,
  ) => {
    const next = { ...fieldOverrides };
    next[field] = { ...next[field], ...patch };
    onChange("fieldOverrides", next);
  };

  const handleFieldReset = (field: string) => {
    const next = { ...fieldOverrides };
    delete next[field];
    onChange("fieldOverrides", next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">{copy.enabledLabel}</Label>
          <div className="text-sm text-muted-foreground">
            {copy.enabledDescription}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <Toggle
            checked={enabled}
            onCheckedChange={(val) => onChange("enabled", val)}
            disabled={isLocked}
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]">
        <div className="space-y-2">
          <Label htmlFor="baselineWindow" className="text-sm font-medium">
            Baseline window
          </Label>
          <Select
            value={baselineWindow}
            onValueChange={(val) => onChange("baselineWindow", val)}
            disabled={!enabled || isLocked}
          >
            <SelectTrigger id="baselineWindow" className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASELINE_WINDOW_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            How much history to use when computing each metric's baseline.
            Longer windows are smoother but slower to react to legitimate
            changes.
          </p>
        </div>

        <div className="flex items-center justify-between md:col-span-1">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{copy.notifyLabel}</Label>
            <div className="text-xs text-muted-foreground">
              {copy.notifyDescription}
            </div>
          </div>
          <Toggle
            checked={notify}
            onCheckedChange={(val) => onChange("notify", val)}
            disabled={!enabled || isLocked}
          />
        </div>
      </div>

      <AnomalyFieldOverridesEditor
        title={copy.fieldOverridesTitle}
        description={copy.fieldOverridesDescription}
        availableFields={availableFields}
        fieldOverrides={fieldOverrides}
        onChange={handleFieldOverrideChange}
        onPatchField={handleFieldPatch}
        onResetField={handleFieldReset}
        parentEnabled={enabled}
        isLocked={isLocked}
      />
    </div>
  );
}
