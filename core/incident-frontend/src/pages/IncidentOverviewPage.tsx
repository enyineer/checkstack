import React, { useState } from "react";
import { Link } from "react-router-dom";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { IncidentApi } from "../api";
import { incidentRoutes } from "@checkstack/incident-common";
import {
  Card,
  CardContent,
  LoadingSpinner,
  EmptyState,
  PageLayout,
  Checkbox,
  Label,
  cn,
} from "@checkstack/ui";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  getIncidentStatusBadge,
  getIncidentSeverityBadge,
  getIncidentSeverityAccentClass,
} from "../utils/badges";

/**
 * Public, read-only overview of incidents. Reachable logged-out (anonymous
 * holds `incident.read` by default) via the sidebar. Uses the already-public
 * `listIncidents` proc, whose `listKey` post-filter scopes rows to the caller's
 * grants - so a team-scoped viewer sees only their incidents and an anonymous
 * visitor sees the publicly-readable ones. Managing/editing stays on the
 * separate manage-gated config page.
 */
const IncidentOverviewPageContent: React.FC = () => {
  const incidentClient = usePluginClient(IncidentApi);
  const [includeResolved, setIncludeResolved] = useState(false);

  const { data, isLoading } = incidentClient.listIncidents.useQuery({
    includeResolved,
  });

  const incidents = data?.incidents ?? [];

  return (
    <PageLayout
      title="Incidents"
      subtitle="Current and recent incidents"
      icon={AlertTriangle}
      loading={false}
      allowed={true}
      actions={
        <div
          className="flex items-center gap-2"
          onClick={() => setIncludeResolved((v) => !v)}
        >
          <Checkbox id="include-resolved" checked={includeResolved} />
          <Label htmlFor="include-resolved" className="cursor-pointer text-sm">
            Show resolved
          </Label>
        </div>
      }
    >
      {isLoading ? (
        <div className="p-12 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : incidents.length === 0 ? (
        <EmptyState
          title="No incidents"
          description={
            includeResolved
              ? "There are no incidents to show."
              : "There are no active incidents right now."
          }
        />
      ) : (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <Link
              key={incident.id}
              to={resolveRoute(incidentRoutes.routes.detail, {
                incidentId: incident.id,
              })}
              className="block"
            >
              <Card className="relative overflow-hidden transition-colors hover:bg-muted/40">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-1",
                    getIncidentSeverityAccentClass(incident.severity),
                  )}
                  aria-hidden
                />
                <CardContent className="flex items-center justify-between gap-4 p-4 pl-5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {incident.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Started{" "}
                      {formatDistanceToNow(new Date(incident.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {getIncidentSeverityBadge(incident.severity)}
                    {getIncidentStatusBadge(incident.status)}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageLayout>
  );
};

export const IncidentOverviewPage = wrapInSuspense(IncidentOverviewPageContent);
