import React from "react";
import { CheckCircle, AlertTriangle } from "lucide-react";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";

/**
 * Coarse status filter buckets for run-history surfaces. "Failing"
 * collapses degraded and unhealthy because operators investigating a
 * problem usually care about "anything not green" rather than the
 * degraded/unhealthy distinction.
 */
export type StatusFilter = "all" | "healthy" | "failing";

export const STATUS_FILTER_TO_STATUSES: Record<
  StatusFilter,
  HealthCheckStatus[] | undefined
> = {
  all: undefined,
  healthy: ["healthy"],
  failing: ["degraded", "unhealthy"],
};

interface StatusFilterPillsProps {
  value: StatusFilter;
  onChange: (next: StatusFilter) => void;
}

const OPTIONS: {
  value: StatusFilter;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  activeClass: string;
}[] = [
  {
    value: "all",
    label: "All",
    activeClass: "bg-primary text-primary-foreground",
  },
  {
    value: "healthy",
    label: "Healthy",
    icon: CheckCircle,
    activeClass: "bg-success text-white",
  },
  {
    value: "failing",
    label: "Failing",
    icon: AlertTriangle,
    activeClass: "bg-destructive text-destructive-foreground",
  },
];

export function StatusFilterPills({ value, onChange }: StatusFilterPillsProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Status:</span>
      <div className="flex items-center gap-1">
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
                active
                  ? opt.activeClass
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {Icon && <Icon className="h-3 w-3" />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
