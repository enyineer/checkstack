import React from "react";
import type { StateThresholds } from "@checkstack/healthcheck-common";

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "@checkstack/ui";

interface ThresholdsPanelProps {
  thresholds: StateThresholds;
  onChange: (thresholds: StateThresholds) => void;
  onSave: () => void;
  saving: boolean;
}

/**
 * Panel for configuring health check evaluation thresholds.
 * Supports two modes: consecutive (streak-based) and window (count in last N runs).
 */
export const ThresholdsPanel: React.FC<ThresholdsPanelProps> = ({
  thresholds,
  onChange,
  onSave,
  saving,
}) => {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">State Thresholds</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Configure how health check results determine the system&apos;s status.
        </p>
      </div>

      {/* Mode Selector */}
      <div className="p-4 bg-muted/50 rounded-lg border">
        <div className="flex items-center gap-2 mb-2">
          <Label className="text-sm font-medium">Evaluation Mode</Label>
          <Tooltip content="How health status is calculated based on check results" />
        </div>
        <Select
          value={thresholds.mode}
          onValueChange={(value: "consecutive" | "window") => {
            if (value === "consecutive") {
              onChange({
                mode: "consecutive",
                healthy: { minSuccessCount: 1 },
                degraded: { minFailureCount: 2 },
                unhealthy: { minFailureCount: 5 },
              });
            } else {
              onChange({
                mode: "window",
                windowSize: 10,
                degraded: { minFailureCount: 3 },
                unhealthy: { minFailureCount: 7 },
              });
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="consecutive">
              Consecutive (streak-based)
            </SelectItem>
            <SelectItem value="window">
              Window (count in last N runs)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-2">
          {thresholds.mode === "consecutive"
            ? "Status changes when a streak of consecutive results is reached."
            : "Status is based on how many failures occur within a rolling window."}
        </p>
      </div>

      {/* Threshold Cards */}
      {thresholds.mode === "consecutive" ? (
        <div className="space-y-3">
          <ThresholdCard
            status="healthy"
            label="Healthy"
            tooltip="System returns to healthy after this many consecutive successful checks"
            value={thresholds.healthy.minSuccessCount}
            suffix="consecutive ✓"
            onChange={(v) =>
              onChange({ ...thresholds, healthy: { minSuccessCount: v } })
            }
          />
          <ThresholdCard
            status="warning"
            label="Degraded"
            tooltip="System becomes degraded after this many consecutive failures"
            value={thresholds.degraded.minFailureCount}
            suffix="consecutive ✗"
            onChange={(v) =>
              onChange({ ...thresholds, degraded: { minFailureCount: v } })
            }
          />
          <ThresholdCard
            status="destructive"
            label="Unhealthy"
            tooltip="System becomes unhealthy after this many consecutive failures"
            value={thresholds.unhealthy.minFailureCount}
            suffix="consecutive ✗"
            onChange={(v) =>
              onChange({ ...thresholds, unhealthy: { minFailureCount: v } })
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Window Size */}
          <div className="p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Window Size</span>
                <Tooltip content="How many recent runs to analyze when calculating status" />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={3}
                  max={100}
                  value={thresholds.windowSize}
                  onChange={(e) =>
                    onChange({
                      ...thresholds,
                      windowSize: Number.parseInt(e.target.value) || 10,
                    })
                  }
                  className="h-8 w-16 text-center"
                />
                <span className="text-xs text-muted-foreground">runs</span>
              </div>
            </div>
          </div>

          <ThresholdCard
            status="warning"
            label="Degraded"
            tooltip="System becomes degraded when failures in the window reach this count"
            value={thresholds.degraded.minFailureCount}
            prefix="≥"
            suffix="failures"
            onChange={(v) =>
              onChange({ ...thresholds, degraded: { minFailureCount: v } })
            }
          />
          <ThresholdCard
            status="destructive"
            label="Unhealthy"
            tooltip="System becomes unhealthy when failures in the window reach this count"
            value={thresholds.unhealthy.minFailureCount}
            prefix="≥"
            suffix="failures"
            onChange={(v) =>
              onChange({ ...thresholds, unhealthy: { minFailureCount: v } })
            }
          />
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-2 border-t">
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save Thresholds"}
        </Button>
      </div>
    </div>
  );
};

// =============================================================================
// THRESHOLD CARD — Shared sub-component
// =============================================================================

const STATUS_STYLES = {
  healthy: {
    dot: "bg-success",
    text: "text-success",
    border: "border-success/30",
    bg: "bg-success/5",
  },
  warning: {
    dot: "bg-warning",
    text: "text-warning",
    border: "border-warning/30",
    bg: "bg-warning/5",
  },
  destructive: {
    dot: "bg-destructive",
    text: "text-destructive",
    border: "border-destructive/30",
    bg: "bg-destructive/5",
  },
} as const;

function ThresholdCard({
  status,
  label,
  tooltip,
  value,
  prefix,
  suffix,
  onChange,
}: {
  status: keyof typeof STATUS_STYLES;
  label: string;
  tooltip: string;
  value: number;
  prefix?: string;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const styles = STATUS_STYLES[status];
  return (
    <div className={`p-3 rounded-lg border ${styles.border} ${styles.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${styles.dot}`} />
          <span className={`text-sm font-medium ${styles.text}`}>{label}</span>
          <Tooltip content={tooltip} />
        </div>
        <div className="flex items-center gap-2">
          {prefix && (
            <span className="text-xs text-muted-foreground">{prefix}</span>
          )}
          <Input
            type="number"
            min={1}
            value={value}
            onChange={(e) => onChange(Number.parseInt(e.target.value) || 1)}
            className="h-8 w-16 text-center"
          />
          <span className="text-xs text-muted-foreground w-20">{suffix}</span>
        </div>
      </div>
    </div>
  );
}

// Re-export DEFAULT_STATE_THRESHOLDS for convenience
export { DEFAULT_STATE_THRESHOLDS } from "@checkstack/healthcheck-common";
