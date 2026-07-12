import React, { useMemo, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { Input, LoadingSpinner } from "@checkstack/ui";
import { Plus, Search, Server } from "lucide-react";
import {
  CatalogApi,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import { useManageableResources } from "@checkstack/auth-frontend";

interface AssignToSystemPanelProps {
  assignedSystemIds: string[];
  /** Whether the check already has at least one assignment (drives the explainer). */
  hasAssignments: boolean;
  saving: boolean;
  onAssign: (systemId: string) => void;
}

interface SystemItem {
  id: string;
  name: string;
  description?: string | null;
}

const getSystemId = (system: SystemItem) => system.id;

/**
 * The "Assign to system..." picker panel of the check editor's Assignment
 * section. Assigning requires MANAGE on the target system (the backend gates
 * `associateSystem` on the `catalog.system` parent), so the candidate list is
 * filtered through `useManageableResources` - the picker never offers a
 * system the submit would reject.
 */
export const AssignToSystemPanel: React.FC<AssignToSystemPanelProps> = ({
  assignedSystemIds,
  hasAssignments,
  saving,
  onAssign,
}) => {
  const catalogClient = usePluginClient(CatalogApi);
  const [query, setQuery] = useState("");

  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});
  const systems: SystemItem[] = useMemo(
    () => systemsData?.systems ?? [],
    [systemsData],
  );

  const { manageable, loading: accessLoading } = useManageableResources({
    items: systems,
    getId: getSystemId,
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
  });

  const assignedIds = useMemo(
    () => new Set(assignedSystemIds),
    [assignedSystemIds],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return manageable
      .filter((system) => !assignedIds.has(system.id))
      .filter((system) => !q || system.name.toLowerCase().includes(q))
      .toSorted((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }, [manageable, assignedIds, query]);

  const loading = systemsLoading || accessLoading;

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold">Assign to system</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {hasAssignments
            ? "Add this health check to another system. It runs independently per system, with its own thresholds, environments, and notifications."
            : "An assignment links a health check to a system. A check does not run until it is assigned - assigning is what schedules it. The assignment also carries per-system settings (failure thresholds, notifications) and runs the check once per environment the system belongs to."}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : manageable.length === 0 ? (
        <div className="rounded-md border bg-surface-inset p-4 text-sm text-muted-foreground">
          Assigning requires manage access on the target system, and there is
          no system you can manage. Ask a system owner or an administrator to
          assign this check for you.
        </div>
      ) : candidates.length === 0 && !query ? (
        <div className="rounded-md border bg-surface-inset p-4 text-sm text-muted-foreground">
          This check is already assigned to every system you can manage.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-input bg-surface-inset px-2 focus-within:ring-1 focus-within:ring-ring">
            <Search className="pointer-events-none h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter systems…"
              autoComplete="off"
              aria-label="Filter systems"
              className="h-8 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          {candidates.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground italic">
              No matching systems
            </p>
          ) : (
            <div className="rounded-md border divide-y">
              {candidates.map((system) => (
                <button
                  key={system.id}
                  type="button"
                  disabled={saving}
                  onClick={() => onAssign(system.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {system.name}
                    </span>
                    {system.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {system.description}
                      </span>
                    )}
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-primary" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
