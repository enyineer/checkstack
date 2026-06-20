import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ListEmptyState,
  MobileCardList,
  ResponsiveTable,
  cn,
} from "@checkstack/ui";
import { ExtensionSlot } from "@checkstack/frontend-api";
import {
  CatalogSystemActionsSlot,
  CatalogSystemBulkActionsSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";
import {
  useProvenanceLock,
  GitOpsSourceBadge,
} from "@checkstack/gitops-frontend";
import { Plus, Server, Edit, Trash2, X, Trash } from "lucide-react";
import type { Environment, Group, System } from "../../api";
import { AssignMenu } from "./AssignMenu";

export interface SystemsTabProps {
  /** Systems after search/filter. */
  systems: System[];
  /** Total systems before filtering (distinguishes empty-catalog vs no-matches). */
  totalCount: number;
  allGroups: Group[];
  allEnvironments: Environment[];
  /** systemId -> the group ids it belongs to. */
  systemGroupMap: Map<string, string[]>;
  /** systemId -> the environment ids it's attached to. */
  systemEnvMap: Map<string, string[]>;
  onAddSystem: () => void;
  onEditSystem: (system: System) => void;
  onDeleteSystem: (id: string) => void;
  onBulkDeleteSystems: (ids: string[]) => void;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
  onAddToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveFromEnvironment: (systemId: string, environmentId: string) => void;
  onClearFilters: () => void;
}

export function SystemsTab(props: SystemsTabProps): React.ReactElement {
  const {
    systems,
    totalCount,
    allGroups,
    allEnvironments,
    systemGroupMap,
    systemEnvMap,
    onAddSystem,
    onBulkDeleteSystems,
    onAddToGroup,
    onAddToEnvironment,
  } = props;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visibleIds = useMemo(() => systems.map((s) => s.id), [systems]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allSelected =
    visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set(visibleIds));

  const clearSelection = (): void => setSelected(new Set());

  const header = (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Server className="h-5 w-5 text-muted-foreground" />
        Systems
        <span className="text-sm font-normal text-muted-foreground">
          {totalCount}
        </span>
      </h2>
      <Button size="sm" onClick={onAddSystem}>
        <Plus className="mr-2 h-4 w-4" />
        Add System
      </Button>
    </div>
  );

  if (totalCount === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={<Server className="size-10" />}
          title="No systems yet"
          description="Systems are the things you monitor. Add one, then attach health checks, SLOs, maintenance windows and incident history to it."
          steps={[
            "Click “Add System” to register your first service, host or job.",
            "Group related systems so dashboards and on-call rotations stay tidy.",
            "Wire health checks so a system's status reflects reality.",
          ]}
          actions={
            <Button onClick={onAddSystem}>
              <Plus className="mr-2 h-4 w-4" />
              Add your first system
            </Button>
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
            triggerLabel="Assign selected systems to a group"
            trigger={<span>Assign to group</span>}
            items={allGroups.map((g) => ({ id: g.id, label: g.name }))}
            emptyLabel="No groups yet"
            onSelect={(groupId) => {
              for (const sysId of selectedVisible) {
                if (!systemGroupMap.get(sysId)?.includes(groupId)) {
                  onAddToGroup(sysId, groupId);
                }
              }
              clearSelection();
            }}
          />
          <AssignMenu
            triggerLabel="Attach selected systems to an environment"
            trigger={<span>Add to environment</span>}
            items={allEnvironments.map((e) => ({ id: e.id, label: e.name }))}
            emptyLabel="No environments yet"
            onSelect={(envId) => {
              for (const sysId of selectedVisible) {
                if (!systemEnvMap.get(sysId)?.includes(envId)) {
                  onAddToEnvironment(sysId, envId);
                }
              }
              clearSelection();
            }}
          />
          <ExtensionSlot
            slot={CatalogSystemBulkActionsSlot}
            context={{
              systems: selectedVisible.map((id) => ({
                id,
                name: systems.find((s) => s.id === id)?.name ?? id,
              })),
              onDone: clearSelection,
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive/90"
            onClick={() => {
              onBulkDeleteSystems(selectedVisible);
              clearSelection();
            }}
          >
            <Trash className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
        </div>
      )}

      {systems.length === 0 ? (
        <ListEmptyState
          resource="systems"
          description="No systems match the current search and filters."
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
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all systems"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-44">Health</TableHead>
                  <TableHead>Groups</TableHead>
                  <TableHead>Environments</TableHead>
                  <TableHead className="w-px text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {systems.map((system) => (
                  <SystemRow
                    key={system.id}
                    system={system}
                    allGroups={allGroups}
                    allEnvironments={allEnvironments}
                    assignedGroupIds={systemGroupMap.get(system.id) ?? []}
                    assignedEnvIds={systemEnvMap.get(system.id) ?? []}
                    selected={selected.has(system.id)}
                    onToggleSelected={() => toggle(system.id)}
                    onEdit={props.onEditSystem}
                    onDelete={props.onDeleteSystem}
                    onAddToGroup={props.onAddToGroup}
                    onRemoveFromGroup={props.onRemoveFromGroup}
                    onAddToEnvironment={props.onAddToEnvironment}
                    onRemoveFromEnvironment={props.onRemoveFromEnvironment}
                  />
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>

          <MobileCardList>
            {systems.map((system) => (
              <SystemMobileCard
                key={system.id}
                system={system}
                allGroups={allGroups}
                allEnvironments={allEnvironments}
                assignedGroupIds={systemGroupMap.get(system.id) ?? []}
                assignedEnvIds={systemEnvMap.get(system.id) ?? []}
                selected={selected.has(system.id)}
                onToggleSelected={() => toggle(system.id)}
                onEdit={props.onEditSystem}
                onDelete={props.onDeleteSystem}
                onAddToGroup={props.onAddToGroup}
                onRemoveFromGroup={props.onRemoveFromGroup}
                onAddToEnvironment={props.onAddToEnvironment}
                onRemoveFromEnvironment={props.onRemoveFromEnvironment}
              />
            ))}
          </MobileCardList>
        </>
      )}
    </div>
  );
}

interface SystemRowProps {
  system: System;
  allGroups: Group[];
  allEnvironments: Environment[];
  assignedGroupIds: string[];
  assignedEnvIds: string[];
  selected: boolean;
  onToggleSelected: () => void;
  onEdit: (system: System) => void;
  onDelete: (id: string) => void;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
  onAddToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveFromEnvironment: (systemId: string, environmentId: string) => void;
}

/** A removable membership chip. */
function Chip({
  label,
  onRemove,
  removeLabel,
  disabled,
  disabledTitle,
}: {
  label: string;
  onRemove: () => void;
  removeLabel: string;
  disabled?: boolean;
  disabledTitle?: string;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
      {label}
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledTitle : removeLabel}
        aria-label={removeLabel}
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function SystemRow({
  system,
  allGroups,
  allEnvironments,
  assignedGroupIds,
  assignedEnvIds,
  selected,
  onToggleSelected,
  onEdit,
  onDelete,
  onAddToGroup,
  onRemoveFromGroup,
  onAddToEnvironment,
  onRemoveFromEnvironment,
}: SystemRowProps): React.ReactElement {
  const { isLocked, provenance } = useProvenanceLock({
    kind: "System",
    entityId: system.id,
  });

  const assignedGroups = allGroups.filter((g) =>
    assignedGroupIds.includes(g.id),
  );
  const availableGroups = allGroups.filter(
    (g) => !assignedGroupIds.includes(g.id),
  );
  const assignedEnvs = allEnvironments.filter((e) =>
    assignedEnvIds.includes(e.id),
  );
  const availableEnvs = allEnvironments.filter(
    (e) => !assignedEnvIds.includes(e.id),
  );
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label={`Select ${system.name}`}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <p className="font-medium leading-snug text-foreground">
              {system.name}
            </p>
            {system.description && (
              <p className="truncate text-xs text-muted-foreground">
                {system.description}
              </p>
            )}
          </div>
          {isLocked && provenance && (
            <GitOpsSourceBadge provenance={provenance} />
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <ExtensionSlot slot={SystemStateBadgesSlot} context={{ system }} />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          {assignedGroups.map((group) => (
            <Chip
              key={group.id}
              label={group.name}
              removeLabel={`Remove ${system.name} from ${group.name}`}
              disabled={isLocked}
              disabledTitle={lockTitle}
              onRemove={() => onRemoveFromGroup(group.id, system.id)}
            />
          ))}
          <AssignMenu
            disabled={isLocked || availableGroups.length === 0}
            triggerLabel={lockTitle ?? `Add ${system.name} to a group`}
            trigger={
              <>
                <Plus className="h-3 w-3" />
                Group
              </>
            }
            items={availableGroups.map((g) => ({ id: g.id, label: g.name }))}
            emptyLabel="No more groups"
            onSelect={(groupId) => onAddToGroup(system.id, groupId)}
          />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          {assignedEnvs.map((env) => (
            <Chip
              key={env.id}
              label={env.name}
              removeLabel={`Remove ${system.name} from ${env.name}`}
              onRemove={() => onRemoveFromEnvironment(system.id, env.id)}
            />
          ))}
          <AssignMenu
            disabled={availableEnvs.length === 0}
            triggerLabel={`Attach ${system.name} to an environment`}
            trigger={
              <>
                <Plus className="h-3 w-3" />
                Environment
              </>
            }
            items={availableEnvs.map((e) => ({ id: e.id, label: e.name }))}
            emptyLabel="No more environments"
            onSelect={(envId) => onAddToEnvironment(system.id, envId)}
          />
        </div>
      </TableCell>
      <TableCell>
        <SystemActions
          system={system}
          isLocked={isLocked}
          lockTitle={lockTitle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </TableCell>
    </TableRow>
  );
}

interface SystemActionsProps {
  system: System;
  isLocked: boolean;
  lockTitle: string | undefined;
  onEdit: (system: System) => void;
  onDelete: (id: string) => void;
}

/** Shared edit/delete action cluster used by row and mobile card. */
function SystemActions({
  system,
  isLocked,
  lockTitle,
  onEdit,
  onDelete,
}: SystemActionsProps): React.ReactElement {
  return (
    <div className="flex items-center justify-end gap-1">
      <ExtensionSlot
        slot={CatalogSystemActionsSlot}
        context={{ systemId: system.id, systemName: system.name }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        disabled={isLocked}
        title={lockTitle}
        aria-label={`Edit ${system.name}`}
        onClick={() => onEdit(system)}
      >
        <Edit className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive/90",
        )}
        disabled={isLocked}
        title={lockTitle}
        aria-label={`Delete ${system.name}`}
        onClick={() => onDelete(system.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function SystemMobileCard({
  system,
  allGroups,
  allEnvironments,
  assignedGroupIds,
  assignedEnvIds,
  selected,
  onToggleSelected,
  onEdit,
  onDelete,
  onAddToGroup,
  onRemoveFromGroup,
  onAddToEnvironment,
  onRemoveFromEnvironment,
}: SystemRowProps): React.ReactElement {
  const { isLocked, provenance } = useProvenanceLock({
    kind: "System",
    entityId: system.id,
  });

  const assignedGroups = allGroups.filter((g) =>
    assignedGroupIds.includes(g.id),
  );
  const availableGroups = allGroups.filter(
    (g) => !assignedGroupIds.includes(g.id),
  );
  const assignedEnvs = allEnvironments.filter((e) =>
    assignedEnvIds.includes(e.id),
  );
  const availableEnvs = allEnvironments.filter(
    (e) => !assignedEnvIds.includes(e.id),
  );
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;

  return (
    <Card className="p-3" data-state={selected ? "selected" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelected}
            aria-label={`Select ${system.name}`}
          />
          <div className="min-w-0">
            <p className="font-medium leading-snug text-foreground">
              {system.name}
            </p>
            {system.description && (
              <p className="truncate text-xs text-muted-foreground">
                {system.description}
              </p>
            )}
          </div>
        </div>
        {isLocked && provenance && (
          <GitOpsSourceBadge provenance={provenance} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <ExtensionSlot slot={SystemStateBadgesSlot} context={{ system }} />
      </div>
      <div className="mt-2">
        <p className="mb-1 text-xs text-muted-foreground">Groups</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {assignedGroups.map((group) => (
            <Chip
              key={group.id}
              label={group.name}
              removeLabel={`Remove ${system.name} from ${group.name}`}
              disabled={isLocked}
              disabledTitle={lockTitle}
              onRemove={() => onRemoveFromGroup(group.id, system.id)}
            />
          ))}
          <AssignMenu
            disabled={isLocked || availableGroups.length === 0}
            triggerLabel={lockTitle ?? `Add ${system.name} to a group`}
            trigger={
              <>
                <Plus className="h-3 w-3" />
                Group
              </>
            }
            items={availableGroups.map((g) => ({ id: g.id, label: g.name }))}
            emptyLabel="No more groups"
            onSelect={(groupId) => onAddToGroup(system.id, groupId)}
          />
        </div>
      </div>
      <div className="mt-2">
        <p className="mb-1 text-xs text-muted-foreground">Environments</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {assignedEnvs.map((env) => (
            <Chip
              key={env.id}
              label={env.name}
              removeLabel={`Remove ${system.name} from ${env.name}`}
              onRemove={() => onRemoveFromEnvironment(system.id, env.id)}
            />
          ))}
          <AssignMenu
            disabled={availableEnvs.length === 0}
            triggerLabel={`Attach ${system.name} to an environment`}
            trigger={
              <>
                <Plus className="h-3 w-3" />
                Environment
              </>
            }
            items={availableEnvs.map((e) => ({ id: e.id, label: e.name }))}
            emptyLabel="No more environments"
            onSelect={(envId) => onAddToEnvironment(system.id, envId)}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <SystemActions
          system={system}
          isLocked={isLocked}
          lockTitle={lockTitle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </Card>
  );
}
