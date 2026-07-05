import { useMemo } from "react";
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ListEmptyState,
  RowAction,
  RowActions,
} from "@checkstack/ui";
import { Plus, Boxes, Pencil, Trash2, X } from "lucide-react";
import type { Environment, System } from "../../api";
import { AssignMenu } from "./AssignMenu";

export interface EnvironmentsTabProps {
  /** Environments after search/filter. */
  environments: Environment[];
  totalCount: number;
  /** Whether the user may create/edit/delete environment definitions. */
  canManage: boolean;
  allSystems: System[];
  onAddSystemToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveSystemFromEnvironment: (
    systemId: string,
    environmentId: string,
  ) => void;
  onAddEnvironment: () => void;
  onEditEnvironment: (environment: Environment) => void;
  onDeleteEnvironment: (id: string) => void;
  onClearFilters: () => void;
}

export function EnvironmentsTab(
  props: EnvironmentsTabProps,
): React.ReactElement {
  const { environments, totalCount, canManage, allSystems, onAddEnvironment } =
    props;

  const systemsById = useMemo(() => {
    const map = new Map<string, System>();
    for (const system of allSystems) map.set(system.id, system);
    return map;
  }, [allSystems]);

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
          Instance-wide environments carry free-form custom fields and can be
          attached to any system.
        </p>
      </div>
      {canManage && (
        <Button size="sm" onClick={onAddEnvironment}>
          <Plus className="mr-2 h-4 w-4" />
          Add Environment
        </Button>
      )}
    </div>
  );

  const columns: DataTableColumn<Environment>[] = [
    {
      id: "name",
      header: "Name",
      headClassName: "w-48",
      cellClassName: "align-top",
      sortValue: (environment) => environment.name,
      cell: (environment) => (
        <>
          <div className="font-medium text-foreground">{environment.name}</div>
          {environment.description && (
            <div className="text-xs text-muted-foreground">
              {environment.description}
            </div>
          )}
        </>
      ),
    },
    {
      id: "systems",
      header: "Systems",
      cell: (environment) => {
        const { members, available } = deriveEnvironmentMembers({
          environment,
          systemsById,
          allSystems,
        });
        return (
          <EnvironmentMembers
            environment={environment}
            members={members}
            available={available}
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
      cellClassName: "align-top text-sm text-muted-foreground",
      sortValue: (environment) =>
        Object.keys(environment.metadata ?? {}).length,
      cell: (environment) => Object.keys(environment.metadata ?? {}).length,
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-px text-right",
      cellClassName: "align-top",
      cell: (environment) =>
        canManage ? (
          <EnvironmentActions
            environment={environment}
            onEditEnvironment={props.onEditEnvironment}
            onDeleteEnvironment={props.onDeleteEnvironment}
          />
        ) : null,
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
            canManage ? (
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
      <DataTable
        data={environments}
        columns={columns}
        getRowId={(environment) => environment.id}
        searchable={false}
        defaultSort={{ columnId: "name", direction: "asc" }}
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
          });
          return (
            <Card className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {environment.name}
                  </div>
                  {environment.description && (
                    <div className="text-xs text-muted-foreground">
                      {environment.description}
                    </div>
                  )}
                </div>
                {canManage && (
                  <EnvironmentActions
                    environment={environment}
                    onEditEnvironment={props.onEditEnvironment}
                    onDeleteEnvironment={props.onDeleteEnvironment}
                  />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {fieldCount} {fieldCount === 1 ? "field" : "fields"}
              </p>
              <div className="mt-2">
                <EnvironmentMembers
                  environment={environment}
                  members={members}
                  available={available}
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
}: {
  environment: Environment;
  systemsById: Map<string, System>;
  allSystems: System[];
}): { members: System[]; available: System[]; fieldCount: number } {
  const memberIds = environment.systemIds ?? [];
  const members = memberIds
    .map((id) => systemsById.get(id))
    .filter((s): s is System => s !== undefined);
  const available = allSystems.filter((s) => !memberIds.includes(s.id));
  const fieldCount = Object.keys(environment.metadata ?? {}).length;
  return { members, available, fieldCount };
}

/** System membership chips plus the attach menu, shared by row and card. */
function EnvironmentMembers({
  environment,
  members,
  available,
  onAddSystemToEnvironment,
  onRemoveSystemFromEnvironment,
}: {
  environment: Environment;
  members: System[];
  available: System[];
  onAddSystemToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveSystemFromEnvironment: (
    systemId: string,
    environmentId: string,
  ) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {members.length === 0 && (
        <span className="text-xs text-muted-foreground">No systems</span>
      )}
      {members.map((system) => (
        <span
          key={system.id}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {system.name}
          <button
            type="button"
            aria-label={`Remove ${system.name} from ${environment.name}`}
            title={`Remove ${system.name}`}
            onClick={() =>
              onRemoveSystemFromEnvironment(system.id, environment.id)
            }
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <AssignMenu
        disabled={available.length === 0}
        triggerLabel={`Attach a system to ${environment.name}`}
        trigger={
          <>
            <Plus className="h-3 w-3" />
            System
          </>
        }
        items={available.map((s) => ({ id: s.id, label: s.name }))}
        emptyLabel="All systems attached"
        onSelect={(systemId) =>
          onAddSystemToEnvironment(systemId, environment.id)
        }
      />
    </div>
  );
}

/** Edit/delete action cluster, shared by row and card. */
function EnvironmentActions({
  environment,
  onEditEnvironment,
  onDeleteEnvironment,
}: {
  environment: Environment;
  onEditEnvironment: (environment: Environment) => void;
  onDeleteEnvironment: (id: string) => void;
}): React.ReactElement {
  return (
    <RowActions>
      <RowAction
        icon={Pencil}
        label={`Edit ${environment.name}`}
        onClick={() => onEditEnvironment(environment)}
      />
      <RowAction
        icon={Trash2}
        tone="destructive"
        label={`Delete ${environment.name}`}
        onClick={() => onDeleteEnvironment(environment.id)}
      />
    </RowActions>
  );
}
