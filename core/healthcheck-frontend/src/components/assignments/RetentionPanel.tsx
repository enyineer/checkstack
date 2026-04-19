import React from "react";
import { Button, Input, LoadingSpinner } from "@checkstack/ui";

export interface RetentionData {
  rawRetentionDays: number;
  hourlyRetentionDays: number;
  dailyRetentionDays: number;
  isCustom: boolean;
}

interface RetentionPanelProps {
  data: RetentionData | undefined;
  onFieldChange: (field: string, value: number) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
}

/**
 * Panel for configuring tiered retention periods (raw → hourly → daily).
 */
export const RetentionPanel: React.FC<RetentionPanelProps> = ({
  data,
  onFieldChange,
  onSave,
  onReset,
  saving,
}) => {
  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  const isValidHierarchy =
    data.rawRetentionDays < data.hourlyRetentionDays &&
    data.hourlyRetentionDays < data.dailyRetentionDays;

  return (
    <div className="p-6 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Data Retention</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Configure how long health check run data is retained at each
          aggregation tier.
        </p>
      </div>

      {!data.isCustom && (
        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Using default retention settings. Customize below to override.
        </div>
      )}

      {!isValidHierarchy && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          Retention periods must increase: Raw &lt; Hourly &lt; Daily
        </div>
      )}

      {/* Raw Data */}
      <RetentionTier
        label="Raw Data Retention"
        description="Individual run data before hourly aggregation"
        value={data.rawRetentionDays}
        min={1}
        max={30}
        onChange={(v) => onFieldChange("rawRetentionDays", v)}
      />

      {/* Hourly Aggregates */}
      <RetentionTier
        label="Hourly Aggregates"
        description="Hourly stats before daily rollup"
        value={data.hourlyRetentionDays}
        min={7}
        max={365}
        onChange={(v) => onFieldChange("hourlyRetentionDays", v)}
      />

      {/* Daily Aggregates */}
      <RetentionTier
        label="Daily Aggregates"
        description="Long-term storage before deletion"
        value={data.dailyRetentionDays}
        min={30}
        max={1095}
        onChange={(v) => onFieldChange("dailyRetentionDays", v)}
      />

      {/* Actions */}
      <div className="flex justify-between pt-2 border-t">
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={saving || !data.isCustom}
        >
          Reset to Defaults
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !isValidHierarchy}
        >
          {saving ? "Saving..." : "Save Retention"}
        </Button>
      </div>
    </div>
  );
};

// =============================================================================
// RETENTION TIER — Shared sub-component
// =============================================================================

function RetentionTier({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="p-3 rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{label}</span>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-8 w-20 text-center"
          />
          <span className="text-sm text-muted-foreground w-10">days</span>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_RETENTION_CONFIG } from "@checkstack/healthcheck-common";
