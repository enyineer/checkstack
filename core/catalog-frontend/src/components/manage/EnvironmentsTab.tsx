import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Card,
  EmptyState,
  ListEmptyState,
  MobileCardList,
  ResponsiveTable,
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
      {environments.length === 0 ? (
        <ListEmptyState
          resource="environments"
          description="No environments match the current search."
          actions={
            <Button variant="outline" onClick={props.onClearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <ResponsiveTable className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Name</TableHead>
                  <TableHead>Systems</TableHead>
                  <TableHead className="w-20">Fields</TableHead>
                  <TableHead className="w-px text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {environments.map((environment) => (
                  <EnvironmentRow
                    key={environment.id}
                    environment={environment}
                    canManage={canManage}
                    systemsById={systemsById}
                    allSystems={allSystems}
                    onAddSystemToEnvironment={props.onAddSystemToEnvironment}
                    onRemoveSystemFromEnvironment={
                      props.onRemoveSystemFromEnvironment
                    }
                    onEditEnvironment={props.onEditEnvironment}
                    onDeleteEnvironment={props.onDeleteEnvironment}
                  />
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>

          <MobileCardList>
            {environments.map((environment) => (
              <EnvironmentMobileCard
                key={environment.id}
                environment={environment}
                canManage={canManage}
                systemsById={systemsById}
                allSystems={allSystems}
                onAddSystemToEnvironment={props.onAddSystemToEnvironment}
                onRemoveSystemFromEnvironment={
                  props.onRemoveSystemFromEnvironment
                }
                onEditEnvironment={props.onEditEnvironment}
                onDeleteEnvironment={props.onDeleteEnvironment}
              />
            ))}
          </MobileCardList>
        </>
      )}
    </div>
  );
}

interface EnvironmentRowProps {
  environment: Environment;
  canManage: boolean;
  systemsById: Map<string, System>;
  allSystems: System[];
  onAddSystemToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveSystemFromEnvironment: (
    systemId: string,
    environmentId: string,
  ) => void;
  onEditEnvironment: (environment: Environment) => void;
  onDeleteEnvironment: (id: string) => void;
}

/** Derive the member systems and the still-attachable systems for an env. */
function useEnvironmentMembers({
  environment,
  systemsById,
  allSystems,
}: Pick<
  EnvironmentRowProps,
  "environment" | "systemsById" | "allSystems"
>): { members: System[]; available: System[]; fieldCount: number } {
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
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label={`Edit ${environment.name}`}
        onClick={() => onEditEnvironment(environment)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive/90"
        aria-label={`Delete ${environment.name}`}
        onClick={() => onDeleteEnvironment(environment.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function EnvironmentRow({
  environment,
  canManage,
  systemsById,
  allSystems,
  onAddSystemToEnvironment,
  onRemoveSystemFromEnvironment,
  onEditEnvironment,
  onDeleteEnvironment,
}: EnvironmentRowProps): React.ReactElement {
  const { members, available, fieldCount } = useEnvironmentMembers({
    environment,
    systemsById,
    allSystems,
  });

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium text-foreground">{environment.name}</div>
        {environment.description && (
          <div className="text-xs text-muted-foreground">
            {environment.description}
          </div>
        )}
      </TableCell>
      <TableCell>
        <EnvironmentMembers
          environment={environment}
          members={members}
          available={available}
          onAddSystemToEnvironment={onAddSystemToEnvironment}
          onRemoveSystemFromEnvironment={onRemoveSystemFromEnvironment}
        />
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        {fieldCount}
      </TableCell>
      <TableCell className="align-top">
        {canManage && (
          <EnvironmentActions
            environment={environment}
            onEditEnvironment={onEditEnvironment}
            onDeleteEnvironment={onDeleteEnvironment}
          />
        )}
      </TableCell>
    </TableRow>
  );
}

function EnvironmentMobileCard({
  environment,
  canManage,
  systemsById,
  allSystems,
  onAddSystemToEnvironment,
  onRemoveSystemFromEnvironment,
  onEditEnvironment,
  onDeleteEnvironment,
}: EnvironmentRowProps): React.ReactElement {
  const { members, available, fieldCount } = useEnvironmentMembers({
    environment,
    systemsById,
    allSystems,
  });

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{environment.name}</div>
          {environment.description && (
            <div className="text-xs text-muted-foreground">
              {environment.description}
            </div>
          )}
        </div>
        {canManage && (
          <EnvironmentActions
            environment={environment}
            onEditEnvironment={onEditEnvironment}
            onDeleteEnvironment={onDeleteEnvironment}
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
          onAddSystemToEnvironment={onAddSystemToEnvironment}
          onRemoveSystemFromEnvironment={onRemoveSystemFromEnvironment}
        />
      </div>
    </Card>
  );
}
