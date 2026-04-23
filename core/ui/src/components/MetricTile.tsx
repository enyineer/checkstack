import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";

const metricTileVariants = cva(
  "flex items-center gap-3 rounded-lg border bg-card p-3 min-w-0",
  {
    variants: {
      variant: {
        default: "border-border",
        success: "border-success/30 bg-success/5",
        warning: "border-warning/30 bg-warning/5",
        destructive: "border-destructive/30 bg-destructive/5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface MetricTileProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof metricTileVariants> {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
}

export const MetricTile: React.FC<MetricTileProps> = ({
  icon: Icon,
  label,
  value,
  subtitle,
  variant,
  className,
  ...props
}) => (
  <div className={cn(metricTileVariants({ variant }), className)} {...props}>
    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className="text-sm font-semibold truncate">{value}</p>
      {subtitle && (
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      )}
    </div>
  </div>
);
