import React, { useMemo } from "react";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { SloApi } from "../api";
import { sloRoutes } from "@checkstack/slo-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { SloObjectiveCard } from "../components/SloObjectiveCard";
import { MilestoneFeed } from "../components/MilestoneFeed";
import {
  PageLayout,
  EmptyState,
  LoadingSpinner,
  QueryErrorState,
} from "@checkstack/ui";
import { Target, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { resolveRoute } from "@checkstack/common";

const SloOverviewPageContent: React.FC = () => {
  const sloClient = usePluginClient(SloApi);
  const catalogClient = usePluginClient(CatalogApi);

  const objectivesQuery = sloClient.listObjectives.useQuery({});
  const systemsQuery = catalogClient.getSystems.useQuery({});

  const { data: objectivesData, isLoading: objectivesLoading } = objectivesQuery;
  const { data: systemsData, isLoading: systemsLoading } = systemsQuery;

  const objectives = objectivesData?.objectives ?? [];
  const isLoading = objectivesLoading || systemsLoading;
  const isError = objectivesQuery.isError || systemsQuery.isError;

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
      ) : isError ? (
        <QueryErrorState
          error={objectivesQuery.error ?? systemsQuery.error}
          onRetry={() => {
            void objectivesQuery.refetch();
            void systemsQuery.refetch();
          }}
          resource="SLOs"
        />
      ) : objectives.length === 0 ? (
        <EmptyState
          icon={<Target className="size-10" />}
          title="No SLOs configured"
          description="SLOs translate uptime into a target - “healthy 99.9% of the time over 30 days” - and let you track the error budget per system. This dashboard lights up once you've defined at least one."
          steps={[
            "Open SLO management to create your first objective.",
            "Pick the system, the target percentage and the rolling window.",
            "Come back here for an at-a-glance view of every SLO and its remaining error budget.",
          ]}
          actions={
            <Link
              to={resolveRoute(sloRoutes.routes.config)}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              Manage SLOs
              <ArrowRight className="w-4 h-4" />
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          {/* content-start: this grid is stretched to the sidebar's height by
              the outer items-stretch grid; without it, the default align-content
              stretches the card rows to fill that height. Keep cards content-sized
              while h-full still makes cards within a row match each other. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
            {objectives.map((item) => (
              <SloObjectiveCard
                key={item.objective.id}
                systemName={
                  systemNameMap.get(item.objective.systemId) ??
                  item.objective.systemId
                }
                detailHref={resolveRoute(sloRoutes.routes.detail, {
                  sloId: item.objective.id,
                })}
                target={item.objective.target}
                windowDays={item.objective.windowDays}
                warningThreshold={
                  item.objective.burnRateThresholds.warningPercent
                }
                criticalThreshold={
                  item.objective.burnRateThresholds.criticalPercent
                }
                status={item.status}
              />
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
