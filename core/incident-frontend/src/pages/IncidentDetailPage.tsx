import React, { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  useQueryClient,
  wrapInSuspense,
  ExtensionSlot,
} from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { IncidentApi } from "../api";
import {
  incidentRoutes,
  incidentAccess,
  incidentResourceTypes,
  IncidentDetailsSlot,
} from "@checkstack/incident-common";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Button,
  Badge,
  LoadingSpinner,
  BackLink,
  useToast,
  StatusUpdateTimeline,
  PageLayout,
  toastError,
  cn,
} from "@checkstack/ui";
import {
  AlertTriangle,
  Calendar,
  MessageSquare,
  CheckCircle2,
  Server,
  Plus,
  ExternalLink,
  HeartPulse,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { IncidentUpdateForm } from "../components/IncidentUpdateForm";
import {
  getIncidentStatusBadge,
  getIncidentSeverityBadge,
  getIncidentHealthOverrideBadge,
  getIncidentSeverityAccentClass,
} from "../utils/badges";

const IncidentDetailPageContent: React.FC = () => {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const incidentClient = usePluginClient(IncidentApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showUpdateForm, setShowUpdateForm] = useState(false);

  // Fetch incident with useQuery
  const {
    data: incident,
    isLoading: incidentLoading,
    refetch: refetchIncident,
  } = incidentClient.getIncident.useQuery(
    { id: incidentId ?? "" },
    { enabled: !!incidentId },
  );

  // Per-resource action gate: ORs the global rule with a team grant on THIS
  // incident. Empty ids until the incident loads; global managers get access
  // to everything automatically.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: incidentAccess.incident.manage,
    objectType: incidentResourceTypes.incident,
    resourceIds: incident ? [incident.id] : [],
  });

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  const systems = systemsData?.systems ?? [];
  const loading = incidentLoading || systemsLoading;

  // Resolve mutation
  // Resolving (or a status change) lifts any health override this incident
  // forced, which is healthcheck's derived data - a DIFFERENT plugin - so its
  // queries need explicit invalidation (Pillar 2 of the query-invalidation rule).
  const invalidateSystemHealth = () => {
    void queryClient.invalidateQueries({ queryKey: [["healthcheck"]] });
  };

  const resolveMutation = incidentClient.resolveIncident.useMutation({
    onSuccess: () => {
      invalidateSystemHealth();
      toast.success("Incident resolved");
      void refetchIncident();
    },
    onError: (error) => {
      toastError(toast, "Failed to resolve", error);
    },
  });

  const handleUpdateSuccess = () => {
    // A posted update may carry a status change (e.g. to resolved), which lifts
    // an override, so refresh derived system health too.
    invalidateSystemHealth();
    setShowUpdateForm(false);
    void refetchIncident();
  };

  const handleResolve = () => {
    if (!incidentId) return;
    resolveMutation.mutate({ id: incidentId });
  };

  const getSystemName = (systemId: string): string => {
    return systems.find((s) => s.id === systemId)?.name ?? systemId;
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="p-12 text-center">
        <p className="text-muted-foreground">Incident not found</p>
        <BackLink
          onClick={() => navigate(resolveRoute(incidentRoutes.routes.config, {}))}
          className="mt-4"
        >
          Back to Incidents
        </BackLink>
      </div>
    );
  }

  const canResolve = canAccess(incident.id) && incident.status !== "resolved";
  // Use 'from' query param for back navigation, fallback to first affected system
  const sourceSystemId = searchParams.get("from") ?? incident.systemIds[0];

  return (
    <PageLayout
      title={incident.title}
      subtitle="Incident details and status history"
      icon={AlertTriangle}
      loading={false}
      allowed={true}
      actions={
        sourceSystemId ? (
          <BackLink
            onClick={() =>
              navigate(
                resolveRoute(incidentRoutes.routes.systemHistory, {
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
        {/* Incident summary panel: severity-led hero with a duration figure,
            multi-encoded status (hue + pill + left accent stripe), and a quiet
            metadata zone beneath. Static depth - this is a detail page. */}
        <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
          {/* Severity accent stripe: signal by hue + position, not color alone. */}
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-1",
              getIncidentSeverityAccentClass(incident.severity),
            )}
            aria-hidden
          />

          <div className="pl-2">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Incident Details
            </h3>
            <div className="flex flex-wrap items-start justify-between gap-4">
              {/* Duration hero */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {getIncidentSeverityBadge(incident.severity)}
                  {getIncidentStatusBadge(incident.status)}
                </div>
                <p className="mt-3 text-3xl font-bold leading-none tabular-nums text-foreground">
                  {formatDistanceToNow(new Date(incident.createdAt), {
                    addSuffix: false,
                  })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Duration</p>
              </div>
              {canResolve && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResolve}
                  disabled={resolveMutation.isPending}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Resolve
                </Button>
              )}
            </div>

            {/* "Who can change this" — filled by auth-frontend; renders nothing
                when the incident is not team-scoped. */}
            <ExtensionSlot slot={IncidentDetailsSlot} context={{ incident }} />

            {/* Quiet metadata zone */}
            <div className="mt-5 space-y-4 border-t border-border/60 pt-4">
              {incident.description && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1">
                    Description
                  </h4>
                  <p className="text-sm text-foreground">
                    {incident.description}
                  </p>
                </div>
              )}

              <div className="border-t border-border/60 pt-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                  Started
                </h4>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{format(new Date(incident.createdAt), "PPpp")}</span>
                </div>
              </div>

              <div className="border-t border-border/60 pt-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  Affected Systems
                </h4>
                <div className="flex flex-wrap gap-2">
                  {incident.systemIds.map((systemId) => (
                    <Badge key={systemId} variant="outline">
                      <Server className="h-3 w-3 mr-1" />
                      {getSystemName(systemId)}
                    </Badge>
                  ))}
                </div>
              </div>

              {incident.healthOverride &&
                incident.status !== "resolved" && (
                  <div className="border-t border-border/60 pt-4">
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">
                      Health override
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <HeartPulse className="h-4 w-4 text-muted-foreground" />
                      {getIncidentHealthOverrideBadge(incident.healthOverride)}
                      <span className="text-xs text-muted-foreground">
                        Forced onto the affected systems while this incident is
                        active.
                      </span>
                    </div>
                  </div>
                )}

              {incident.links.length > 0 && (
                <div className="border-t border-border/60 pt-4">
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    Hotlinks
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {incident.links.map((link) => (
                      <a
                        key={link.id}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-primary hover:bg-muted"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>{link.label ?? link.url}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Updates Timeline */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardHeaderRow>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Status Updates</CardTitle>
              </div>
              {canAccess(incident.id) && !showUpdateForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUpdateForm(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Update
                </Button>
              )}
            </CardHeaderRow>
          </CardHeader>
          <CardContent className="p-6">
            {/* Add Update Form */}
            {showUpdateForm && incidentId && (
              <div className="mb-6">
                <IncidentUpdateForm
                  incidentId={incidentId}
                  onSuccess={handleUpdateSuccess}
                  onCancel={() => setShowUpdateForm(false)}
                />
              </div>
            )}

            <StatusUpdateTimeline
              updates={incident.updates}
              renderStatusBadge={getIncidentStatusBadge}
              emptyTitle="No status updates"
              emptyDescription="No status updates have been posted for this incident."
            />
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
};

export const IncidentDetailPage = wrapInSuspense(IncidentDetailPageContent);
