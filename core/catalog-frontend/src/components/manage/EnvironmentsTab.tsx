import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ListEmptyState,
  RowAction,
  RowActions,
} from "@checkstack/ui";
import {
  useProvenanceLocks,
  GitOpsSourceBadge,
} from "@checkstack/gitops-frontend";
import {
  useResourcesManagedBy,
  ResourceOwnerBadge,
  ScopeToTeamAction,
  BulkScopeToTeamAction,
} from "@checkstack/auth-frontend";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  CatalogApi,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import { Plus, Boxes, Pencil, Trash2, Trash } from "lucide-react";
import type { Environment, System } from "../../api";
import { AssignMenu } from "./AssignMenu";
import { MembershipChips } from "./MembershipChips";

export interface EnvironmentsTabProps {
  /** Environments after search/filter. */
  environments: Environment[];
  totalCount: number;
  allSystems: System[];
  onAddSystemToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveSystemFromEnvironment: (
    systemId: string,
    environmentId: string,
  ) => void;
  /** Attach ONE system to MANY environments in a single write (bulk assign). */
  onAttachSystemToEnvironments: (
    systemId: string,
    environmentIds: string[],
  ) => void;
  onAddEnvironment: () => void;
  onEditEnvironment: (environment: Environment) => void;
  onDeleteEnvironment: (id: string) => void;
  onBulkDeleteEnvironments: (ids: string[]) => void;
  onClearFilters: () => void;
}

export function EnvironmentsTab(
  props: EnvironmentsTabProps,
): React.ReactElement {
  const { environments, totalCount, allSystems, onAddEnvironment } = props;

  const systemsById = useMemo(() => {
    const map = new Map<string, System>();
    for (const system of allSystems) map.set(system.id, system);
    return map;
  }, [allSystems]);

  // One bulk provenance query for every row; `getLock` is a plain lookup safe
  // to call from column cell renderers. GitOps-managed environments cannot be
  // edited or deleted (the backend `enforceNotGitOpsLocked` rejects both).
  const { getLock } = useProvenanceLocks();

  // `Add Environment` is gated on the create verdict (true for env creators AND,
  // via `alsoAcceptCreatorOf`, system creators); per-row edit/delete are gated on
  // a manage grant for THAT environment. Resolved once for the whole tab.
  const accessApi = useApi(accessApiRef);
  const { allowed: canCreate } = accessApi.useProcedureAccess(
    CatalogApi.contract.createEnvironment,
  );
  const environmentIds = useMemo(
    () => environments.map((e) => e.id),
    [environments],
  );
  const { canAccess: canManageEnvironment } = accessApi.useResourceAccess({
    accessRule: catalogAccess.environment.manage,
    objectType: catalogResourceTypes.environment,
    resourceIds: environmentIds,
  });
  // Attaching/detaching a system to an environment is authorized per SYSTEM
  // (setSystemEnvironments is gated on catalog.system MANAGE), so only offer /
  // allow removing systems the caller manages. Resolved once for the whole tab.
  const systemIds = useMemo(() => allSystems.map((s) => s.id), [allSystems]);
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systemIds,
  });
  // Owning team per environment (batched - no per-row N+1) so each row shows who
  // may edit/delete it. Gated on `auth.teams.read` inside the hook.
  const { getOwnership } = useResourcesManagedBy({
    resourceType: catalogResourceTypes.environment,
    resourceIds: environmentIds,
  });

  // Bulk scope/assign/delete of an environment all need MANAGE on it, so only
  // manageable environments are selectable (global-manage users get all).
  // Unmanageable rows render a disabled checkbox and are excluded from "select
  // all".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectableIds = useMemo(
    () => environments.filter((e) => canManageEnvironment(e.id)).map((e) => e.id),
    [environments, canManageEnvironment],
  );
  const selectedVisible = selectableIds.filter((id) => selected.has(id));
  const allSelected =
    selectableIds.length > 0 && selectedVisible.length === selectableIds.length;
  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  const clearSelection = (): void => setSelected(new Set());
  // Systems offered in the bulk "Add system" menu. Attaching a system to an
  // environment is authorized by MANAGE on that SYSTEM, so only offer manageable
  // ones; name-sorted for a stable menu.
  const manageableSystems = useMemo(
    () =>
      allSystems
        .filter((s) => canManageSystem(s.id))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [allSystems, canManageSystem],
  );

  const header = (
    <div className="mb-4 flex items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Boxes className="h-5 w-5 text-muted-foreground" />
          Environments
          <span className="text-sm font-normal text-muted-foreground">
            {totalCount}
          </span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Environments carry free-form custom fields and can be attached to any
          system. They are shared across the instance and everyone can see them.
          Only the owning team (or a global admin) can edit or delete one.
        </p>
      </div>
      {canCreate && (
        <Button size="sm" onClick={onAddEnvironment}>
          <Plus className="mr-2 h-4 w-4" />
          Add Environment
        </Button>
      )}
    </div>
  );

  const columns: DataTableColumn<Environment>[] = [
    {
      id: "select",
      headClassName: "w-10",
      header: (
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all environments"
        />
      ),
      cell: (environment) => (
        <Checkbox
          checked={selected.has(environment.id)}
          disabled={!canManageEnvironment(environment.id)}
          onCheckedChange={() => toggle(environment.id)}
          aria-label={`Select ${environment.name}`}
        />
      ),
    },
    {
      id: "name",
      header: "Name",
      truncate: true,
      sortValue: (environment) => environment.name,
      cell: (environment) => {
        const { isLocked, provenance } = getLock({
          kind: "Environment",
          entityId: environment.id,
        });
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">
                {environment.name}
              </span>
              <ResourceOwnerBadge ownership={getOwnership(environment.id)} />
              {isLocked && provenance && (
                <GitOpsSourceBadge provenance={provenance} />
              )}
            </div>
            {environment.description && (
              <div
                title={environment.description}
                className="truncate text-xs text-muted-foreground"
              >
                {environment.description}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "systems",
      header: "Systems",
      cell: (environment) => {
        const { members, available } = deriveEnvironmentMembers({
          environment,
          systemsById,
          allSystems,
          canManageSystem,
        });
        return (
          <EnvironmentMembers
            environment={environment}
            members={members}
            available={available}
            canRemoveSystem={canManageSystem}
            onAddSystemToEnvironment={props.onAddSystemToEnvironment}
            onRemoveSystemFromEnvironment={props.onRemoveSystemFromEnvironment}
          />
        );
      },
    },
    {
      id: "fields",
      header: "Fields",
      headClassName: "w-20",
      cellClassName: "text-sm text-muted-foreground",
      sortValue: (environment) =>
        Object.keys(environment.metadata ?? {}).length,
      cell: (environment) => Object.keys(environment.metadata ?? {}).length,
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-px text-right",
      cell: (environment) => (
        <EnvironmentActions
          environment={environment}
          canManage={canManageEnvironment(environment.id)}
          isLocked={
            getLock({ kind: "Environment", entityId: environment.id }).isLocked
          }
          onEditEnvironment={props.onEditEnvironment}
          onDeleteEnvironment={props.onDeleteEnvironment}
        />
      ),
    },
  ];

  if (totalCount === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={<Boxes className="size-10" />}
          title="No environments yet"
          description="Environments (prod, staging, eu-west, …) hold custom fields you can attach to systems and reference in templates."
          actions={
            canCreate ? (
              <Button onClick={onAddEnvironment}>
                <Plus className="mr-2 h-4 w-4" />
                Add your first environment
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      {selectedVisible.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {selectedVisible.length} selected
          </span>
          <AssignMenu
            triggerLabel="Attach a system to the selected environments"
            trigger={<span>Add system</span>}
            items={manageableSystems.map((s) => ({ id: s.id, label: s.name }))}
            emptyLabel="No systems you can manage"
            onSelect={(systemId) => {
              props.onAttachSystemToEnvironments(systemId, selectedVisible);
              clearSelection();
            }}
          />
          <BulkScopeToTeamAction
            resourceType={catalogResourceTypes.environment}
            resources={selectedVisible.map((id) => ({
              id,
              name: environments.find((e) => e.id === id)?.name ?? id,
            }))}
            onDone={clearSelection}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive/90"
            onClick={() => {
              props.onBulkDeleteEnvironments(selectedVisible);
              clearSelection();
            }}
          >
            <Trash className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
        </div>
      )}

      <DataTable
        data={environments}
        columns={columns}
        getRowId={(environment) => environment.id}
        searchable={false}
        defaultSort={{ columnId: "name", direction: "asc" }}
        getRowProps={(environment) => ({ selected: selected.has(environment.id) })}
        noResultsState={
          <ListEmptyState
            resource="environments"
            description="No environments match the current search."
            actions={
              <Button variant="outline" onClick={props.onClearFilters}>
                Clear filters
              </Button>
            }
          />
        }
        renderMobileCard={(environment) => {
          const { members, available, fieldCount } = deriveEnvironmentMembers({
            environment,
            systemsById,
            allSystems,
            canManageSystem,
          });
          const { isLocked, provenance } = getLock({
            kind: "Environment",
            entityId: environment.id,
          });
          return (
            <Card
              className="p-3"
              data-state={
                selected.has(environment.id) ? "selected" : undefined
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(environment.id)}
                    disabled={!canManageEnvironment(environment.id)}
                    onCheckedChange={() => toggle(environment.id)}
                    aria-label={`Select ${environment.name}`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">
                        {environment.name}
                      </span>
                      <ResourceOwnerBadge
                        ownership={getOwnership(environment.id)}
                      />
                      {isLocked && provenance && (
                        <GitOpsSourceBadge provenance={provenance} />
                      )}
                    </div>
                    {environment.description && (
                      <div
                        title={environment.description}
                        className="truncate text-xs text-muted-foreground"
                      >
                        {environment.description}
                      </div>
                    )}
                  </div>
                </div>
                <EnvironmentActions
                  environment={environment}
                  canManage={canManageEnvironment(environment.id)}
                  isLocked={isLocked}
                  onEditEnvironment={props.onEditEnvironment}
                  onDeleteEnvironment={props.onDeleteEnvironment}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {fieldCount} {fieldCount === 1 ? "field" : "fields"}
              </p>
              <div className="mt-2">
                <EnvironmentMembers
                  environment={environment}
                  members={members}
                  available={available}
                  canRemoveSystem={canManageSystem}
                  onAddSystemToEnvironment={props.onAddSystemToEnvironment}
                  onRemoveSystemFromEnvironment={
                    props.onRemoveSystemFromEnvironment
                  }
                />
              </div>
            </Card>
          );
        }}
      />
    </div>
  );
}

/** Derive the member systems and the still-attachable systems for an env. */
function deriveEnvironmentMembers({
  environment,
  systemsById,
  allSystems,
  canManageSystem,
}: {
  environment: Environment;
  systemsById: Map<string, System>;
  allSystems: System[];
  /** Only offer systems the caller can manage (the backend gates by system). */
  canManageSystem: (systemId: string) => boolean;
}): { members: System[]; available: System[]; fieldCount: number } {
  const memberIds = environment.systemIds ?? [];
  const members = memberIds
    .map((id) => systemsById.get(id))
    .filter((s): s is System => s !== undefined);
  const available = allSystems.filter(
    (s) => !memberIds.includes(s.id) && canManageSystem(s.id),
  );
  const fieldCount = Object.keys(environment.metadata ?? {}).length;
  return { members, available, fieldCount };
}

/** An environment's member systems as a compact count-pill + attach menu. */
function EnvironmentMembers({
  environment,
  members,
  available,
  canRemoveSystem,
  onAddSystemToEnvironment,
  onRemoveSystemFromEnvironment,
}: {
  environment: Environment;
  members: System[];
  available: System[];
  /** Detaching a member needs MANAGE on THAT system (backend-enforced). */
  canRemoveSystem: (systemId: string) => boolean;
  onAddSystemToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveSystemFromEnvironment: (
    systemId: string,
    environmentId: string,
  ) => void;
}): React.ReactElement {
  return (
    <MembershipChips
      noun={{ one: "system", many: "systems" }}
      assigned={members.map((s) => ({ id: s.id, label: s.name }))}
      available={available.map((s) => ({ id: s.id, label: s.name }))}
      canAdd
      canRemove={(item) => canRemoveSystem(item.id)}
      onAdd={(systemId) => onAddSystemToEnvironment(systemId, environment.id)}
      onRemove={(systemId) =>
        onRemoveSystemFromEnvironment(systemId, environment.id)
      }
      removeLabel={(item) => `Remove ${item.label} from ${environment.name}`}
      addLabel={`Attach a system to ${environment.name}`}
      emptyAddLabel="All systems attached"
    />
  );
}

/** Team-scope / edit / delete action cluster, shared by row and card. */
function EnvironmentActions({
  environment,
  canManage,
  isLocked,
  onEditEnvironment,
  onDeleteEnvironment,
}: {
  environment: Environment;
  /** Manage grant on THIS environment gates edit/delete (backend-enforced). */
  canManage: boolean;
  isLocked: boolean;
  onEditEnvironment: (environment: Environment) => void;
  onDeleteEnvironment: (id: string) => void;
}): React.ReactElement {
  // A GitOps-managed environment is edited/deleted through its source repo; the
  // backend rejects both here, so disable them rather than 409 on click.
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;
  return (
    <RowActions>
      <ScopeToTeamAction
        resourceType={catalogResourceTypes.environment}
        resourceId={environment.id}
        resourceName={environment.name}
      />
      {canManage && (
        <RowAction
          icon={Pencil}
          label={`Edit ${environment.name}`}
          disabled={isLocked}
          title={lockTitle}
          onClick={() => onEditEnvironment(environment)}
        />
      )}
      {canManage && (
        <RowAction
          icon={Trash2}
          tone="destructive"
          label={`Delete ${environment.name}`}
          disabled={isLocked}
          title={lockTitle}
          onClick={() => onDeleteEnvironment(environment.id)}
        />
      )}
    </RowActions>
  );
}
