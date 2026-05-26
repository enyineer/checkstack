import React, { useState } from "react";
import {
  ChevronDown,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  Tag,
  Wand2,
} from "lucide-react";
import {
  Label,
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
  Slider,
  Input,
  Tooltip,
  cn,
  usePerformance,
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
  /**
   * Applies a partial patch to a field's override atomically. Required for
   * presets, which set multiple keys at once — sequential `onChange` calls
   * race against stale parent state.
   */
  onPatchField?: (field: string, patch: Partial<AnomalyFieldConfig>) => void;
  /** Removes the field's entire override entry, restoring plugin defaults. */
  onResetField?: (field: string) => void;
  parentEnabled: boolean;
  isLocked?: boolean;
}

// Engine constants — used as the very last fallback when a field has neither
// a user override nor a schema-declared default. Mirror of the values in
// `core/anomaly-common/src/engine/config.ts`.
const ENGINE_DEFAULT_SENSITIVITY = 1;
const ENGINE_DEFAULT_CONFIRMATION_WINDOW = 3;
const ENGINE_DEFAULT_DRIFT_ENABLED = true;
const ENGINE_DEFAULT_DRIFT_THRESHOLD = 2;

type Preset = "strict" | "balanced" | "relaxed" | "custom";

interface PresetSpec {
  sensitivity: number;
  confirmationWindow: number;
  /** Multiplier applied to the plugin's default absolute floor. */
  absoluteFloorMultiplier: number;
  /** Multiplier applied to the plugin's default relative floor. */
  relativeFloorMultiplier: number;
}

const PRESETS: Record<Exclude<Preset, "custom">, PresetSpec> = {
  strict: {
    sensitivity: 0.7,
    confirmationWindow: 2,
    absoluteFloorMultiplier: 0,
    relativeFloorMultiplier: 0,
  },
  balanced: {
    sensitivity: 1,
    confirmationWindow: 3,
    absoluteFloorMultiplier: 1,
    relativeFloorMultiplier: 1,
  },
  relaxed: {
    sensitivity: 1.5,
    confirmationWindow: 5,
    absoluteFloorMultiplier: 2,
    relativeFloorMultiplier: 2,
  },
};

const PRESET_COPY: Record<
  Exclude<Preset, "custom">,
  { label: string; description: string }
> = {
  strict: {
    label: "Strict",
    description:
      "Catches more deviations early. Best for critical metrics where false positives are tolerable.",
  },
  balanced: {
    label: "Balanced",
    description:
      "Recommended. Uses the plugin's tuned defaults — alerts on sustained, meaningful deviations.",
  },
  relaxed: {
    label: "Relaxed",
    description:
      "Reduces noise on bursty metrics. Only large, sustained changes will alert.",
  },
};

const APPROX_EQ = (a: number, b: number) => Math.abs(a - b) < 1e-6;

interface DirectionOption {
  value: AnomalyDirection | "auto";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DIRECTION_OPTIONS: DirectionOption[] = [
  {
    value: "auto",
    label: "Auto-detect",
    description: "Use the plugin's recommendation",
    icon: Wand2,
  },
  {
    value: "lower-is-better",
    label: "Lower is better",
    description: "Alert when the value rises (e.g. latency, errors)",
    icon: TrendingDown,
  },
  {
    value: "higher-is-better",
    label: "Higher is better",
    description: "Alert when the value drops (e.g. success rate, uptime)",
    icon: TrendingUp,
  },
  {
    value: "deviation",
    label: "Either direction",
    description: "Alert on any unusual move (e.g. traffic, player count)",
    icon: ArrowUpDown,
  },
  {
    value: "dominance",
    label: "Categorical flip",
    description: "Alert when a stable value (e.g. status) changes",
    icon: Tag,
  },
];

function describeBehavior(direction: AnomalyDirection | undefined): string {
  switch (direction) {
    case "higher-is-better": {
      return "drops below";
    }
    case "lower-is-better": {
      return "rises above";
    }
    case "deviation": {
      return "moves away from";
    }
    case "dominance": {
      return "flips from";
    }
    default: {
      return "deviates from";
    }
  }
}

export function AnomalyFieldOverridesEditor({
  title,
  description,
  availableFields,
  fieldOverrides,
  onChange,
  onPatchField,
  onResetField,
  parentEnabled,
  isLocked,
}: AnomalyFieldOverridesEditorProps) {
  if (availableFields.length === 0) {
    return <></>;
  }

  // Compute the "effective" config for a field (override > schema > engine default).
  const getEffective = (fieldMeta: AnomalyFieldMeta) => {
    const override = fieldOverrides[fieldMeta.path];
    return {
      sensitivity:
        override?.sensitivity ??
        fieldMeta.defaultSensitivity ??
        ENGINE_DEFAULT_SENSITIVITY,
      confirmationWindow:
        override?.confirmationWindow ??
        fieldMeta.defaultConfirmationWindow ??
        ENGINE_DEFAULT_CONFIRMATION_WINDOW,
      direction: override?.direction ?? fieldMeta.defaultDirection,
      driftEnabled:
        override?.driftEnabled ??
        fieldMeta.defaultDriftEnabled ??
        ENGINE_DEFAULT_DRIFT_ENABLED,
      driftThreshold:
        override?.driftThreshold ??
        fieldMeta.defaultDriftThreshold ??
        ENGINE_DEFAULT_DRIFT_THRESHOLD,
      minAbsoluteDelta:
        override?.minAbsoluteDelta ?? fieldMeta.defaultMinAbsoluteDelta ?? 0,
      minRelativeDelta:
        override?.minRelativeDelta ?? fieldMeta.defaultMinRelativeDelta ?? 0,
    };
  };

  const detectPreset = (fieldMeta: AnomalyFieldMeta): Preset => {
    const eff = getEffective(fieldMeta);
    const pluginAbs = fieldMeta.defaultMinAbsoluteDelta ?? 0;
    const pluginRel = fieldMeta.defaultMinRelativeDelta ?? 0;

    for (const [name, spec] of Object.entries(PRESETS) as [
      Exclude<Preset, "custom">,
      PresetSpec,
    ][]) {
      if (
        APPROX_EQ(eff.sensitivity, spec.sensitivity) &&
        eff.confirmationWindow === spec.confirmationWindow &&
        APPROX_EQ(
          eff.minAbsoluteDelta,
          pluginAbs * spec.absoluteFloorMultiplier,
        ) &&
        APPROX_EQ(
          eff.minRelativeDelta,
          pluginRel * spec.relativeFloorMultiplier,
        )
      ) {
        return name;
      }
    }
    return "custom";
  };

  const applyPreset = (
    fieldMeta: AnomalyFieldMeta,
    preset: Exclude<Preset, "custom">,
  ) => {
    const spec = PRESETS[preset];
    const pluginAbs = fieldMeta.defaultMinAbsoluteDelta ?? 0;
    const pluginRel = fieldMeta.defaultMinRelativeDelta ?? 0;
    const patch: Partial<AnomalyFieldConfig> = {
      sensitivity: spec.sensitivity,
      confirmationWindow: spec.confirmationWindow,
      minAbsoluteDelta: pluginAbs * spec.absoluteFloorMultiplier,
      minRelativeDelta: pluginRel * spec.relativeFloorMultiplier,
    };
    if (onPatchField) {
      onPatchField(fieldMeta.path, patch);
      return;
    }
    // Fallback for callers that didn't wire the atomic patch path.
    // This is racy across multiple keys but keeps the editor functional
    // in tests / minimal setups.
    for (const [key, value] of Object.entries(patch) as [
      keyof AnomalyFieldConfig,
      number,
    ][]) {
      onChange(fieldMeta.path, key, value);
    }
  };

  // A field is overridden if any user-set value differs from the plugin/parent default.
  const isFieldOverridden = (fieldMeta: AnomalyFieldMeta) => {
    const override = fieldOverrides[fieldMeta.path];
    if (!override) return false;
    const keys: (keyof AnomalyFieldConfig)[] = [
      "enabled",
      "sensitivity",
      "confirmationWindow",
      "direction",
      "driftEnabled",
      "driftThreshold",
      "minAbsoluteDelta",
      "minRelativeDelta",
    ];
    return keys.some((k) => override[k] !== undefined);
  };

  const overriddenFields = availableFields
    .filter((fieldMeta) => isFieldOverridden(fieldMeta))
    .map((meta) => meta.path);

  return (
    <div className="mt-10 space-y-6">
      <div>
        <h3 className="text-lg font-medium tracking-tight">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <Accordion
        type="multiple"
        defaultValue={overriddenFields}
        className="w-full space-y-3"
      >
        {availableFields.map((fieldMeta) => (
          <FieldAccordionItem
            key={fieldMeta.path}
            fieldMeta={fieldMeta}
            override={fieldOverrides[fieldMeta.path]}
            isOverridden={isFieldOverridden(fieldMeta)}
            preset={detectPreset(fieldMeta)}
            effective={getEffective(fieldMeta)}
            parentEnabled={parentEnabled}
            isLocked={isLocked}
            onChange={onChange}
            onResetField={onResetField}
            applyPreset={(preset) => applyPreset(fieldMeta, preset)}
          />
        ))}
      </Accordion>
    </div>
  );
}

interface EffectiveFieldConfig {
  sensitivity: number;
  confirmationWindow: number;
  direction: AnomalyDirection | undefined;
  driftEnabled: boolean;
  driftThreshold: number;
  minAbsoluteDelta: number;
  minRelativeDelta: number;
}

interface FieldAccordionItemProps {
  fieldMeta: AnomalyFieldMeta;
  override: AnomalyFieldConfig | undefined;
  isOverridden: boolean;
  preset: Preset;
  effective: EffectiveFieldConfig;
  parentEnabled: boolean;
  isLocked?: boolean;
  onChange: AnomalyFieldOverridesEditorProps["onChange"];
  onResetField?: AnomalyFieldOverridesEditorProps["onResetField"];
  applyPreset: (preset: Exclude<Preset, "custom">) => void;
}

function FieldAccordionItem({
  fieldMeta,
  override,
  isOverridden,
  preset,
  effective,
  parentEnabled,
  isLocked,
  onChange,
  onResetField,
  applyPreset,
}: FieldAccordionItemProps) {
  const { isLowPower } = usePerformance();
  const [advancedOpen, setAdvancedOpen] = useState(preset === "custom");
  // Tracks an explicit "Custom" click — needed because clicking Custom doesn't
  // change values, so `detectPreset` still resolves to whatever the prior
  // preset was. Cleared when the user picks a real preset.
  const [manualCustom, setManualCustom] = useState(false);
  const displayedPreset: Preset = manualCustom ? "custom" : preset;
  const field = fieldMeta.path;
  const fieldEnabled = override?.enabled ?? fieldMeta.defaultEnabled;

  const parts = field.split(".");
  const fieldName = parts.pop() || field;
  const pathParts = parts;

  const isCategorical =
    effective.direction === "dominance" ||
    (!effective.direction &&
      (fieldMeta.type === "string" || fieldMeta.type === "boolean"));

  const summary = buildSummary({
    enabled: fieldEnabled,
    isCategorical,
    direction: effective.direction,
    confirmationWindow: effective.confirmationWindow,
    minAbsoluteDelta: effective.minAbsoluteDelta,
    minRelativeDelta: effective.minRelativeDelta,
    unit: fieldMeta.unit,
  });

  const handleResetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onResetField) {
      onResetField(field);
    }
  };

  return (
    <AccordionItem
      value={field}
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden",
        !isLowPower && "transition-all duration-200",
        isOverridden
          ? "border-primary/40 shadow-md"
          : "border-border/40 opacity-80 hover:opacity-100",
      )}
    >
      <AccordionTrigger className="px-5 py-4 hover:no-underline">
        <div className="flex items-center justify-between flex-1 gap-4 mr-4">
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
            {isOverridden && onResetField && !isLocked && (
              <button
                type="button"
                onClick={handleResetClick}
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                title="Reset this field to plugin defaults"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
            {isOverridden ? (
              <Badge
                variant={fieldEnabled ? "default" : "secondary"}
                className="text-[10px] uppercase tracking-wider font-semibold"
              >
                {fieldEnabled ? "Custom" : "Ignored"}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wider font-semibold opacity-50"
              >
                Default
              </Badge>
            )}
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-5 pt-2 pb-5 border-t border-border/30">
        <div className="mt-4 space-y-5">
          {/* Plain-language summary of effective config */}
          <p className="text-xs leading-relaxed text-muted-foreground bg-muted/30 border border-border/40 rounded-md px-3 py-2">
            {summary}
          </p>

          {/* Enable/disable */}
          <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                Monitor this field
              </Label>
              <div className="text-xs text-muted-foreground">
                Turn off to ignore anomalies for this metric.
              </div>
            </div>
            <Toggle
              checked={fieldEnabled}
              onCheckedChange={(val) => onChange(field, "enabled", val)}
              disabled={!parentEnabled || isLocked}
            />
          </div>

          {fieldEnabled && (
            <>
              {/* Layer 1: Sensitivity preset */}
              {!isCategorical && (
                <PresetSelector
                  value={displayedPreset}
                  onChange={(p) => {
                    if (p === "custom") {
                      setManualCustom(true);
                      setAdvancedOpen(true);
                      return;
                    }
                    setManualCustom(false);
                    applyPreset(p);
                  }}
                  disabled={!parentEnabled || isLocked}
                />
              )}

              {/* Layer 2: Behavior */}
              <BehaviorSelector
                value={override?.direction ?? "auto"}
                pluginDefault={fieldMeta.defaultDirection}
                onChange={(val) =>
                  onChange(
                    field,
                    "direction",
                    val === "auto" ? undefined : val,
                  )
                }
                disabled={!parentEnabled || isLocked}
              />

              {/* Layer 3: Advanced (collapsed by default unless preset is "custom") */}
              <AdvancedDisclosure
                open={advancedOpen}
                onToggle={() => setAdvancedOpen((v) => !v)}
              >
                <AdvancedControls
                  field={field}
                  fieldMeta={fieldMeta}
                  override={override}
                  effective={effective}
                  isCategorical={isCategorical}
                  parentEnabled={parentEnabled}
                  isLocked={isLocked}
                  onChange={onChange}
                />
              </AdvancedDisclosure>
            </>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

interface PresetSelectorProps {
  value: Preset;
  onChange: (preset: Preset) => void;
  disabled?: boolean;
}

function PresetSelector({ value, onChange, disabled }: PresetSelectorProps) {
  const { isLowPower } = usePerformance();
  const options: Preset[] = ["strict", "balanced", "relaxed", "custom"];
  const description =
    value === "custom"
      ? "Custom — fine-tuned values that don't match a preset. Edit them in the advanced section below."
      : PRESET_COPY[value].description;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
          Sensitivity preset
        </Label>
        <Tooltip content="Presets bundle sensitivity, confirmation window, and noise floors into one choice. Pick Custom to fine-tune each value." />
      </div>
      <div className="inline-flex items-stretch p-1 border rounded-lg bg-muted/30 gap-0.5">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              disabled={disabled}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-md",
                !isLowPower && "transition-all",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                "disabled:opacity-50 disabled:cursor-not-allowed capitalize",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
      <p className="text-[10.5px] text-muted-foreground leading-relaxed pt-1">
        {description}
      </p>
    </div>
  );
}

interface BehaviorSelectorProps {
  value: AnomalyDirection | "auto";
  pluginDefault?: AnomalyDirection;
  onChange: (value: AnomalyDirection | "auto") => void;
  disabled?: boolean;
}

function BehaviorSelector({
  value,
  pluginDefault,
  onChange,
  disabled,
}: BehaviorSelectorProps) {
  const selectedOption =
    DIRECTION_OPTIONS.find((o) => o.value === value) ?? DIRECTION_OPTIONS[0];
  const Icon = selectedOption.icon;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
          Behavior
        </Label>
        <Tooltip content="Tells the detector which direction is bad. Auto-detect uses the plugin's recommendation." />
      </div>
      <Select
        value={value}
        onValueChange={(val) => onChange(val as AnomalyDirection | "auto")}
        disabled={disabled}
      >
        <SelectTrigger className="h-10 transition-colors bg-background/50 focus:bg-background">
          <SelectValue placeholder="Auto-detect">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="truncate">{selectedOption.label}</span>
              {value === "auto" && pluginDefault && (
                <span className="text-[10px] text-muted-foreground italic ml-1 truncate">
                  (plugin: {DIRECTION_OPTIONS.find((o) => o.value === pluginDefault)?.label})
                </span>
              )}
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DIRECTION_OPTIONS.map((opt) => {
            const OptIcon = opt.icon;
            return (
              <SelectItem key={opt.value} value={opt.value}>
                <div className="flex items-start gap-2 py-0.5">
                  <OptIcon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm">{opt.label}</span>
                    <span className="text-[10.5px] text-muted-foreground leading-snug">
                      {opt.description}
                    </span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

interface AdvancedDisclosureProps {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AdvancedDisclosure({
  open,
  onToggle,
  children,
}: AdvancedDisclosureProps) {
  const { isLowPower } = usePerformance();
  return (
    <div className="border border-border/40 rounded-md bg-background/30">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>Advanced</span>
        <ChevronDown
          className={cn(
            "w-4 h-4",
            !isLowPower && "transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="px-4 pt-1 pb-4 border-t border-border/30 space-y-5">
          {children}
        </div>
      )}
    </div>
  );
}

interface AdvancedControlsProps {
  field: string;
  fieldMeta: AnomalyFieldMeta;
  override: AnomalyFieldConfig | undefined;
  effective: EffectiveFieldConfig;
  isCategorical: boolean;
  parentEnabled: boolean;
  isLocked?: boolean;
  onChange: AnomalyFieldOverridesEditorProps["onChange"];
}

function AdvancedControls({
  field,
  fieldMeta,
  override,
  effective,
  isCategorical,
  parentEnabled,
  isLocked,
  onChange,
}: AdvancedControlsProps) {
  const disabled = !parentEnabled || isLocked;

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2 pt-4">
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              {isCategorical ? "Stability threshold" : "Sensitivity"}
            </Label>
            <Tooltip
              content={
                isCategorical
                  ? "Required dominance ratio = 0.9 × sensitivity. Lower = alerts even on noisier baselines."
                  : "Multiplier on the μ ± 3σ band. Higher = wider band = fewer alerts."
              }
            />
          </div>
          <div className="px-1 pt-2 pb-1">
            <Slider
              value={[effective.sensitivity]}
              min={0.5}
              max={3}
              step={0.1}
              onValueChange={(val) => onChange(field, "sensitivity", val[0])}
              disabled={disabled}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-1">
            <span>0.5 (more alerts)</span>
            <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
              {effective.sensitivity.toFixed(1)}x
            </span>
            <span>3.0 (fewer)</span>
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Confirmation window
            </Label>
            <Tooltip content="Number of consecutive bad checks required before raising an alert. Higher = fewer false positives from one-off blips." />
          </div>
          <div className="px-1 pt-2 pb-1">
            <Slider
              value={[effective.confirmationWindow]}
              min={1}
              max={10}
              step={1}
              onValueChange={(val) =>
                onChange(field, "confirmationWindow", val[0])
              }
              disabled={disabled}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-1">
            <span>1 run</span>
            <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
              {effective.confirmationWindow} runs
            </span>
            <span>10 runs</span>
          </div>
        </div>
      </div>

      {!isCategorical && (
        <div className="grid gap-5 pt-4 border-t lg:grid-cols-2 border-border/30">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Min absolute Δ {fieldMeta.unit ? `(${fieldMeta.unit})` : ""}
              </Label>
              <Tooltip content="Anomaly only fires when the value differs from the recent average by at least this amount. Suppresses tiny absolute swings on low-baseline metrics." />
            </div>
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={effective.minAbsoluteDelta}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = raw === "" ? Number.NaN : Number(raw);
                const next =
                  raw === ""
                    ? (undefined as number | undefined)
                    : !Number.isFinite(parsed) || parsed < 0
                      ? null
                      : parsed;
                if (next === null) return;
                onChange(field, "minAbsoluteDelta", next);
              }}
              disabled={disabled}
              className="h-10 transition-colors bg-background/50 focus:bg-background"
            />
            <p className="text-[10.5px] text-muted-foreground leading-relaxed">
              Anomaly only fires when the value differs from the recent average
              by at least this amount. Use 0 to disable.
              {fieldMeta.defaultMinAbsoluteDelta !== undefined &&
                fieldMeta.defaultMinAbsoluteDelta > 0 &&
                override?.minAbsoluteDelta === undefined && (
                  <span className="ml-1 italic opacity-70">
                    Plugin default: {fieldMeta.defaultMinAbsoluteDelta}
                    {fieldMeta.unit ? ` ${fieldMeta.unit}` : ""}.
                  </span>
                )}
            </p>
          </div>

          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Min relative Δ (%)
              </Label>
              <Tooltip content="Anomaly only fires when the proportional change exceeds this percentage of the recent average. Suppresses small proportional changes on high-magnitude metrics." />
            </div>
            <Input
              type="number"
              min={0}
              max={100}
              step="any"
              inputMode="decimal"
              value={(effective.minRelativeDelta * 100).toString()}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = raw === "" ? Number.NaN : Number(raw);
                const next =
                  raw === ""
                    ? (undefined as number | undefined)
                    : !Number.isFinite(parsed) || parsed < 0
                      ? null
                      : parsed / 100;
                if (next === null) return;
                onChange(field, "minRelativeDelta", next);
              }}
              disabled={disabled}
              className="h-10 transition-colors bg-background/50 focus:bg-background"
            />
            <p className="text-[10.5px] text-muted-foreground leading-relaxed">
              Anomaly only fires when the proportional change exceeds this
              percentage of the recent average. Use 0 to disable.
              {fieldMeta.defaultMinRelativeDelta !== undefined &&
                fieldMeta.defaultMinRelativeDelta > 0 &&
                override?.minRelativeDelta === undefined && (
                  <span className="ml-1 italic opacity-70">
                    Plugin default:{" "}
                    {(fieldMeta.defaultMinRelativeDelta * 100).toFixed(0)}%.
                  </span>
                )}
            </p>
          </div>
        </div>
      )}

      {!isCategorical && (
        <div className="grid gap-5 pt-4 border-t lg:grid-cols-3 border-border/30">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Trend drift
              </Label>
              <Tooltip content="Catches gradual degradation that never triggers a single-spike alert." />
            </div>
            <div className="flex items-center justify-between p-2 border rounded-md bg-muted/30">
              <span className="text-xs text-muted-foreground">
                {effective.driftEnabled ? "Detecting drift" : "Drift muted"}
              </span>
              <Toggle
                checked={effective.driftEnabled}
                onCheckedChange={(val) => onChange(field, "driftEnabled", val)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="flex flex-col space-y-2 lg:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Drift threshold
              </Label>
              <Tooltip content="|slope × n| > threshold × σ × sensitivity. Higher = only sharper trends qualify as drift." />
            </div>
            <div className="px-1 pt-2 pb-1">
              <Slider
                value={[effective.driftThreshold]}
                min={1}
                max={4}
                step={0.1}
                onValueChange={(val) =>
                  onChange(field, "driftThreshold", val[0])
                }
                disabled={disabled || !effective.driftEnabled}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-1">
              <span>1.0 (more)</span>
              <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
                {effective.driftThreshold.toFixed(1)}σ
              </span>
              <span>4.0 (fewer)</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function buildSummary({
  enabled,
  isCategorical,
  direction,
  confirmationWindow,
  minAbsoluteDelta,
  minRelativeDelta,
  unit,
}: {
  enabled: boolean;
  isCategorical: boolean;
  direction: AnomalyDirection | undefined;
  confirmationWindow: number;
  minAbsoluteDelta: number;
  minRelativeDelta: number;
  unit?: string;
}): string {
  if (!enabled) {
    return "Anomaly detection is off for this field.";
  }
  if (isCategorical) {
    return `Alerts when the value flips from its dominant state for ${confirmationWindow} consecutive ${pluralize("check", confirmationWindow)}.`;
  }
  const verb = describeBehavior(direction);
  const checks = `${confirmationWindow} consecutive ${pluralize("check", confirmationWindow)}`;
  const floors: string[] = [];
  if (minAbsoluteDelta > 0) {
    floors.push(`at least ${minAbsoluteDelta}${unit ? ` ${unit}` : ""}`);
  }
  if (minRelativeDelta > 0) {
    floors.push(`at least ${(minRelativeDelta * 100).toFixed(0)}%`);
  }
  const floorClause =
    floors.length > 0 ? ` and the change is ${floors.join(" or ")}` : "";
  return `Alerts when the value ${verb} the recent baseline for ${checks}${floorClause}.`;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
