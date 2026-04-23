import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  Button,
  Badge,
} from "@checkstack/ui";
import { Link } from "react-router-dom";
import { usePluginRoute, useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  incidentRoutes,
  incidentAccess,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import type { System } from "@checkstack/catalog-common";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidents: IncidentWithSystems[];
  systems: System[];
}

export const IncidentOverviewSheet: React.FC<Props> = ({
  open,
  onOpenChange,
  incidents,
  systems,
}) => {
  const getRoute = usePluginRoute();
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useAccess(incidentAccess.incident.manage);

  // Map of systemId -> systemName
  const systemMap = new Map(systems.map((s) => [s.id, s.name]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="flex flex-row items-start justify-between gap-4 pt-6">
          <div className="flex flex-col gap-1 text-left">
            <SheetTitle>Active Incidents</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Overview of unresolved issues
            </p>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" asChild>
              <Link to={getRoute(incidentRoutes.routes.config)}>Manage</Link>
            </Button>
          )}
        </SheetHeader>

        <SheetBody className="flex flex-col gap-3 pb-8">
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No active incidents
            </p>
          ) : (
            incidents.map((incident) => {
              const affectedSystemNames = incident.systemIds
                .map((id) => systemMap.get(id) || id)
                .join(", ");

              const variant =
                incident.severity === "critical"
                  ? "destructive"
                  : incident.severity === "major"
                    ? "warning"
                    : "info";

              return (
                <div
                  key={incident.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="font-medium text-foreground">
                      {incident.title}
                    </h4>
                    <Badge variant={variant} className="capitalize flex-shrink-0">
                      {incident.severity}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Affected Systems
                    </span>
                    <span className="text-sm text-foreground">
                      {affectedSystemNames || "None"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};
