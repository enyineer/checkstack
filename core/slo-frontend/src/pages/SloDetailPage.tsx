import React from "react";
import { useParams } from "react-router-dom";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SloApi } from "../api";
import { SLO_STATUS_CHANGED } from "@checkstack/slo-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { ErrorBudgetBar } from "../components/ErrorBudgetBar";
import { BurnRateIndicator } from "../components/BurnRateIndicator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageLayout,
  LoadingSpinner,
  Badge,
} from "@checkstack/ui";
import {
  Target,
  Clock,
  Shield,
  TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SloDetailPageContent: React.FC = () => {
  const { sloId } = useParams<{ sloId: string }>();
  const sloClient = usePluginClient(SloApi);
  const catalogClient = usePluginClient(CatalogApi);

  const { data, isLoading, refetch } = sloClient.getObjective.useQuery(
    { id: sloId ?? "" },
    { enabled: !!sloId },
  );

  const { data: eventsData, refetch: refetchEvents } =
    sloClient.getDowntimeEvents.useQuery(
      { objectiveId: sloId ?? "", limit: 20 },
      { enabled: !!sloId },
    );

  const events = eventsData?.events;

  useSignal(SLO_STATUS_CHANGED, ({ objectiveId }) => {
    if (objectiveId === sloId) {
      void refetch();
      void refetchEvents();
    }
  });

  const { data: systemData } = catalogClient.getSystem.useQuery(
    { systemId: data?.objective?.systemId ?? "" },
    { enabled: !!data?.objective?.systemId },
  );

  if (isLoading || !data) {
    return (
      <PageLayout title="SLO Detail" icon={Target}>
        <div className="p-12 flex justify-center">
          <LoadingSpinner />
        </div>
      </PageLayout>
    );
  }

  const { objective, status } = data;
  const systemName = systemData?.name ?? objective.systemId;

  return (
    <PageLayout
      title={`${objective.target}% / ${objective.windowDays}d SLO`}
      subtitle={`System: ${systemName}`}
      icon={Target}
    >
      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Current Availability
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {status.currentAvailability?.toFixed(3) ?? "—"}%
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Target: {objective.target}%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Error Budget
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {status.errorBudgetRemainingMinutes.toFixed(1)}
              <span className="text-lg text-muted-foreground"> min</span>
            </div>
            <ErrorBudgetBar
              consumedPercent={100 - status.errorBudgetRemainingPercent}
              warningThreshold={
                objective.burnRateThresholds.warningPercent
              }
              criticalThreshold={
                objective.burnRateThresholds.criticalPercent
              }
              label="Budget consumption"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Burn Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              <BurnRateIndicator burnRate={status.burnRate} />
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {status.isBreaching ? (
                <Badge variant="destructive">Breaching</Badge>
              ) : status.hasOpenDowntime ? (
                <Badge variant="warning">Degraded</Badge>
              ) : (
                <Badge variant="success">Within Budget</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Downtime Events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Downtime Events</CardTitle>
        </CardHeader>
        <CardContent>
          {!events || events.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No downtime events in the current window
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {formatDistanceToNow(new Date(event.startTime), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        event.attributionType === "self"
                          ? "destructive"
                          : "warning"
                      }
                    >
                      {event.attributionType === "self"
                        ? "Self"
                        : `Upstream: ${event.upstreamSystemName ?? event.upstreamSystemId}`}
                    </Badge>
                    {event.durationSeconds !== undefined &&
                      event.durationSeconds !== null && (
                        <span className="text-sm text-muted-foreground">
                          {Math.round(event.durationSeconds / 60)} min
                        </span>
                      )}
                    {event.endTime === null && (
                      <Badge variant="destructive">Ongoing</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const SloDetailPage = wrapInSuspense(SloDetailPageContent);
