import React, { useState, useMemo } from "react";
import { subDays, subHours } from "date-fns";
import { DateTimePicker } from "./DateTimePicker";
import { Button } from "./Button";
import { Calendar } from "lucide-react";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export enum DateRangePreset {
  Last24Hours = "24h",
  Last7Days = "7d",
  Last30Days = "30d",
  Custom = "custom",
}

export interface DateRangeFilterProps {
  value: DateRange;
  /** Called when a preset is clicked (immediate) */
  onChange: (range: DateRange) => void;
  /** Optional: Called when custom date picker values change (for debounced Apply pattern) */
  onCustomChange?: (range: DateRange) => void;
  /** Disable all interactions (buttons and date pickers) */
  disabled?: boolean;
  className?: string;
}

export const PRESETS: Array<{
  id: DateRangePreset;
  label: string;
  shortLabel: string;
}> = [
  { id: DateRangePreset.Last24Hours, label: "Last 24h", shortLabel: "24h" },
  { id: DateRangePreset.Last7Days, label: "Last 7 days", shortLabel: "7d" },
  { id: DateRangePreset.Last30Days, label: "Last 30 days", shortLabel: "30d" },
  { id: DateRangePreset.Custom, label: "Custom", shortLabel: "Custom" },
];

export function getPresetRange(preset: DateRangePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case DateRangePreset.Last24Hours: {
      return { startDate: subHours(now, 24), endDate: now };
    }
    case DateRangePreset.Last7Days: {
      return { startDate: subDays(now, 7), endDate: now };
    }
    case DateRangePreset.Last30Days: {
      return { startDate: subDays(now, 30), endDate: now };
    }
    case DateRangePreset.Custom: {
      return { startDate: subDays(now, 7), endDate: now };
    }
  }
}

export function detectPreset(range: DateRange): DateRangePreset {
  const now = new Date();
  const diffMs = now.getTime() - range.startDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours <= 25 && diffHours >= 23) return DateRangePreset.Last24Hours;
  if (diffDays <= 8 && diffDays >= 6) return DateRangePreset.Last7Days;
  if (diffDays <= 31 && diffDays >= 29) return DateRangePreset.Last30Days;
  return DateRangePreset.Custom;
}

/**
 * Date range filter with preset buttons and custom date pickers.
 */
export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  value,
  onChange,
  onCustomChange,
  disabled = false,
  className,
}) => {
  const activePreset = useMemo(() => detectPreset(value), [value]);
  const [showCustom, setShowCustom] = useState(
    activePreset === DateRangePreset.Custom,
  );

  const handlePresetClick = (preset: DateRangePreset) => {
    if (disabled) return;
    if (preset === DateRangePreset.Custom) {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      onChange(getPresetRange(preset));
    }
  };

  // Use onCustomChange if provided, otherwise fall back to onChange
  const handleCustomDateChange = onCustomChange ?? onChange;

  // Validate date range
  const isInvalidRange = showCustom && value.startDate >= value.endDate;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-muted-foreground shrink-0">
          Time range:
        </span>
        <div className="flex gap-1 flex-wrap">
          {PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={
                activePreset === preset.id && !showCustom
                  ? "primary"
                  : preset.id === DateRangePreset.Custom && showCustom
                    ? "primary"
                    : "outline"
              }
              size="sm"
              onClick={() => handlePresetClick(preset.id)}
              disabled={disabled}
            >
              <span className="sm:hidden">{preset.shortLabel}</span>
              <span className="hidden sm:inline">{preset.label}</span>
            </Button>
          ))}
        </div>
        {showCustom && (
          <>
            <div className="w-px h-5 bg-border hidden sm:block" />
            {/* Desktop: inline with right arrow */}
            <div className="hidden sm:flex items-center gap-2">
              <DateTimePicker
                value={value.startDate}
                onChange={(startDate) => {
                  if (startDate && !disabled) {
                    handleCustomDateChange({ ...value, startDate });
                  }
                }}
                maxDate={value.endDate}
                disabled={disabled}
              />
              <span className="text-sm text-muted-foreground">→</span>
              <DateTimePicker
                value={value.endDate}
                onChange={(endDate) => {
                  if (endDate && !disabled) {
                    handleCustomDateChange({ ...value, endDate });
                  }
                }}
                minDate={value.startDate}
                maxDate={new Date()}
                disabled={disabled}
              />
            </div>
            {/* Mobile: stacked vertically with down arrow, centered */}
            <div className="flex sm:hidden flex-col items-center gap-1 w-full">
              <DateTimePicker
                value={value.startDate}
                onChange={(startDate) => {
                  if (startDate && !disabled) {
                    handleCustomDateChange({ ...value, startDate });
                  }
                }}
                maxDate={value.endDate}
                disabled={disabled}
              />
              <span className="text-sm text-muted-foreground">↓</span>
              <DateTimePicker
                value={value.endDate}
                onChange={(endDate) => {
                  if (endDate && !disabled) {
                    handleCustomDateChange({ ...value, endDate });
                  }
                }}
                minDate={value.startDate}
                maxDate={new Date()}
                disabled={disabled}
              />
            </div>
          </>
        )}
      </div>
      {isInvalidRange && (
        <p className="text-sm text-destructive mt-2">
          Start date must be before end date
        </p>
      )}
    </div>
  );
};

/** Create a default date range (last 7 days) */
export function getDefaultDateRange(): DateRange {
  return getPresetRange(DateRangePreset.Last7Days);
}
