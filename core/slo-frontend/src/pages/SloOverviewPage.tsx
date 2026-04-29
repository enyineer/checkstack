import React, { useMemo } from "react";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { SloApi } from "../api";
import { sloRoutes } from "@checkstack/slo-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { ErrorBudgetBar } from "../components/ErrorBudgetBar";
import { BurnRateIndicator } from "../components/BurnRateIndicator";
import { MilestoneFeed } from "../components/MilestoneFeed";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageLayout,
  EmptyState,
  LoadingSpinner,
  Badge,
} from "@checkstack/ui";
import { Target, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { resolveRoute } from "@checkstack/common";

const SloOverviewPageContent: React.FC = () => {
  const sloClient = usePluginClient(SloApi);
  const catalogClient = usePluginClient(CatalogApi);

  const { data: objectivesData, isLoading: objectivesLoading } =
    sloClient.listObjectives.useQuery({});

  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  const objectives = objectivesData?.objectives ?? [];
  const isLoading = objectivesLoading || systemsLoading;

  const systemNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const system of systemsData?.systems ?? []) {
      map.set(system.id, system.name);
    }
    return map;
  }, [systemsData]);

  return (
    <PageLayout
      title="SLO Dashboard"
      subtitle="Service Level Objective performance across all systems"
      icon={Target}
      actions={
        <Link
          to={resolveRoute(sloRoutes.routes.config)}
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          Manage SLOs
          <ArrowRight className="w-4 h-4" />
        </Link>
      }
    >
      {isLoading ? (
        <div className="p-12 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : objectives.length === 0 ? (
        <EmptyState
          title="No SLOs configured"
          description="Define Service Level Objectives to track reliability."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {objectives.map((item) => (
              <Link
                key={item.objective.id}
                to={resolveRoute(sloRoutes.routes.detail, {
                  sloId: item.objective.id,
                })}
                className="block no-underline"
              >
                <Card className="transition-colors hover:border-primary/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {systemNameMap.get(item.objective.systemId) ??
                          item.objective.systemId}
                      </CardTitle>
                      {item.status.isBreaching ? (
                        <Badge variant="destructive">Breaching</Badge>
                      ) : item.status.hasOpenDowntime ? (
                        <Badge variant="warning">Degraded</Badge>
                      ) : item.status.errorBudgetRemainingPercent <= 20 ? (
                        <Badge variant="warning">At Risk</Badge>
                      ) : (
                        <Badge variant="success">Healthy</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg font-semibold mb-2">
                      {item.objective.target}% / {item.objective.windowDays}d
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
                    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                      <span>
                        {item.status.currentAvailability?.toFixed(3) ?? "—"}%
                      </span>
                      <BurnRateIndicator burnRate={item.status.burnRate} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <div className="lg:sticky lg:top-4 self-start">
            <MilestoneFeed />
          </div>
        </div>
      )}
    </PageLayout>
  );
};

export const SloOverviewPage = wrapInSuspense(SloOverviewPageContent);
