import React from "react";
import { Link } from "react-router-dom";
import { cn, formatPercent } from "@checkstack/ui";
import { ErrorBudgetBar } from "./ErrorBudgetBar";
import { BurnRateIndicator } from "./BurnRateIndicator";
import {
  classifySloStatus,
  presentSloStatus,
  type StatusTone,
} from "./sloDisplay.logic";

/**
 * Per-tone class sets for the status pill, dot, and the card's left accent
 * stripe. Spelled out as full literal strings (not interpolated) so Tailwind's
 * JIT keeps them, and driven by the colorblind-safe status triad.
 */
const toneStyles: Record<
  StatusTone,
  { pill: string; dot: string; accent: string }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
  },
};

export interface SloObjectiveCardProps {
  systemName: string;
  detailHref: string;
  target: number;
  windowDays: number;
  warningThreshold: number;
  criticalThreshold: number;
  status: {
    isBreaching: boolean;
    hasOpenDowntime: boolean;
    errorBudgetRemainingPercent: number;
    currentAvailability: number | null;
    burnRate: number | null;
  };
}

/**
 * A single SLO objective on the dashboard: a number-led availability readout,
 * a multi-encoded status (hue + dot + label + left accent stripe), and the
 * error-budget + burn-rate signals. The whole card is a link to the detail
 * view; its accessible name still leads with the system name.
 */
export const SloObjectiveCard: React.FC<SloObjectiveCardProps> = ({
  systemName,
  detailHref,
  target,
  windowDays,
  warningThreshold,
  criticalThreshold,
  status,
}) => {
  const tier = classifySloStatus(status);
  const { label, tone } = presentSloStatus({ tier });
  const styles = toneStyles[tone];

  const consumedPercent = 100 - status.errorBudgetRemainingPercent;

  return (
    <Link to={detailHref} className="group block h-full no-underline">
      <div className="relative flex h-full flex-col overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl group-hover:shadow-primary/10">
        {/* Status accent stripe: status by position + hue, not color alone. */}
        <span
          className={cn("absolute inset-y-0 left-0 w-1", styles.accent)}
          aria-hidden
        />

        <div className="flex items-start justify-between gap-3 pl-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {systemName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Target {target}% &middot; {windowDays}d window
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              styles.pill,
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", styles.dot)}
              aria-hidden
            />
            {label}
          </span>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 pl-2">
          <div>
            <p className="text-3xl font-bold leading-none tabular-nums text-foreground">
              {status.currentAvailability === null
                ? "—"
                : formatPercent(status.currentAvailability, {
                    alreadyPercent: true,
                    fractionDigits: 3,
                  })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">availability</p>
          </div>
          <BurnRateIndicator burnRate={status.burnRate} />
        </div>

        <div className="mt-4 pl-2">
          <ErrorBudgetBar
            label="Error budget"
            consumedPercent={consumedPercent}
            warningThreshold={warningThreshold}
            criticalThreshold={criticalThreshold}
          />
        </div>
      </div>
    </Link>
  );
};
