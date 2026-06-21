import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import { SloApi } from "../api";
import { sloRoutes } from "@checkstack/slo-common";
import { resolveRoute } from "@checkstack/common";
import { ErrorBudgetBar } from "./ErrorBudgetBar";
import { BurnRateIndicator } from "./BurnRateIndicator";
import { formatPercent } from "@checkstack/ui";
import { Target } from "lucide-react";
import { Link } from "react-router-dom";

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
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">SLO</span>
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {objectives.map((item) => (
          <Link
            key={item.objective.id}
            to={resolveRoute(sloRoutes.routes.detail, {
              sloId: item.objective.id,
            })}
            className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors no-underline"
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
