import React, { useMemo } from "react";
import { useParams } from "react-router-dom";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SloApi } from "../api";
import { SLO_STATUS_CHANGED } from "@checkstack/slo-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { ErrorBudgetBar } from "../components/ErrorBudgetBar";
import { BurnRateIndicator } from "../components/BurnRateIndicator";
import { StreakCounter } from "../components/StreakCounter";
import { AttributionChart } from "../components/AttributionChart";
import { DowntimeTimeline } from "../components/DowntimeTimeline";
import { SloTrendChart } from "../components/SloTrendChart";
import {
  AchievementBadge,
  NoAchievements,
} from "../components/AchievementBadge";
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
  Flame,
  Award,
  BarChart3,
  LineChart,
} from "lucide-react";
import { subDays } from "date-fns";

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

  const { data: streaksData } = sloClient.getStreaks.useQuery({});

  const { data: systemData } = catalogClient.getSystem.useQuery(
    { systemId: data?.objective?.systemId ?? "" },
    { enabled: !!data?.objective?.systemId },
  );

  const { data: achievementsData } = sloClient.getAchievements.useQuery(
    { systemId: data?.objective?.systemId ?? "" },
    { enabled: !!data?.objective?.systemId },
  );

  const snapshotWindowDays = data?.objective?.windowDays ?? 30;
  const snapshotRange = useMemo(() => ({
    startDate: subDays(new Date(), snapshotWindowDays),
    endDate: new Date(),
  }), [snapshotWindowDays]);

  const { data: snapshotsData } = sloClient.getDailySnapshots.useQuery(
    {
      objectiveId: sloId ?? "",
      ...snapshotRange,
    },
    { enabled: !!sloId },
  );

  const events = eventsData?.events;

  useSignal(SLO_STATUS_CHANGED, ({ objectiveId }) => {
    if (objectiveId === sloId) {
      void refetch();
      void refetchEvents();
    }
  });

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

  // Find streak for this objective
  const streak = streaksData?.streaks.find(
    (s) => s.objectiveId === objective.id,
  );

  // Filter achievements for this system
  const achievements = achievementsData?.achievements ?? [];

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

      {/* Streak & Achievements Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Flame className="w-4 h-4" />
              Compliance Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            {streak ? (
              <StreakCounter
                currentStreak={streak.currentStreak}
                bestStreak={streak.bestStreak}
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                Streaks will be calculated after the first daily snapshot
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Award className="w-4 h-4" />
              Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {achievements.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {achievements.map((a) => (
                  <AchievementBadge
                    key={a.id}
                    achievement={a.achievement}
                    unlockedAt={a.unlockedAt}
                  />
                ))}
              </div>
            ) : (
              <NoAchievements />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attribution Chart */}
      {status.attribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Budget Attribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttributionChart
              attribution={status.attribution}
              totalBudgetMinutes={status.errorBudgetTotalMinutes}
            />
          </CardContent>
        </Card>
      )}

      {/* Availability Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <LineChart className="w-4 h-4" />
            Availability Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SloTrendChart
            snapshots={snapshotsData?.snapshots ?? []}
            target={objective.target}
          />
        </CardContent>
      </Card>

      {/* Downtime Events Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Recent Downtime Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DowntimeTimeline events={events ?? []} />
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const SloDetailPage = wrapInSuspense(SloDetailPageContent);
