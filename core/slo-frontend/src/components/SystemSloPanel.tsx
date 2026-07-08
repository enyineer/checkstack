import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import { SloApi } from "../api";
import { sloRoutes } from "@checkstack/slo-common";
import { resolveRoute } from "@checkstack/common";
import { ErrorBudgetBar } from "./ErrorBudgetBar";
import { BurnRateIndicator } from "./BurnRateIndicator";
import { cn, formatPercent } from "@checkstack/ui";
import { Target } from "lucide-react";
import { Link } from "react-router-dom";

/** Shared card elevation used by the system-overview panels. */
const PANEL_SHADOW =
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

type Props = SlotContext<typeof SystemDetailsTopSlot>;

/**
 * Compact SLO panel embedded in the system detail page alert strip.
 * Shows SLO objectives with error budget bars in a minimal layout.
 */
export const SystemSloPanel: React.FC<Props> = ({ system }) => {
  const sloClient = usePluginClient(SloApi);

  const { data: objectives } = sloClient.getObjectivesForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id },
  );

  if (!objectives || objectives.length === 0) return;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface",
        PANEL_SHADOW,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/50 px-[var(--d-pad)] py-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">SLO</span>
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {objectives.map((item) => (
          <Link
            key={item.objective.id}
            to={resolveRoute(sloRoutes.routes.detail, {
              sloId: item.objective.id,
            })}
            className="flex items-center gap-3 px-[var(--d-pad)] py-2.5 transition-colors hover:bg-muted/50 no-underline"
          >
            <div className="flex items-center gap-2 min-w-0 shrink-0">
              <span className="text-xs font-medium whitespace-nowrap">
                {item.objective.target}% / {item.objective.windowDays}d
              </span>
              <BurnRateIndicator burnRate={item.status.burnRate} />
            </div>
            <div className="flex-1 min-w-0">
              <ErrorBudgetBar
                consumedPercent={
                  100 - item.status.errorBudgetRemainingPercent
                }
                warningThreshold={
                  item.objective.burnRateThresholds.warningPercent
                }
                criticalThreshold={
                  item.objective.burnRateThresholds.criticalPercent
                }
              />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
              {item.status.currentAvailability === null
                ? "—"
                : formatPercent(item.status.currentAvailability, {
                    alreadyPercent: true,
                    fractionDigits: 3,
                  })}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
};
