import React, { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  usePluginClient,
  ExtensionSlot,
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
import { TipBanner } from "@checkstack/tips-frontend";
import { pluginMetadata as dashboardTipMetadata } from "./pluginMetadata";
import { HEALTH_CHECK_RUN_COMPLETED } from "@checkstack/healthcheck-common";
import { useSignal } from "@checkstack/signal-frontend";
import {
  SectionHeader,
  EmptyState,
  Button,
  LoadingSpinner,
  TerminalFeed,
  type TerminalEntry,
  usePerformance,
  cn,
} from "@checkstack/ui";
import {
  LayoutGrid,
  Server,
  Activity,
  Terminal,
  Lightbulb,
  ArrowRight,
} from "lucide-react";
import { QueueLagAlert } from "@checkstack/queue-frontend";
import { FleetHealthHeader } from "./components/FleetHealthHeader";
import { ProblemSystemCard } from "./components/ProblemSystemCard";
import { DashboardAllClear } from "./components/DashboardAllClear";
import {
  buildProblemSystems,
  countByTone,
  mergeSignalsBySystem,
  type SignalsBySource,
} from "./logic/systemSignals";

const MAX_TERMINAL_ENTRIES = 8;

const statusToVariant = (
  status: string,
): "default" | "success" | "warning" | "error" => {
  switch (status) {
    case "healthy": {
      return "success";
    }
    case "degraded": {
      return "warning";
    }
    case "unhealthy": {
      return "error";
    }
    default: {
      return "default";
    }
  }
};

export const Dashboard: React.FC = () => {
  const { isLowPower } = usePerformance();
  const catalogClient = usePluginClient(CatalogApi);
  const navigate = useNavigate();
  const accessApi = useApi(accessApiRef);
  // The Catalog CONFIG page (add/manage systems) requires manage; "Open Catalog"
  // CTAs point there, so hide them from users who can't reach it. The catalog
  // HOME view only needs read, gating the "View catalog" link.
  const { allowed: canManageCatalog } = accessApi.useAccess(
    catalogAccess.system.manage,
  );
  const { allowed: canViewCatalog } = accessApi.useAccess(
    catalogAccess.system.read,
  );

  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [activeTone, setActiveTone] = useState<SystemSignalTone | null>(null);

  // ----------------------------------------------------------------------- //
  // DATA
  // ----------------------------------------------------------------------- //

  const { data: entitiesData, isLoading: entitiesLoading } =
    catalogClient.getEntities.useQuery({}, { staleTime: 30_000 });

  const systems = useMemo(() => entitiesData?.systems ?? [], [entitiesData]);
  // Stable across renders (derives from the query's stable data ref) so the
  // signal fillers don't re-report in a loop.
  const systemIds = useMemo(() => systems.map((s) => s.id), [systems]);
  const systemMap = useMemo(
    () => new Map(systems.map((s) => [s.id, s])),
    [systems],
  );

  // ----------------------------------------------------------------------- //
  // SIGNAL AGGREGATION (extensible: any plugin fills SystemSignalsSlot)
  // ----------------------------------------------------------------------- //

  const [signalsBySource, setSignalsBySource] = useState<SignalsBySource>({});

  const handleSignals = useCallback(
    (sourceId: string, signals: SystemSignalsMap) => {
      setSignalsBySource((prev) =>
        prev[sourceId] === signals ? prev : { ...prev, [sourceId]: signals },
      );
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

  // ----------------------------------------------------------------------- //
  // SIGNALS
  // ----------------------------------------------------------------------- //

  useSignal(
    HEALTH_CHECK_RUN_COMPLETED,
    ({ systemName, configurationName, status, latencyMs }) => {
      const newEntry: TerminalEntry = {
        id: `${configurationName}-${Date.now()}`,
        timestamp: new Date(),
        content: `${systemName} (${configurationName}) → ${status}`,
        variant: statusToVariant(status),
        suffix: latencyMs === undefined ? undefined : `${latencyMs}ms`,
      };
      setTerminalEntries((prev) =>
        [newEntry, ...prev].slice(0, MAX_TERMINAL_ENTRIES),
      );
    },
  );

  const systemsCount = systems.length;
  const healthyCount = Math.max(systemsCount - problems.length, 0);
  const catalogHref = resolveRoute(catalogRoutes.routes.home);

  // ----------------------------------------------------------------------- //
  // RENDER
  // ----------------------------------------------------------------------- //

  const renderOverview = () => {
    if (entitiesLoading) {
      return <LoadingSpinner />;
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
      <div className="space-y-4">
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
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
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
    <div
      className={cn(
        "space-y-8",
        !isLowPower && "animate-in fade-in duration-500",
      )}
    >
      <QueueLagAlert />

      <TipBanner
        plugin={dashboardTipMetadata}
        id="welcome"
        title="Welcome to Checkstack"
        description={
          <>
            This is your dashboard. It surfaces only the systems that need
            attention right now - everything healthy stays out of your way. To
            bring it to life, add a system in the <strong>Catalog</strong>, then
            attach a health check to it.
          </>
        }
        action={
          canManageCatalog
            ? {
                label: "Open Catalog",
                onClick: () =>
                  navigate(resolveRoute(catalogRoutes.routes.config)),
              }
            : undefined
        }
        actionHint={
          <span className="inline-flex items-center gap-1.5">
            <Lightbulb
              className="size-3.5 shrink-0 text-amber-500"
              aria-hidden="true"
            />
            See a small lightbulb next to a button or control? Click it for a
            short explanation of what that feature does.
          </span>
        }
      />

      {/*
        Headless, render-once aggregation boundary. Every plugin fills
        SystemSignalsSlot with its bulk per-system state; the dashboard merges
        the reports to drive the overview. The dashboard is agnostic to which
        plugins contribute - third-party plugins participate the same way.
      */}
      <ExtensionSlot
        slot={SystemSignalsSlot}
        context={{ systemIds, onSignals: handleSignals }}
      />

      <section>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-primary">
              <Activity className="h-5 w-5" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              System health
            </h2>
          </div>
          {systemsCount > 0 && canViewCatalog && (
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
          )}
        </div>
        {renderOverview()}
      </section>

      {systemsCount > 0 && (
        <section>
          <SectionHeader
            title="Recent activity"
            icon={<Terminal className="w-5 h-5" />}
          />
          <TerminalFeed
            entries={terminalEntries}
            maxEntries={MAX_TERMINAL_ENTRIES}
            maxHeight="320px"
            title="checkstack status --watch"
          />
        </section>
      )}
    </div>
  );
};
