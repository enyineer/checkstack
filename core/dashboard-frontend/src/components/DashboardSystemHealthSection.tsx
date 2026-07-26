import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  usePluginClient,
  ExtensionSlot,
  useSlotExtensions,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import {
  CatalogApi,
  catalogAccess,
  catalogRoutes,
  SystemSignalsSlot,
  type SystemSignalsMap,
  type SystemSignalTone,
} from "@checkstack/catalog-common";
import { resolveRoute } from "@checkstack/common";
import {
  SectionHeader,
  EmptyState,
  ErrorState,
  Button,
  Skeleton,
  cn,
  usePerformance,
} from "@checkstack/ui";
import { LayoutGrid, Server, Activity, ArrowRight, ShieldCheck } from "lucide-react";
import { FleetHealthHeader } from "./FleetHealthHeader";
import { ProblemSystemCard } from "./ProblemSystemCard";
import { DashboardAllClear } from "./DashboardAllClear";
import {
  buildProblemSystems,
  countByTone,
  mergeSignalsBySystem,
  type SignalsBySource,
} from "../logic/systemSignals";

/** Headline for the problem list when an active severity filter has no matches. */
const filterEmptyTitle = (tone: SystemSignalTone): string => {
  switch (tone) {
    case "error": {
      return "No critical systems";
    }
    case "warn": {
      return "No degraded systems";
    }
    case "info": {
      return "No systems on watch";
    }
    default: {
      return "No matching systems";
    }
  }
};

/**
 * Dashboard section: the fleet-health overview and problem-system list.
 *
 * Registered as a DashboardSlot extension with priority 10. Owns the signal
 * aggregation boundary: renders the headless {@link SystemSignalsSlot} so
 * every plugin can report per-system signals, then merges them to drive the
 * overview. Self-contained: fetches its own entities query (react-query
 * dedupes with other dashboard sections) and access checks.
 */
export const DashboardSystemHealthSection: React.FC = () => {
  const { isLowPower } = usePerformance();
  const catalogClient = usePluginClient(CatalogApi);
  const navigate = useNavigate();
  const accessApi = useApi(accessApiRef);
  const { allowed: canManageCatalog } = accessApi.useAccess(
    catalogAccess.system.manage,
  );
  const { allowed: canViewCatalog } = accessApi.useAccess(
    catalogAccess.system.read,
  );

  const [activeTone, setActiveTone] = useState<SystemSignalTone | null>(null);

  const entitiesQuery = catalogClient.getEntities.useQuery(
    {},
    { staleTime: 30_000 },
  );
  const {
    data: entitiesData,
    isLoading: entitiesLoading,
    isError: entitiesError,
  } = entitiesQuery;

  const systems = useMemo(() => entitiesData?.systems ?? [], [entitiesData]);
  const systemIds = useMemo(() => systems.map((s) => s.id), [systems]);
  const systemMap = useMemo(
    () => new Map(systems.map((s) => [s.id, s])),
    [systems],
  );

  const [signalsBySource, setSignalsBySource] = useState<SignalsBySource>({});

  const handleSignals = useCallback(
    (sourceId: string, signals: SystemSignalsMap) => {
      setSignalsBySource((prev) =>
        prev[sourceId] === signals ? prev : { ...prev, [sourceId]: signals },
      );
    },
    [],
  );

  // Signal sources report asynchronously; before any has loaded, zero signals
  // reads as "all systems healthy". Hold the overview on its loading skeleton
  // until every mounted source has REPORTED and none is loading.
  // `expectedSignalSources` is the count of registered fillers; `reportedSources`
  // fills as each filler reports (covering already-cached sources that settle
  // without ever reporting `true`); `loadingSources` drains as each settles.
  const signalFillers = useSlotExtensions(SystemSignalsSlot);
  const expectedSignalSources = signalFillers.length;
  const [loadingSources, setLoadingSources] = useState<Set<string>>(new Set());
  const [reportedSources, setReportedSources] = useState<Set<string>>(
    new Set(),
  );
  const [signalGraceElapsed, setSignalGraceElapsed] = useState(false);

  const handleLoadingChange = useCallback(
    (sourceId: string, loading: boolean) => {
      setReportedSources((prev) =>
        prev.has(sourceId) ? prev : new Set(prev).add(sourceId),
      );
      setLoadingSources((prev) => {
        if (loading === prev.has(sourceId)) return prev;
        const next = new Set(prev);
        if (loading) next.add(sourceId);
        else next.delete(sourceId);
        return next;
      });
    },
    [],
  );

  const problems = useMemo(
    () => buildProblemSystems(mergeSignalsBySystem(signalsBySource)),
    [signalsBySource],
  );
  const counts = useMemo(() => countByTone(problems), [problems]);

  const visibleProblems = useMemo(
    () =>
      activeTone
        ? problems.filter((p) => p.worstTone === activeTone)
        : problems,
    [problems, activeTone],
  );

  const systemsCount = systems.length;
  const healthyCount = Math.max(systemsCount - problems.length, 0);
  const catalogHref = resolveRoute(catalogRoutes.routes.home);

  // The overview stays on its loading skeleton until the signal sources settle.
  // Requires systems to exist (nothing to load otherwise) and at least one
  // source registered. Settled = every mounted source has reported AND none is
  // loading; the grace period bounds the wait so a non-reporting source cannot
  // hang it.
  const signalsSettling =
    systemsCount > 0 &&
    expectedSignalSources > 0 &&
    !signalGraceElapsed &&
    (reportedSources.size < expectedSignalSources || loadingSources.size > 0);

  // Bound the signal-loading wait: once systems are known, a source that never
  // reports settled (e.g. a misbehaving third-party filler) cannot hold the
  // overview on its skeleton indefinitely.
  useEffect(() => {
    if (entitiesLoading || systemsCount === 0) return;
    const timer = setTimeout(() => setSignalGraceElapsed(true), 10_000);
    return () => clearTimeout(timer);
  }, [entitiesLoading, systemsCount]);

  const renderOverview = () => {
    if (entitiesLoading || signalsSettling) {
      // Held until the signal sources settle too, so an empty problem list can't
      // briefly render as "all systems healthy" before anything has loaded.
      return (
        <div className="space-y-[var(--d-gap)]">
          <Skeleton variant="chart" />
          <div className="grid gap-[var(--d-gap)] md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="card" />
            ))}
          </div>
        </div>
      );
    }

    if (entitiesError) {
      return (
        <ErrorState
          title="Couldn't load systems"
          description="The system health overview is temporarily unavailable. Retry in a moment."
          onRetry={() => entitiesQuery.refetch()}
        />
      );
    }

    if (systemsCount === 0) {
      return (
        <EmptyState
          icon={<Server className="w-12 h-12" />}
          title="Nothing to show on the dashboard yet"
          description="Add the systems you want to monitor and attach health checks. Anything that needs attention will surface here automatically."
          steps={[
            "Open the Catalog and add the systems you want to monitor.",
            "Group related systems together (e.g. one group per team).",
            "Attach health checks so the dashboard surfaces issues the moment they appear.",
          ]}
          actions={
            canManageCatalog ? (
              <Button
                onClick={() =>
                  navigate(resolveRoute(catalogRoutes.routes.config))
                }
              >
                <LayoutGrid className="w-4 h-4 mr-2" />
                Open Catalog
              </Button>
            ) : undefined
          }
        />
      );
    }

    return (
      <div className="space-y-[var(--d-gap)]">
        <FleetHealthHeader
          systemsCount={systemsCount}
          problemsCount={problems.length}
          counts={counts}
          healthyCount={healthyCount}
          activeTone={activeTone}
          onToneSelect={setActiveTone}
          isLowPower={isLowPower}
        />
        {problems.length === 0 ? (
          <DashboardAllClear
            systemsCount={systemsCount}
            isLowPower={isLowPower}
          />
        ) : activeTone && visibleProblems.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-12 w-12 text-status-ok" />}
            title={filterEmptyTitle(activeTone)}
            description="Nothing matches this filter right now. Clear it to see everything that needs attention."
            actions={
              <Button variant="outline" onClick={() => setActiveTone(null)}>
                Show all
              </Button>
            }
          />
        ) : (
          <div className="grid gap-[var(--d-gap)] md:grid-cols-2">
            {visibleProblems.map((problem) => {
              const system = systemMap.get(problem.systemId);
              if (!system) return null;
              return (
                <ProblemSystemCard
                  key={problem.systemId}
                  system={system}
                  problem={problem}
                  isLowPower={isLowPower}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/*
        Headless, render-once aggregation boundary. Every plugin fills
        SystemSignalsSlot with its bulk per-system state; this section merges
        the reports to drive the overview. The dashboard is agnostic to which
        plugins contribute - third-party plugins participate the same way.
      */}
      <ExtensionSlot
        slot={SystemSignalsSlot}
        context={{
          systemIds,
          onSignals: handleSignals,
          onLoadingChange: handleLoadingChange,
        }}
      />

      <section>
        <SectionHeader
          title="System health"
          icon={<Activity className="h-5 w-5" />}
          actions={
            systemsCount > 0 && canViewCatalog ? (
              <Link
                to={catalogHref}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline",
                  !isLowPower && "transition-colors",
                )}
              >
                View catalog
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : undefined
          }
        />
        {renderOverview()}
      </section>
    </>
  );
};
