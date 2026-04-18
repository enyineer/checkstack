import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import { SloApi } from "../api";
import { SLO_STATUS_CHANGED, sloRoutes } from "@checkstack/slo-common";
import { resolveRoute } from "@checkstack/common";
import { ErrorBudgetBar } from "./ErrorBudgetBar";
import { BurnRateIndicator } from "./BurnRateIndicator";
import { Card, CardContent, CardHeader, CardTitle } from "@checkstack/ui";
import { Target } from "lucide-react";
import { Link } from "react-router-dom";

type Props = SlotContext<typeof SystemDetailsTopSlot>;

/**
 * SLO panel embedded in the system detail page.
 * Shows all SLO objectives for the system with error budget bars.
 */
export const SystemSloPanel: React.FC<Props> = ({ system }) => {
  const sloClient = usePluginClient(SloApi);

  const { data: objectives, refetch } =
    sloClient.getObjectivesForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id },
    );

  useSignal(SLO_STATUS_CHANGED, ({ systemId }) => {
    if (system?.id && systemId === system.id) {
      void refetch();
    }
  });

  if (!objectives || objectives.length === 0) return;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Target className="w-4 h-4" />
          Service Level Objectives
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {objectives.map((item) => (
            <Link
              key={item.objective.id}
              to={resolveRoute(sloRoutes.routes.detail, {
                sloId: item.objective.id,
              })}
              className="block space-y-2 rounded-md border border-border p-3 transition-colors hover:border-primary/50 no-underline"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {item.objective.target}% / {item.objective.windowDays}d
                </span>
                <BurnRateIndicator burnRate={item.status.burnRate} />
              </div>
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
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {item.status.currentAvailability?.toFixed(3) ?? "—"}%
                  availability
                </span>
                <span>
                  {item.status.errorBudgetRemainingMinutes.toFixed(1)} min
                  remaining
                </span>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
