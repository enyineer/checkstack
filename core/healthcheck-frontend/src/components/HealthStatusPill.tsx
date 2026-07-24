import React from "react";
import { StatusPill } from "@checkstack/ui";
import type { StatusTone } from "./healthcheckDisplay.logic";

interface HealthStatusPillProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

/**
 * The health-check status pill: this package's `tone` + `label` shape over the
 * shared pill in `@checkstack/ui`. Kept as a named component because it is used
 * across five healthcheck surfaces; only the chrome moved.
 */
export const HealthStatusPill: React.FC<HealthStatusPillProps> = ({
  tone,
  label,
  className,
}) => (
  <StatusPill tone={tone} className={className}>
    {label}
  </StatusPill>
);
