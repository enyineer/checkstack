import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { AnomalyApi } from "@checkstack/anomaly-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from "@checkstack/ui";
import { Activity, AlertTriangle, HelpCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Props = SlotContext<typeof SystemDetailsSlot>;

export const SystemAnomalyWidget: React.FC<Props> = ({ system }) => {
  const anomalyClient = usePluginClient(AnomalyApi);

  const { data: anomalies = [], isLoading } =
    anomalyClient.getAnomalies.useQuery({
      systemId: system.id,
      limit: 10,
    });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            System Anomalies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
            Loading anomalies...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (anomalies.length === 0) {
    return <></>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-warning" />
          System Anomalies
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-col divide-y">
          {anomalies.map((anomaly) => {
            const isSuspicious = anomaly.state === "suspicious";
            const deviationText = anomaly.deviation
              ? `${anomaly.deviation.toFixed(1)}σ`
              : "unusual";

            return (
              <div
                key={anomaly.id}
                className="flex flex-col gap-2 p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isSuspicious ? (
                      <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                    )}
                    <span className="font-mono text-sm break-all">
                      {anomaly.fieldPath}
                    </span>
                  </div>
                  <Badge
                    variant={isSuspicious ? "outline" : "warning"}
                    className={`text-[10px] h-4 px-1.5 font-mono ${isSuspicious ? "border-warning/50 text-warning" : ""}`}
                  >
                    {deviationText}
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                  <span className="font-mono">
                    Observed: {anomaly.observedValue}{" "}
                    <span className="opacity-70">
                      (~{anomaly.baselineValue})
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    {isSuspicious ? "Detected" : "Confirmed"}{" "}
                    {formatDistanceToNow(new Date(anomaly.startedAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
