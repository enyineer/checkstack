import React from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "../utils";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

interface HealthBadgeProps {
  status: HealthStatus;
  variant?: "compact" | "full";
  showIcon?: boolean;
  className?: string;
}

const statusConfig = {
  healthy: {
    icon: CheckCircle2,
    label: "Healthy",
    className: "bg-success/10 text-success border-success/30",
    iconClassName: "text-success",
  },
  degraded: {
    icon: AlertTriangle,
    label: "Degraded",
    className: "bg-warning/10 text-warning border-warning/30",
    iconClassName: "text-warning",
  },
  unhealthy: {
    icon: XCircle,
    label: "Unhealthy",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    iconClassName: "text-destructive",
  },
} as const;

export const HealthBadge: React.FC<HealthBadgeProps> = ({
  status,
  variant = "full",
  showIcon = true,
  className,
}) => {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isCompact = variant === "compact";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        config.className,
        className
      )}
    >
      {showIcon && <Icon className={cn("h-3.5 w-3.5", config.iconClassName)} />}
      {!isCompact && <span>{config.label}</span>}
    </span>
  );
};
