import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { SloApi } from "../api";
import {
  sloAccess,
  sloResourceTypes,
  pluginMetadata as sloPluginMetadata,
  type SloObjective,
} from "@checkstack/slo-common";
import { Tip, TipBanner } from "@checkstack/tips-frontend";
import { CatalogApi, catalogResourceTypes } from "@checkstack/catalog-common";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import {
  Card,
  Button,
  Badge,
  LoadingSpinner,
  EmptyState,
  ListEmptyState,
  QueryErrorState,
  DataTable,
  type DataTableColumn,
  RowActions,
  RowAction,
  useToast,
  toastError,
  toastSuccess,
  ConfirmationModal,
  PageLayout,
} from "@checkstack/ui";
import { Plus, Target, Trash2, Edit2, ExternalLink } from "lucide-react";
import { SloEditor } from "../components/SloEditor";

/**
 * In-app deep-link to the SLO concept page (same-origin Starlight build served
 * at `/checkstack/*`). Slug is centralised in `APP_DOC_SLUGS` and guarded
 * against renames by `docs-links.test.ts`.
 */
const DOCS_SLO = docsPath(APP_DOC_SLUGS.slo);

/** Inline "Learn more" link to the SLO concept docs. */
const SloLearnMore = () => (
  <a
    href={DOCS_SLO}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline"
  >
    Learn more
    <ExternalLink className="h-3 w-3" />
  </a>
);

const SloConfigPageContent: React.FC = () => {
  const sloClient = usePluginClient(SloApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Create capability: gates the create-objective action. Managing the target
  // system (the SLO's parent) is enough - matching the backend parent gate.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useProcedureAccess(SloApi.contract.createObjective);
  // Surface access: gates reaching this page (matches the route guard); also
  // true for a user who manages a system or an existing objective via a team.
  const { allowed: canAccessSurface, loading: surfaceLoading } =
    accessApi.useCanAccessType({
      accessRule: sloAccess.slo.manage,
      objectType: sloResourceTypes.slo,
      parentType: catalogResourceTypes.system,
    });

  const objectivesQuery = sloClient.listObjectives.useQuery({});
  const {
    data: objectivesData,
    isLoading: objectivesLoading,
    refetch: refetchObjectives,
  } = objectivesQuery;

  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  const objectives = objectivesData?.objectives ?? [];

  const { canAccess } = accessApi.useResourceAccess({
    accessRule: sloAccess.slo.manage,
    objectType: sloResourceTypes.slo,
    resourceIds: objectives.map((item) => item.objective.id),
  });
  const systems = systemsData?.systems ?? [];
  const loading = objectivesLoading || systemsLoading;
  const isError = objectivesQuery.isError;

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingObjective, setEditingObjective] = useState<
    SloObjective | undefined
  >();

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | undefined>();

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setEditingObjective(undefined);
      setEditorOpen(true);
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  const handleCreate = () => {
    setEditingObjective(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (obj: SloObjective) => {
    setEditingObjective(obj);
    setEditorOpen(true);
  };

  const handleSave = () => {
    setEditorOpen(false);
    void refetchObjectives();
  };

  const deleteMutation = sloClient.deleteObjective.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "SLO objective deleted");
      void refetchObjectives();
      setDeleteId(undefined);
    },
    onError: (error) => {
      toastError(toast, "Failed to delete", error);
    },
  });

  const handleDelete = () => {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId });
  };

  const getSystemName = (systemId: string) => {
    return systems.find((s) => s.id === systemId)?.name ?? systemId;
  };

  const getExclusionBadge = (mode: SloObjective["dependencyExclusion"]) => {
    switch (mode) {
      case "strict": {
        return <Badge variant="secondary">Strict</Badge>;
      }
      case "self-only": {
        return <Badge variant="info">Self-Only</Badge>;
      }
      default: {
        return <Badge>{mode}</Badge>;
      }
    }
  };

  const renderStatusBadge = (
    status: (typeof objectives)[number]["status"],
  ) => {
    if (status.isBreaching) {
      return <Badge variant="destructive">Breaching</Badge>;
    }
    if (status.hasOpenDowntime) {
      return <Badge variant="warning">Degraded</Badge>;
    }
    if (status.errorBudgetRemainingPercent <= 20) {
      return <Badge variant="warning">At Risk</Badge>;
    }
    return <Badge variant="success">Healthy</Badge>;
  };

  const columns: DataTableColumn<(typeof objectives)[number]>[] = [
    {
      id: "system",
      header: "System",
      cellClassName: "font-medium",
      sortValue: (item) => getSystemName(item.objective.systemId),
      searchValue: (item) => getSystemName(item.objective.systemId),
      cell: (item) => getSystemName(item.objective.systemId),
    },
    {
      id: "target",
      header: "Target",
      sortValue: (item) => item.objective.target,
      cell: (item) => `${item.objective.target}%`,
    },
    {
      id: "window",
      header: "Window",
      sortValue: (item) => item.objective.windowDays,
      cell: (item) => `${item.objective.windowDays}d`,
    },
    {
      id: "exclusion",
      header: "Exclusion Mode",
      sortValue: (item) => item.objective.dependencyExclusion,
      cell: (item) => getExclusionBadge(item.objective.dependencyExclusion),
    },
    {
      id: "status",
      header: "Status",
      // Rank mirrors renderStatusBadge's priority (worst first) so sorting uses
      // the raw status signal, not the badge label.
      sortValue: (item) => {
        const status = item.status;
        if (status.isBreaching) return 0;
        if (status.hasOpenDowntime) return 1;
        if (status.errorBudgetRemainingPercent <= 20) return 2;
        return 3;
      },
      cell: (item) => renderStatusBadge(item.status),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-24",
      cell: (item) =>
        canAccess(item.objective.id) ? (
          <RowActions>
            <RowAction
              icon={Edit2}
              label={`Edit SLO for ${getSystemName(item.objective.systemId)}`}
              onClick={() => handleEdit(item.objective)}
            />
            <RowAction
              icon={Trash2}
              label={`Delete SLO for ${getSystemName(item.objective.systemId)}`}
              tone="destructive"
              onClick={() => setDeleteId(item.objective.id)}
            />
          </RowActions>
        ) : null,
    },
  ];

  return (
    <PageLayout
      title="SLO Management"
      subtitle="Define and manage Service Level Objectives"
      icon={Target}
      loading={accessLoading || surfaceLoading}
      allowed={canAccessSurface}
      actions={
        <Tip
          plugin={sloPluginMetadata}
          id="objectives.create"
          title="Set the bar for reliability"
          description={
            <>
              An SLO is a contract you set with yourself - “this service is
              healthy 99.9% of the time over 30 days”. Checkstack measures it
              from your existing health-check history, tracks the error budget,
              and shows you when you're burning it too fast. <SloLearnMore />
            </>
          }
          side="bottom"
          align="end"
        >
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create SLO
          </Button>
        </Tip>
      }
    >
      <TipBanner
        plugin={sloPluginMetadata}
        id="config.intro"
        title="What an SLO does here"
        description={
          <>
            An SLO turns raw uptime into a reliability target you hold a system
            to (for example, healthy 99.9% of the time over 30 days). Checkstack
            measures it from your existing health-check history and tracks the
            error budget, so it builds on the checks you already run.{" "}
            <SloLearnMore />
          </>
        }
      />

      {loading ? (
        <div className="flex justify-center p-12">
          <LoadingSpinner />
        </div>
      ) : isError ? (
        <QueryErrorState
          error={objectivesQuery.error}
          onRetry={() => void objectivesQuery.refetch()}
          resource="SLO objectives"
        />
      ) : (
        <DataTable
          data={objectives}
          columns={columns}
          getRowId={(item) => item.objective.id}
          searchPlaceholder="Search objectives..."
          emptyState={
            <EmptyState
              icon={<Target className="size-10" />}
              title="No SLO objectives yet"
              description="An SLO turns raw uptime into a target you can hold yourself to: “API X is healthy 99.9% of the time over the last 30 days.” Checkstack tracks the error budget against your health-check history and lets you exclude planned maintenance."
              steps={[
                "Click “Create SLO” and pick the system to measure.",
                "Choose a target (e.g. 99.9%) and a rolling window (e.g. 30 days).",
                "Decide whether scheduled maintenances eat into the error budget - usually you want them excluded.",
              ]}
              actions={
                canManage ? (
                  <Button onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create your first SLO
                  </Button>
                ) : undefined
              }
            />
          }
          noResultsState={
            <ListEmptyState
              resource="SLO objectives"
              description="No objectives match your search."
            />
          }
          renderMobileCard={(item) => (
            <Card className="p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium truncate">
                  {getSystemName(item.objective.systemId)}
                </span>
                {renderStatusBadge(item.status)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {item.objective.target}% &middot;{" "}
                {item.objective.windowDays}d window
              </div>
              <div className="mt-2">
                {getExclusionBadge(item.objective.dependencyExclusion)}
              </div>
              {canAccess(item.objective.id) && (
                <RowActions className="mt-3">
                  <RowAction
                    icon={Edit2}
                    label={`Edit SLO for ${getSystemName(item.objective.systemId)}`}
                    onClick={() => handleEdit(item.objective)}
                  />
                  <RowAction
                    icon={Trash2}
                    label={`Delete SLO for ${getSystemName(item.objective.systemId)}`}
                    tone="destructive"
                    onClick={() => setDeleteId(item.objective.id)}
                  />
                </RowActions>
              )}
            </Card>
          )}
        />
      )}

      <SloEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        objective={editingObjective}
        systems={systems}
        onSave={handleSave}
      />

      <ConfirmationModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(undefined)}
        title="Delete SLO Objective"
        message="Are you sure you want to delete this SLO objective? All associated downtime events and snapshots will also be deleted."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        isLoading={deleteMutation.isPending}
      />
    </PageLayout>
  );
};

export const SloConfigPage = wrapInSuspense(SloConfigPageContent);
