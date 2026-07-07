import { useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  usePluginClient,
  useQueryClient,
  wrapInSuspense,
  accessApiRef,
  useApi,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import {
  type HealthCheckConfiguration,
  healthcheckRoutes,
  healthCheckAccess,
  healthCheckResourceTypes,
  pluginMetadata as healthcheckPluginMetadata,
} from "@checkstack/healthcheck-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { Tip, TipBanner } from "@checkstack/tips-frontend";
import {
  HealthCheckList,
  HealthCheckListSkeleton,
} from "../components/HealthCheckList";
import { HealthCheckListToolbar } from "../components/HealthCheckListToolbar";
import {
  filterAndSortHealthChecks,
  hasActiveHealthCheckFilter,
} from "../components/healthCheckListState.logic";
import { useHealthCheckListState } from "../hooks/useHealthCheckListState";
import { FirstCheckWizard } from "../components/FirstCheckWizard";
import {
  Button,
  ConfirmationModal,
  ListEmptyState,
  PageLayout,
  QueryErrorState,
  useToast,
  toastError,
} from "@checkstack/ui";
import { Plus, History, Activity, ExternalLink, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { resolveRoute, APP_DOC_SLUGS, docsPath } from "@checkstack/common";

/**
 * In-app deep-link to the Health checks concept page (same-origin Starlight
 * build served at `/checkstack/*`). Slug is centralised in `APP_DOC_SLUGS` and
 * guarded against renames by `docs-links.test.ts`.
 */
const DOCS_HEALTH_CHECKS = docsPath(APP_DOC_SLUGS.healthChecks);

/** Inline "Learn more" link to the health-checks concept docs. */
const HealthCheckLearnMore = () => (
  <a
    href={DOCS_HEALTH_CHECKS}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline"
  >
    Learn more
    <ExternalLink className="h-3 w-3" />
  </a>
);
import { useState } from "react";

/**
 * Shape of the `healthcheck.getConfigurations` query output. Threaded
 * through the optimistic pause/resume patches so cache reads/writes
 * match the loader's surface.
 */
type ConfigurationsQueryData = {
  configurations: HealthCheckConfiguration[];
};

const HealthCheckConfigPageContent = () => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const catalogClient = usePluginClient(CatalogApi);
  const queryClient = useQueryClient();
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    state: listState,
    debouncedQuery,
    setQuery,
    setStrategy,
    setStatus,
    setSystem,
    clearFilters,
  } = useHealthCheckListState();
  const { allowed: canRead, loading: readLoading } = accessApi.useAccess(
    healthCheckAccess.configuration.read,
  );
  // Surface gate: matches the route guard's `manageCapability`. A team-scoped
  // user (a create-capability grant, or a per-config team grant) has no GLOBAL
  // read rule, so gating the page on `canRead` alone showed them "Access Denied"
  // even though the route let them in. `useCanAccessType` resolves the same
  // capability the route uses, so the page and the route agree.
  const { allowed: canManageSurface, loading: surfaceLoading } =
    accessApi.useCanAccessType({
      accessRule: healthCheckAccess.configuration.manage,
      objectType: healthCheckResourceTypes.configuration,
    });
  const accessLoading = readLoading || surfaceLoading;
  const { allowed: canManage } = accessApi.useProcedureAccess(
    HealthCheckApi.contract.createConfiguration,
  );

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [idToDelete, setIdToDelete] = useState<string | undefined>();

  // Mirrors oRPC's `generateOperationKey([path], { type, input })` for
  // the parameterless `getConfigurations` loader. Captured in a memo so
  // the pause/resume optimistic patches address the exact same cache
  // entry the loader writes. See `docs/frontend/optimistic-updates.md`
  // for the query-key contract.
  const configurationsQueryKey = useMemo(
    () =>
      [
        ["healthcheck", "getConfigurations"],
        { input: {}, type: "query" },
      ] as const,
    [],
  );

  // Fetch configurations with useQuery
  const configurationsQuery = healthCheckClient.getConfigurations.useQuery({});
  const {
    data: configurationsData,
    refetch: refetchConfigurations,
  } = configurationsQuery;

  // Fetch strategies with useQuery
  const { data: strategies = [] } = healthCheckClient.getStrategies.useQuery(
    {},
  );

  const configurations = useMemo(
    () => configurationsData?.configurations ?? [],
    [configurationsData],
  );

  // Systems list for the "assigned to system X" filter. Lazily loaded: the
  // query is only enabled once the user has read access AND there are
  // configurations to filter, so a fresh install with no checks doesn't ping
  // the catalog backend.
  const systemsQuery = catalogClient.getSystems.useQuery(
    {},
    { enabled: canRead && configurations.length > 0 },
  );
  const systems = systemsQuery.data?.systems ?? [];

  // When a system filter is active, resolve the set of config ids assigned to
  // that system via `getSystemConfigurations`. A configuration carries no
  // system field of its own — the assignment is a separate entity — so the
  // filter intersects this id set with the loaded configurations. `undefined`
  // while loading (the filter logic shows nothing until the set resolves, to
  // avoid a flash of the unfiltered superset).
  const systemFilterActive = listState.systemId !== null;
  const systemConfigsQuery =
    healthCheckClient.getSystemConfigurations.useQuery(
      { systemId: listState.systemId ?? "" },
      { enabled: systemFilterActive },
    );
  const assignedConfigIds = useMemo((): Set<string> | null | undefined => {
    if (!systemFilterActive) return null;
    if (systemConfigsQuery.isLoading) return;
    return new Set((systemConfigsQuery.data ?? []).map((c) => c.id));
  }, [
    systemFilterActive,
    systemConfigsQuery.isLoading,
    systemConfigsQuery.data,
  ]);

  const filteredConfigurations = useMemo(
    () =>
      filterAndSortHealthChecks({
        configurations,
        state: { ...listState, query: debouncedQuery },
        assignedConfigIds,
      }),
    [configurations, listState, debouncedQuery, assignedConfigIds],
  );

  const hasActiveFilter = hasActiveHealthCheckFilter({
    ...listState,
    query: debouncedQuery,
  });

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      // Clear the URL param and navigate to the create flow
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
      navigate(resolveRoute(healthcheckRoutes.routes.create));
    }
  }, [searchParams, canManage, setSearchParams, navigate]);

  // Mutations
  const deleteMutation = healthCheckClient.deleteConfiguration.useMutation({
    onSuccess: () => {
      setIsDeleteModalOpen(false);
      setIdToDelete(undefined);
      void refetchConfigurations();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete health check", error);
    },
  });

  // Mutation: Pause configuration — optimistic.
  //
  // Toggle, low risk; same four-step pattern as `markAsRead` on the
  // notifications page (see `docs/frontend/optimistic-updates.md`):
  // 1. onMutate flips `paused: true` on the matching row in the cache.
  // 2. onError rolls back from the snapshot, then surfaces a toast.
  // 3. onSettled invalidates so server truth settles in either branch.
  // 4. No success toast — the row's pause badge IS the feedback.
  const pauseMutation = healthCheckClient.pauseConfiguration.useMutation<{
    previous: ConfigurationsQueryData | undefined;
  }>({
    onMutate: async ({ id: configId }) => {
      await queryClient.cancelQueries({ queryKey: configurationsQueryKey });
      const previous = queryClient.getQueryData<ConfigurationsQueryData>(
        configurationsQueryKey,
      );
      if (previous) {
        queryClient.setQueryData<ConfigurationsQueryData>(
          configurationsQueryKey,
          {
            ...previous,
            configurations: previous.configurations.map((c) =>
              c.id === configId ? { ...c, paused: true } : c,
            ),
          },
        );
      }
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(configurationsQueryKey, ctx.previous);
      }
      toastError(toast, "Failed to pause health check", error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: configurationsQueryKey,
      });
    },
  });

  // Mutation: Resume configuration — optimistic. Mirror of `pause`
  // with `paused: false`. See `pauseMutation` above for the contract.
  const resumeMutation = healthCheckClient.resumeConfiguration.useMutation<{
    previous: ConfigurationsQueryData | undefined;
  }>({
    onMutate: async ({ id: configId }) => {
      await queryClient.cancelQueries({ queryKey: configurationsQueryKey });
      const previous = queryClient.getQueryData<ConfigurationsQueryData>(
        configurationsQueryKey,
      );
      if (previous) {
        queryClient.setQueryData<ConfigurationsQueryData>(
          configurationsQueryKey,
          {
            ...previous,
            configurations: previous.configurations.map((c) =>
              c.id === configId ? { ...c, paused: false } : c,
            ),
          },
        );
      }
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(configurationsQueryKey, ctx.previous);
      }
      toastError(toast, "Failed to resume health check", error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: configurationsQueryKey,
      });
    },
  });

  const handleCreate = () => {
    navigate(resolveRoute(healthcheckRoutes.routes.create));
  };

  const handleEdit = (config: HealthCheckConfiguration) => {
    navigate(
      resolveRoute(healthcheckRoutes.routes.edit, { configId: config.id }),
    );
  };

  const handleDelete = (id: string) => {
    setIdToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (!idToDelete) return;
    deleteMutation.mutate({ id: idToDelete });
  };

  // Guided "create your first check" flow (new system + HTTP check + assignment
  // in one go), surfaced from the empty state for new operators.
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <PageLayout
      title="Health Checks"
      subtitle="Manage health check configurations"
      icon={Activity}
      loading={accessLoading}
      allowed={canRead || canManageSurface}
      actions={
        <div className="flex gap-2">
          {/* History is usable by anyone with the manage CAPABILITY (global
              manage, or any team grant) - not just create-capable users - so
              it gates on the same surface capability as the history route. */}
          {canManageSurface && (
            <Button variant="outline" asChild>
              <Link to={resolveRoute(healthcheckRoutes.routes.history)}>
                <History className="mr-2 h-4 w-4" /> View History
              </Link>
            </Button>
          )}
          {canManage && (
            <Button variant="outline" onClick={() => setIsWizardOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4" /> Quick start
            </Button>
          )}
          <Tip
            plugin={healthcheckPluginMetadata}
            id="create"
            title="Health checks bring systems to life"
            description={
              <>
                Each check decides what 'healthy' means for one of your systems -
                an HTTP endpoint returning 200, a TCP port being open, a Postgres
                query succeeding, anything you can express. Failed checks flip
                the system's health status, notify subscribers, and burn SLO
                error budget. They do NOT auto-open incidents - those are
                reported by hand when there's a real outage.{" "}
                <HealthCheckLearnMore />
              </>
            }
            side="bottom"
            align="end"
          >
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" /> Create Check
            </Button>
          </Tip>
        </div>
      }
    >
      <TipBanner
        plugin={healthcheckPluginMetadata}
        id="config.intro"
        title="What health checks do"
        description={
          <>
            A health check is a probe that runs on a schedule and decides whether
            one of your systems is healthy. Failing checks flip that system's
            status, notify subscribers, and burn SLO error budget - but they do
            not open incidents automatically. <HealthCheckLearnMore />
          </>
        }
      />

      {configurationsQuery.isLoading ? (
        <HealthCheckListSkeleton />
      ) : configurationsQuery.isError ? (
        <QueryErrorState
          error={configurationsQuery.error}
          onRetry={() => void configurationsQuery.refetch()}
          resource="health checks"
        />
      ) : configurations.length === 0 ? (
        <ListEmptyState
          resource="health checks"
          description="The quickest way to start is the guided setup: name a system, paste a URL, and we create and start monitoring it for you."
          actions={
            canManage ? (
              <Button onClick={() => setIsWizardOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Create your first check
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <HealthCheckListToolbar
            state={listState}
            onQueryChange={setQuery}
            onStrategyChange={setStrategy}
            onStatusChange={setStatus}
            onSystemChange={setSystem}
            onClearFilters={clearFilters}
            strategies={strategies}
            systems={systems}
            systemAssignmentsLoading={
              systemFilterActive && systemConfigsQuery.isLoading
            }
            hasActiveFilter={hasActiveFilter}
          />

          {systemFilterActive && systemConfigsQuery.isLoading ? (
            <HealthCheckListSkeleton />
          ) : filteredConfigurations.length === 0 ? (
            <ListEmptyState
              resource="health checks"
              description="No health checks match the current search or filters."
              actions={
                hasActiveFilter ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <HealthCheckList
              configurations={filteredConfigurations}
              strategies={strategies}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onPause={(id) => pauseMutation.mutate({ id })}
              onResume={(id) => resumeMutation.mutate({ id })}
            />
          )}
        </div>
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Health Check"
        message="Are you sure you want to delete this health check configuration? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      <FirstCheckWizard
        open={isWizardOpen}
        onOpenChange={setIsWizardOpen}
        onCreated={() => void configurationsQuery.refetch()}
      />
    </PageLayout>
  );
};

export const HealthCheckConfigPage = wrapInSuspense(
  HealthCheckConfigPageContent,
);
