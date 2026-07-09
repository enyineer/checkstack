import React, { useCallback, useMemo, useState } from "react";
import {
  usePluginClient,
  useApi,
  accessApiRef,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  catalogRoutes,
  catalogAccess,
  catalogResourceTypes,
  CatalogApi,
  type CatalogHealthStatuses,
} from "@checkstack/catalog-common";
import {
  PageLayout,
  EmptyState,
  ListEmptyState,
  QueryErrorState,
  Skeleton,
  Button,
} from "@checkstack/ui";
import { Layers, ArrowRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useCatalogBrowseState } from "../hooks/useCatalogBrowseState";
import { CatalogBrowseToolbar } from "./browse/CatalogBrowseToolbar";
import { CatalogGroupSection } from "./browse/CatalogGroupSection";
import { CatalogBrowseHealth } from "./browse/CatalogBrowseHealth";
import { CatalogBrowseDataBoundary } from "./browse/CatalogBrowseDataBoundary";
import {
  buildBrowseModel,
  collectTagOptions,
} from "./browse/filterEntities.logic";
import { healthStatusesEqual } from "./browse/healthStatuses.logic";

const CatalogPageContent: React.FC = () => {
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  // Create capability: gates the empty-state "Add your first system" action.
  const { allowed: canManage } = accessApi.useProcedureAccess(
    CatalogApi.contract.createSystem,
  );
  // Surface access: gates the "Manage catalog" link. A user who can manage an
  // existing system (via a team) should reach the management page to edit it,
  // even without create capability.
  const { allowed: canAccessManagement } = accessApi.useCanAccessType({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
  });

  const entitiesQuery = catalogClient.getEntities.useQuery({});
  const { data, isLoading, isError } = entitiesQuery;

  const browse = useCatalogBrowseState();

  const systems = useMemo(() => data?.systems ?? [], [data]);
  const groups = useMemo(() => data?.groups ?? [], [data]);

  const tagOptions = useMemo(() => collectTagOptions(systems), [systems]);

  // Bulk health reported by the optional CatalogBrowseHealthSlot filler. `null`
  // until a filler reports (or forever, if no health source is installed). The
  // group rollups + health filter derive from this DATA, never from rendered
  // badges (healthy systems emit no badge).
  const [healthStatuses, setHealthStatuses] =
    useState<CatalogHealthStatuses | null>(null);
  // The filler re-reports a new statuses object on every render/poll; only adopt
  // it when a value actually changed. Returning `prev` unchanged lets React bail
  // out of the re-render, which stops the browse model from recomputing and the
  // system rows from remounting in a loop (so they stay interactive).
  const handleStatuses = useCallback((statuses: CatalogHealthStatuses) => {
    setHealthStatuses((prev) =>
      healthStatusesEqual(prev, statuses) ? prev : statuses,
    );
  }, []);
  const healthEnabled = healthStatuses !== null;

  const systemIds = useMemo(() => systems.map((s) => s.id), [systems]);
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);

  const model = useMemo(
    () =>
      buildBrowseModel({
        systems,
        groups,
        // Filter on the debounced query so typing stays smooth on large lists.
        state: { ...browse.state, query: browse.debouncedQuery },
        statuses: healthStatuses ?? undefined,
      }),
    [systems, groups, browse.state, browse.debouncedQuery, healthStatuses],
  );

  const manageLink = (
    <Link
      to={resolveRoute(catalogRoutes.routes.config)}
      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      Manage catalog
      <ArrowRight className="w-4 h-4" />
    </Link>
  );

  return (
    <PageLayout
      title="Catalog"
      subtitle="Browse every system, grouped the way your teams think about them"
      icon={Layers}
      actions={canAccessManagement ? manageLink : undefined}
    >
      {isLoading ? (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-9 w-full max-w-xs rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : isError ? (
        <QueryErrorState
          error={entitiesQuery.error}
          onRetry={() => entitiesQuery.refetch()}
          resource="systems"
        />
      ) : model.isEmptyCatalog ? (
        <EmptyState
          icon={<Layers className="size-10" />}
          title="No systems in the catalog yet"
          description="Systems are the things Checkstack keeps an eye on - services, hosts, jobs, databases. Almost everything else (health checks, SLOs, incidents) hangs off a system. Once you add one, it shows up here."
          steps={[
            "Open catalog management to register your first system.",
            "Group related systems by team, product area, or environment.",
            "Come back here to browse and search the whole catalog at a glance.",
          ]}
          actions={
            canManage ? (
              <Button asChild>
                <Link to={resolveRoute(catalogRoutes.routes.config)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add your first system
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {/*
            Headless health boundary: the optional CatalogBrowseHealthSlot filler
            bulk-fetches system health and reports it via onStatuses. Renders
            nothing when no health source is installed (slot unfilled).
          */}
          <CatalogBrowseHealth
            systemIds={systemIds}
            onStatuses={handleStatuses}
          />

          <CatalogBrowseToolbar
            query={browse.state.query}
            onQueryChange={browse.setQuery}
            group={browse.state.group}
            onGroupChange={browse.setGroup}
            groups={groups}
            health={browse.state.health}
            onHealthChange={browse.setHealth}
            healthEnabled={healthEnabled}
            tag={browse.state.tag}
            onTagChange={browse.setTag}
            tagOptions={tagOptions}
            density={browse.state.density}
            onDensityChange={browse.setDensity}
          />

          {model.isFilteredEmpty ? (
            <ListEmptyState
              resource="systems"
              description="No systems match the current search and filters."
              actions={
                <Button variant="outline" onClick={browse.clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            /*
              Boundary that lets provider plugins wrap the whole browse tree in
              their bulk-data providers (health/incident/maintenance badges,
              notification bells), so per-row contributions read bulk data from
              context instead of each firing its own request. No filler installed
              => renders the tree as-is (each contribution fetches its own).
            */
            <CatalogBrowseDataBoundary systemIds={systemIds} groupIds={groupIds}>
              <div className="space-y-3">
                {model.sections.map((section) => (
                  <CatalogGroupSection
                    key={section.id}
                    section={section}
                    density={model.density}
                    onToggle={browse.setSectionOpen}
                  />
                ))}
              </div>
            </CatalogBrowseDataBoundary>
          )}
        </div>
      )}
    </PageLayout>
  );
};

export const CatalogPage = wrapInSuspense(CatalogPageContent);
