import React, { useMemo } from "react";
import {
  useParams,
  Link,
  useNavigate,
  useSearchParams,
} from "react-router";
import {
  usePluginClient,
  wrapInSuspense,
  accessApiRef,
  useApi,
  ExtensionSlot,
  useMentionResolution,
} from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { MaintenanceApi } from "../api";
import {
  maintenanceRoutes,
  maintenanceAccess,
  maintenanceResourceTypes,
  MaintenanceDetailsSlot,
  MaintenanceVisibilityEnum,
} from "@checkstack/maintenance-common";
import { catalogRoutes, CatalogApi } from "@checkstack/catalog-common";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Badge,
  LoadingSpinner,
  EmptyState,
  PageLayout,
  BackLink,
  Button,
  useToast,
  toastError,
  MarkdownBlock,
  ReferencedItems,
  LinksEditor,
} from "@checkstack/ui";
import { TeamAccessEditor } from "@checkstack/auth-frontend";
import { MAINTENANCE_VISIBILITY_OPTIONS } from "../utils/visibilityOptions";
import {
  Calendar,
  Clock,
  Wrench,
  Server,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { VisibilityBadge } from "../utils/visibilityBadge";
import { cn } from "@checkstack/ui";
import { format } from "date-fns";
import { MaintenanceUpdatesSection } from "../components/MaintenanceUpdatesSection";
import { MaintenanceWindowHero } from "../components/MaintenanceWindowHero";
import {
  getMaintenanceStatusBadge,
  getMaintenanceStatusTone,
  getMaintenanceToneAccentClass,
} from "../utils/badges";

const MaintenanceDetailPageContent: React.FC = () => {
  const { maintenanceId } = useParams<{ maintenanceId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  // Per-resource gate: ORs the global rule with a team grant on THIS
  // maintenance (global-manage users pass automatically). Gates the
  // "Complete" and "Add Update" actions.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: maintenanceAccess.maintenance.manage,
    objectType: maintenanceResourceTypes.maintenance,
    resourceIds: [maintenanceId ?? ""],
  });

  // Fetch maintenance with useQuery
  const {
    data: maintenance,
    isLoading: maintenanceLoading,
    refetch: refetchMaintenance,
  } = maintenanceClient.getMaintenance.useQuery(
    { id: maintenanceId ?? "" },
    { enabled: !!maintenanceId },
  );

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  const systems = systemsData?.systems ?? [];
  const loading = maintenanceLoading || systemsLoading;

  // Every authored document on this page, so mention viewability is resolved
  // in ONE batched request before anything renders. Also feeds
  // `ReferencedItems`, so the chips and the inline links can never disagree.
  const mentionDocuments = useMemo(
    () => [
      maintenance?.description ?? "",
      ...(maintenance?.updates ?? []).map((update) => update.message),
    ],
    [maintenance],
  );
  // Links ONLY the references this viewer may actually open.
  const { resolveMention } = useMentionResolution({
    documents: mentionDocuments,
  });

  // Complete mutation
  const completeMutation = maintenanceClient.closeMaintenance.useMutation({
    onSuccess: () => {
      toast.success("Maintenance completed");
      void refetchMaintenance();
    },
    onError: (error) => {
      toastError(toast, "Failed to complete", error);
    },
  });

  // Hotlink mutations - self-persisting on this detail page (moved off the edit
  // dialog). Each refetches the maintenance so the links list reflects the
  // change.
  const addLinkMutation = maintenanceClient.addLink.useMutation({
    onSuccess: () => {
      void refetchMaintenance();
    },
    onError: (error) => {
      toastError(toast, "Failed to add link", error);
    },
  });

  const updateLinkMutation = maintenanceClient.updateLink.useMutation({
    onSuccess: () => {
      void refetchMaintenance();
    },
    onError: (error) => {
      toastError(toast, "Failed to update link", error);
    },
  });

  const removeLinkMutation = maintenanceClient.removeLink.useMutation({
    onSuccess: () => {
      void refetchMaintenance();
    },
    onError: (error) => {
      toastError(toast, "Failed to remove link", error);
    },
  });

  // Called by the shared updates section after an add / edit / delete.
  const handleUpdatesChanged = () => {
    void refetchMaintenance();
  };

  const handleComplete = () => {
    if (!maintenanceId) return;
    completeMutation.mutate({ id: maintenanceId });
  };

  const getSystemName = (systemId: string): string => {
    return systems.find((s) => s.id === systemId)?.name ?? systemId;
  };

  if (!maintenanceId) {
    return (
      <EmptyState
        title="Maintenance not found"
        description="No maintenance ID was provided."
      />
    );
  }

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!maintenance) {
    return (
      <EmptyState
        title="Maintenance not found"
        description="The requested maintenance could not be found."
      />
    );
  }

  // Use 'from' query param for back navigation, fallback to first affected system
  const sourceSystemId = searchParams.get("from") ?? maintenance.systemIds[0];
  const canManage = canAccess(maintenanceId);
  const canComplete =
    canManage &&
    maintenance.status !== "completed" &&
    maintenance.status !== "cancelled";

  return (
    <PageLayout
      title={maintenance.title}
      subtitle="Maintenance details and status history"
      icon={Wrench}
      loading={false}
      allowed={true}
      actions={
        sourceSystemId ? (
          <BackLink
            onClick={() =>
              navigate(
                resolveRoute(maintenanceRoutes.routes.systemHistory, {
                  systemId: sourceSystemId,
                }),
              )
            }
          >
            Back to History
          </BackLink>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* Maintenance Info Card */}
        <Card className="relative overflow-hidden border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
          {/* Status accent stripe: the panel itself encodes status by hue +
              position, not color alone (the pill in the header carries the
              text label). */}
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-1",
              getMaintenanceToneAccentClass(
                getMaintenanceStatusTone(maintenance.status),
              ),
            )}
            aria-hidden
          />
          <CardHeader className="border-b border-border">
            <CardHeaderRow>
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Maintenance Details</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {getMaintenanceStatusBadge(maintenance.status)}
                {canComplete && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleComplete}
                    disabled={completeMutation.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Complete
                  </Button>
                )}
              </div>
            </CardHeaderRow>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {/* Single number-led hero: the window length, or a live remaining
                countdown while in progress. Derived purely from start/end. */}
            <MaintenanceWindowHero
              startAt={maintenance.startAt}
              endAt={maintenance.endAt}
              status={maintenance.status}
            />
            {/* "Who can change this" — filled by auth-frontend; renders nothing
                when the maintenance is not team-scoped. */}
            <ExtensionSlot
              slot={MaintenanceDetailsSlot}
              context={{ maintenance }}
            />
            {maintenance.description && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Description
                </h4>
                <MarkdownBlock
                  size="sm"
                  className="text-foreground"
                  resolveMention={resolveMention}
                >
                  {maintenance.description}
                </MarkdownBlock>
              </div>
            )}

            {/* Derived from the authored text on every render - nothing is
                stored twice, so an edit that drops a reference drops it here
                too. */}
            <ReferencedItems
              documents={mentionDocuments}
              resolve={(ref) => {
                const url = resolveMention(ref);
                // The label comes from the authored link text, so no lookup is
                // needed - and an unresolvable reference is OMITTED rather than
                // listed as a dead chip that still confirms it exists.
                return url ? { ...ref, url } : undefined;
              }}
              renderLink={(reference) => (
                <Link
                  to={reference.url}
                  className="inline-flex items-center rounded-full border border-border/70 bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-foreground hover:border-primary/40"
                >
                  {reference.label}
                </Link>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{format(new Date(maintenance.startAt), "PPpp")}</span>
                </div>
                <h4 className="mt-1 text-xs text-muted-foreground">
                  Start Time
                </h4>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{format(new Date(maintenance.endAt), "PPpp")}</span>
                </div>
                <h4 className="mt-1 text-xs text-muted-foreground">End Time</h4>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Affected Systems
              </h4>
              <div className="flex flex-wrap gap-2">
                {maintenance.systemIds.map((systemId) => (
                  <Link
                    key={systemId}
                    to={resolveRoute(catalogRoutes.routes.systemDetail, {
                      systemId,
                    })}
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-muted"
                    >
                      <Server className="h-3 w-3 mr-1" />
                      {getSystemName(systemId)}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>

            {/* Read-only hotlinks for viewers who cannot manage. Managers get
                the self-persisting LinksEditor card below instead. */}
            {!canManage && maintenance.links.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Hotlinks
                </h4>
                <div className="flex flex-wrap gap-2">
                  {maintenance.links.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-primary hover:bg-muted"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{link.label ?? link.url}</span>
                      <VisibilityBadge visibility={link.visibility} />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Updates - shared with the maintenance editor dialog. */}
        <Card>
          <CardContent className="p-6">
            <MaintenanceUpdatesSection
              maintenanceId={maintenanceId}
              currentStatus={maintenance.status}
              updates={maintenance.updates}
              onChanged={handleUpdatesChanged}
              emptyDescription="No status updates have been posted for this maintenance."
            />
          </CardContent>
        </Card>

        {/* Hotlinks editor - self-persisting, managers only. Moved off the edit
            dialog so the living data lives on the detail page. */}
        {canManage && (
          <Card>
            <CardContent className="p-6">
              <LinksEditor
                title="Hotlinks"
                description="Attach change tickets, runbooks, dashboards, or any URL relevant to this maintenance."
                links={maintenance.links}
                visibility={{
                  options: MAINTENANCE_VISIBILITY_OPTIONS,
                  default: "public",
                  renderBadge: (v) => <VisibilityBadge visibility={v} />,
                }}
                busy={
                  addLinkMutation.isPending ||
                  updateLinkMutation.isPending ||
                  removeLinkMutation.isPending
                }
                onAdd={async ({ label, url, visibility }) => {
                  await addLinkMutation.mutateAsync({
                    maintenanceId,
                    label,
                    url,
                    visibility: MaintenanceVisibilityEnum.parse(
                      visibility ?? "public",
                    ),
                  });
                }}
                onEdit={async ({ id, label, url, visibility }) => {
                  await updateLinkMutation.mutateAsync({
                    id,
                    maintenanceId,
                    label,
                    url,
                    visibility: visibility
                      ? MaintenanceVisibilityEnum.parse(visibility)
                      : undefined,
                  });
                }}
                onRemove={async (link) => {
                  await removeLinkMutation.mutateAsync({
                    id: link.id,
                    maintenanceId,
                  });
                }}
              />
            </CardContent>
          </Card>
        )}

        {/* Team access editor - self-persisting, managers only. Renders its own
            card (nothing when the maintenance is not team-scopable). */}
        {canManage && (
          <TeamAccessEditor
            resourceType="maintenance.maintenance"
            resourceId={maintenanceId}
            compact
            expanded
          />
        )}
      </div>
    </PageLayout>
  );
};

export const MaintenanceDetailPage = wrapInSuspense(
  MaintenanceDetailPageContent,
);
