import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  EmptyState,
  ListEmptyState,
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
        <div className="rounded-lg border border-border">
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
              {environments.map((environment) => {
                const fieldCount = Object.keys(
                  environment.metadata ?? {},
                ).length;
                const memberIds = environment.systemIds ?? [];
                const members = memberIds
                  .map((id) => systemsById.get(id))
                  .filter((s): s is System => s !== undefined);
                const available = allSystems.filter(
                  (s) => !memberIds.includes(s.id),
                );
                return (
                  <TableRow key={environment.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-foreground">
                        {environment.name}
                      </div>
                      {environment.description && (
                        <div className="text-xs text-muted-foreground">
                          {environment.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {members.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            No systems
                          </span>
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
                                props.onRemoveSystemFromEnvironment(
                                  system.id,
                                  environment.id,
                                )
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
                          items={available.map((s) => ({
                            id: s.id,
                            label: s.name,
                          }))}
                          emptyLabel="All systems attached"
                          onSelect={(systemId) =>
                            props.onAddSystemToEnvironment(
                              systemId,
                              environment.id,
                            )
                          }
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {fieldCount}
                    </TableCell>
                    <TableCell className="align-top">
                      {canManage && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            aria-label={`Edit ${environment.name}`}
                            onClick={() => props.onEditEnvironment(environment)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive/90"
                            aria-label={`Delete ${environment.name}`}
                            onClick={() =>
                              props.onDeleteEnvironment(environment.id)
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
