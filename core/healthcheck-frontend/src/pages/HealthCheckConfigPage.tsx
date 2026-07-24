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
import { CatalogApi, catalogResourceTypes } from "@checkstack/catalog-common";
import { Tip, TipBanner } from "@checkstack/tips-frontend";
import {
  HealthCheckList,
  HealthCheckListSkeleton,
} from "../components/HealthCheckList";
import {
  healthCheckFacetIds,
  healthCheckSystemControl,
  selectedSystemId,
} from "../components/healthCheckFacets";
import { FirstCheckWizard } from "../components/FirstCheckWizard";
import {
  Button,
  ConfirmationModal,
  ListEmptyState,
  PageLayout,
  QueryErrorState,
  useDataTableFilters,
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
  // Filter state lives in the URL, so a filtered view is shareable and comes
  // back intact from a check's editor. The bar is rendered by the page rather
  // than by the table because the SYSTEM dimension is applied server-side (see
  // below) - a mix the table cannot own on its own.
  const filters = useDataTableFilters({ facetIds: healthCheckFacetIds });
  const { allowed: canRead, loading: readLoading } = accessApi.useAccess(
    healthCheckAccess.configuration.read,
  );
  // Surface gate: matches the route guard's `manageCapability`. A team-scoped
  // user (a create-capability grant, or a per-config team grant) has no GLOBAL
  // read rule, so gating the page on `canRead` alone showed them "Access Denied"
  // even though the route let them in. `useCanAccessType` resolves the same
  // capability the route uses, so the page and the route agree. `parentType`
  // additionally admits SYSTEM managers (the catalog's "Manage health checks"
  // link lands here with a ?system= filter).
  const { allowed: canManageSurface, loading: surfaceLoading } =
    accessApi.useCanAccessType({
      accessRule: healthCheckAccess.configuration.manage,
      objectType: healthCheckResourceTypes.configuration,
      parentType: catalogResourceTypes.system,
    });
  // Config-PLANE capability (no parentType): may the caller read/list
  // configurations at all? `getConfigurations` is listKey-gated on healthcheck
  // grants - for a PURE system manager it is a guaranteed 403, so the list
  // query below only runs for config-plane callers and the system-filtered
  // view renders from `getSystemConfigurations` (system-read gated) instead.
  const { allowed: hasConfigCapability, loading: configCapabilityLoading } =
    accessApi.useCanAccessType({
      accessRule: healthCheckAccess.configuration.manage,
      objectType: healthCheckResourceTypes.configuration,
    });
  const configPlaneReader = canRead || hasConfigCapability;
  const accessLoading =
    readLoading || surfaceLoading || configCapabilityLoading;
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

  // Fetch configurations with useQuery. Gated on config-plane capability:
  // for a pure system manager the listKey-filtered proc is a guaranteed 403
  // (they hold no healthcheck grants), and their view is the system-filtered
  // one below anyway.
  const configurationsQuery = healthCheckClient.getConfigurations.useQuery(
    {},
    { enabled: configPlaneReader },
  );
  const {
    data: configurationsData,
    refetch: refetchConfigurations,
  } = configurationsQuery;

  // Fetch strategies with useQuery (typeScoped on the healthcheck type -
  // same config-plane gate as the list; the strategy filter/labels degrade
  // gracefully to raw ids without it).
  const { data: strategies = [] } = healthCheckClient.getStrategies.useQuery(
    {},
    { enabled: configPlaneReader },
  );

  const configurations = useMemo(
    () => configurationsData?.configurations ?? [],
    [configurationsData],
  );

  // When a system filter is active, the list renders DIRECTLY from
  // `getSystemConfigurations` (full configuration objects, authorized by
  // system READ) instead of intersecting with `getConfigurations`. This is
  // what makes the catalog's per-system wayfinding link work for a pure
  // system manager, whose `getConfigurations` is empty/forbidden - an
  // intersection would always come up empty for them.
  const systemId = selectedSystemId({ filters: filters.state });
  const systemFilterActive = systemId !== undefined;
  const systemConfigsQuery =
    healthCheckClient.getSystemConfigurations.useQuery(
      { systemId: systemId ?? "" },
      { enabled: systemFilterActive },
    );

  // Systems list for the "assigned to system X" filter. Lazily loaded: only
  // once there are configurations to filter (so a fresh install with no
  // checks doesn't ping the catalog backend), or immediately when a system
  // filter is already in the URL (to resolve its display name).
  const systemsQuery = catalogClient.getSystems.useQuery(
    {},
    {
      enabled:
        (configPlaneReader && configurations.length > 0) || systemFilterActive,
    },
  );
  // Memoised because it feeds the facet-control memo below: a fresh `[]` on
  // every render would rebuild the controls (and so the whole bar) each time.
  const systemsData = systemsQuery.data;
  const systems = useMemo(() => systemsData?.systems ?? [], [systemsData]);

  // The rows to hand the table: system-scoped when that filter is active (the
  // server applies it by swapping the data source), otherwise everything. The
  // table applies search / strategy / status itself.
  const listedConfigurations = useMemo(
    () =>
      systemFilterActive ? (systemConfigsQuery.data ?? []) : configurations,
    [systemFilterActive, systemConfigsQuery.data, configurations],
  );

  // The one dimension no column owns: it has nothing on the row to read,
  // because selecting a system changes WHICH rows are fetched.
  const systemControl = useMemo(
    () => healthCheckSystemControl({ systems }),
    [systems],
  );

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

      {(systemFilterActive
        ? systemConfigsQuery.isLoading
        : configurationsQuery.isLoading) ? (
        <HealthCheckListSkeleton />
      ) : (
          systemFilterActive
            ? systemConfigsQuery.isError
            : configurationsQuery.isError
        ) ? (
        <QueryErrorState
          error={
            systemFilterActive
              ? systemConfigsQuery.error
              : configurationsQuery.error
          }
          onRetry={() =>
            void (systemFilterActive
              ? systemConfigsQuery.refetch()
              : configurationsQuery.refetch())
          }
          resource="health checks"
        />
      ) : !systemFilterActive && configurations.length === 0 ? (
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
          <HealthCheckList
            // The FULL set: the table owns search, strategy and status. Only the
            // system dimension is applied before this point, by swapping the
            // data source (it is authorized by system READ).
            configurations={listedConfigurations}
            strategies={strategies}
            filters={filters.state}
            onFiltersChange={filters.setState}
            onClearFilters={filters.clear}
            facets={[systemControl]}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onPause={(id) => pauseMutation.mutate({ id })}
            onResume={(id) => resumeMutation.mutate({ id })}
            // "Nothing here yet" is handled above, before the table renders, so
            // an empty row set at this point always means the filters excluded
            // everything.
            noResultsState={
              <ListEmptyState
                resource="health checks"
                description="No health checks match the current search or filters."
                actions={
                  filters.active ? (
                    <Button variant="outline" onClick={filters.clear}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            }
          />
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
