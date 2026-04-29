import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  Badge,
} from "@checkstack/ui";
import { Link } from "react-router-dom";
import {
  catalogRoutes,
  type System,
} from "@checkstack/catalog-common";
import { resolveRoute } from "@checkstack/common";
import { type AnomalyDto } from "@checkstack/anomaly-common";
import { formatDistanceToNow } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anomalies: AnomalyDto[];
  systems: System[];
}

export const AnomalyOverviewSheet: React.FC<Props> = ({
  open,
  onOpenChange,
  anomalies,
  systems,
}) => {
  // Map of systemId -> systemName
  const systemMap = new Map(systems.map((s) => [s.id, s.name]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="flex flex-row items-start justify-between gap-4 pt-6">
          <div className="flex flex-col gap-1 text-left">
            <SheetTitle>Active Anomalies</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Overview of unusual system behavior
            </p>
          </div>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-3 pb-8">
          {anomalies.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No active anomalies
            </p>
          ) : (
            anomalies.map((anomaly) => {
              const systemName = systemMap.get(anomaly.systemId) || anomaly.systemId;
              const deviationText = anomaly.deviation 
                ? `${anomaly.deviation.toFixed(1)}σ`
                : "unusual";

              return (
                <Link
                  key={anomaly.id}
                  to={resolveRoute(catalogRoutes.routes.systemDetail, { systemId: anomaly.systemId })}
                  onClick={() => onOpenChange(false)}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 hover:border-primary/50 hover:shadow-sm transition-all text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="font-medium text-foreground">
                      {systemName}
                    </h4>
                    <Badge variant="warning" className="flex-shrink-0 font-mono">
                      {deviationText}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Metric
                    </span>
                    <span className="text-sm font-mono text-foreground break-all">
                      {anomaly.fieldPath}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                    <span className="font-mono">
                      Observed: {anomaly.observedValue} <span className="opacity-70">(~{anomaly.baselineValue})</span>
                    </span>
                    <span>
                      {formatDistanceToNow(new Date(anomaly.startedAt), { addSuffix: true })}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};
