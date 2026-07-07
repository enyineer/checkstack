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
import { ExtensionSlot, useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  CatalogSystemActionsSlot,
  CatalogSystemBulkActionsSlot,
  SystemStateBadgesSlot,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import {
  useProvenanceLocks,
  GitOpsSourceBadge,
  type ProvenanceLock,
} from "@checkstack/gitops-frontend";
import { Plus, Server, Edit, Trash2, X, Trash } from "lucide-react";
import type { Environment, Group, System } from "../../api";
import { CatalogApi } from "../../api";
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
    onRemoveFromGroup,
    onAddToEnvironment,
    onRemoveFromEnvironment,
  } = props;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const accessApi = useApi(accessApiRef);
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systems.map((s) => s.id),
  });
  // Creating a NEW system needs create capability (global rule or a team
  // `creator` grant) - distinct from managing an existing one. A user who only
  // manages existing systems reaches this page but must not see "Add System".
  const { allowed: canCreate } = accessApi.useProcedureAccess(
    CatalogApi.contract.createSystem,
  );
  // One bulk provenance query for every row (instead of a per-row fan-out): the
  // returned `getLock` is a plain lookup, so it can be called from column cell
  // renderers which cannot call hooks.
  const { getLock } = useProvenanceLocks();

  // Bulk assign/delete requires MANAGE on each SYSTEM, so only manageable
  // systems are selectable (global-manage users get all). Unmanageable rows
  // render a disabled checkbox and are excluded from "select all".
  const visibleIds = useMemo(
    () => systems.filter((s) => canAccess(s.id)).map((s) => s.id),
    [systems, canAccess],
  );
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
      {canCreate && (
        <Button size="sm" onClick={onAddSystem}>
          <Plus className="mr-2 h-4 w-4" />
          Add System
        </Button>
      )}
    </div>
  );

  const columns: DataTableColumn<System>[] = [
    {
      id: "select",
      headClassName: "w-10",
      header: (
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all systems"
        />
      ),
      cell: (system) => (
        <Checkbox
          checked={selected.has(system.id)}
          disabled={!canAccess(system.id)}
          onCheckedChange={() => toggle(system.id)}
          aria-label={`Select ${system.name}`}
        />
      ),
    },
    {
      id: "name",
      header: "Name",
      sortValue: (system) => system.name,
      cell: (system) => {
        const { isLocked, provenance } = getLock({
          kind: "System",
          entityId: system.id,
        });
        return (
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
        );
      },
    },
    {
      id: "health",
      header: "Health",
      headClassName: "w-44",
      cell: (system) => (
        <div className="flex flex-wrap items-center gap-1">
          <ExtensionSlot slot={SystemStateBadgesSlot} context={{ system }} />
        </div>
      ),
    },
    {
      id: "groups",
      header: "Groups",
      cell: (system) => (
        <GroupChips
          system={system}
          canManage={canAccess(system.id)}
          isLocked={getLock({ kind: "System", entityId: system.id }).isLocked}
          allGroups={allGroups}
          assignedGroupIds={systemGroupMap.get(system.id) ?? []}
          onAddToGroup={onAddToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
        />
      ),
    },
    {
      id: "environments",
      header: "Environments",
      cell: (system) => (
        <EnvChips
          system={system}
          canManage={canAccess(system.id)}
          allEnvironments={allEnvironments}
          assignedEnvIds={systemEnvMap.get(system.id) ?? []}
          onAddToEnvironment={onAddToEnvironment}
          onRemoveFromEnvironment={onRemoveFromEnvironment}
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-px text-right",
      cellClassName: "text-right",
      cell: (system) => (
        <SystemActions
          system={system}
          canManage={canAccess(system.id)}
          isLocked={getLock({ kind: "System", entityId: system.id }).isLocked}
          onEdit={props.onEditSystem}
          onDelete={props.onDeleteSystem}
        />
      ),
    },
  ];

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
            canCreate ? (
              <Button onClick={onAddSystem}>
                <Plus className="mr-2 h-4 w-4" />
                Add your first system
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

      <DataTable
        data={systems}
        columns={columns}
        getRowId={(system) => system.id}
        searchable={false}
        defaultSort={{ columnId: "name", direction: "asc" }}
        getRowProps={(system) => ({ selected: selected.has(system.id) })}
        noResultsState={
          <ListEmptyState
            resource="systems"
            description="No systems match the current search and filters."
            actions={
              <Button variant="outline" onClick={props.onClearFilters}>
                Clear filters
              </Button>
            }
          />
        }
        renderMobileCard={(system) => (
          <SystemMobileCard
            system={system}
            canManage={canAccess(system.id)}
            lock={getLock({ kind: "System", entityId: system.id })}
            allGroups={allGroups}
            allEnvironments={allEnvironments}
            assignedGroupIds={systemGroupMap.get(system.id) ?? []}
            assignedEnvIds={systemEnvMap.get(system.id) ?? []}
            selected={selected.has(system.id)}
            onToggleSelected={() => toggle(system.id)}
            onEdit={props.onEditSystem}
            onDelete={props.onDeleteSystem}
            onAddToGroup={onAddToGroup}
            onRemoveFromGroup={onRemoveFromGroup}
            onAddToEnvironment={onAddToEnvironment}
            onRemoveFromEnvironment={onRemoveFromEnvironment}
          />
        )}
      />
    </div>
  );
}

/**
 * A membership chip. Renders a removable "x" only when `canRemove` is true;
 * otherwise it's a plain read-only pill (removing a membership requires MANAGE
 * on the system, which the backend enforces).
 */
function Chip({
  label,
  onRemove,
  removeLabel,
  canRemove,
  disabled,
  disabledTitle,
}: {
  label: string;
  onRemove: () => void;
  removeLabel: string;
  canRemove: boolean;
  disabled?: boolean;
  disabledTitle?: string;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
      {label}
      {canRemove && (
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
      )}
    </span>
  );
}

/** Group membership chips + assign menu, shared by the desktop cell and mobile card. */
function GroupChips({
  system,
  canManage,
  isLocked,
  allGroups,
  assignedGroupIds,
  onAddToGroup,
  onRemoveFromGroup,
}: {
  system: System;
  canManage: boolean;
  isLocked: boolean;
  allGroups: Group[];
  assignedGroupIds: string[];
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
}): React.ReactElement {
  const assignedGroups = allGroups.filter((g) =>
    assignedGroupIds.includes(g.id),
  );
  const availableGroups = allGroups.filter(
    (g) => !assignedGroupIds.includes(g.id),
  );
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assignedGroups.map((group) => (
        <Chip
          key={group.id}
          label={group.name}
          removeLabel={`Remove ${system.name} from ${group.name}`}
          canRemove={canManage}
          disabled={isLocked}
          disabledTitle={lockTitle}
          onRemove={() => onRemoveFromGroup(group.id, system.id)}
        />
      ))}
      {canManage && (
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
      )}
    </div>
  );
}

/** Environment membership chips + attach menu, shared by the desktop cell and mobile card. */
function EnvChips({
  system,
  canManage,
  allEnvironments,
  assignedEnvIds,
  onAddToEnvironment,
  onRemoveFromEnvironment,
}: {
  system: System;
  canManage: boolean;
  allEnvironments: Environment[];
  assignedEnvIds: string[];
  onAddToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveFromEnvironment: (systemId: string, environmentId: string) => void;
}): React.ReactElement {
  const assignedEnvs = allEnvironments.filter((e) =>
    assignedEnvIds.includes(e.id),
  );
  const availableEnvs = allEnvironments.filter(
    (e) => !assignedEnvIds.includes(e.id),
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assignedEnvs.map((env) => (
        <Chip
          key={env.id}
          label={env.name}
          removeLabel={`Remove ${system.name} from ${env.name}`}
          canRemove={canManage}
          onRemove={() => onRemoveFromEnvironment(system.id, env.id)}
        />
      ))}
      {canManage && (
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
      )}
    </div>
  );
}

interface SystemActionsProps {
  system: System;
  /** Whether the current user may manage (edit/delete) this system. */
  canManage: boolean;
  isLocked: boolean;
  onEdit: (system: System) => void;
  onDelete: (id: string) => void;
}

/** Shared edit/delete action cluster used by row and mobile card. */
function SystemActions({
  system,
  canManage,
  isLocked,
  onEdit,
  onDelete,
}: SystemActionsProps): React.ReactElement {
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;
  return (
    <RowActions>
      <ExtensionSlot
        slot={CatalogSystemActionsSlot}
        context={{ systemId: system.id, systemName: system.name }}
      />
      {canManage && (
        <RowAction
          icon={Edit}
          label={`Edit ${system.name}`}
          disabled={isLocked}
          title={lockTitle}
          onClick={() => onEdit(system)}
        />
      )}
      {canManage && (
        <RowAction
          icon={Trash2}
          tone="destructive"
          label={`Delete ${system.name}`}
          disabled={isLocked}
          title={lockTitle}
          onClick={() => onDelete(system.id)}
        />
      )}
    </RowActions>
  );
}

interface SystemMobileCardProps {
  system: System;
  canManage: boolean;
  lock: ProvenanceLock;
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

function SystemMobileCard({
  system,
  canManage,
  lock,
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
}: SystemMobileCardProps): React.ReactElement {
  const { isLocked, provenance } = lock;

  return (
    <Card className="p-3" data-state={selected ? "selected" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Checkbox
            checked={selected}
            disabled={!canManage}
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
        <GroupChips
          system={system}
          canManage={canManage}
          isLocked={isLocked}
          allGroups={allGroups}
          assignedGroupIds={assignedGroupIds}
          onAddToGroup={onAddToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
        />
      </div>
      <div className="mt-2">
        <p className="mb-1 text-xs text-muted-foreground">Environments</p>
        <EnvChips
          system={system}
          canManage={canManage}
          allEnvironments={allEnvironments}
          assignedEnvIds={assignedEnvIds}
          onAddToEnvironment={onAddToEnvironment}
          onRemoveFromEnvironment={onRemoveFromEnvironment}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <SystemActions
          system={system}
          canManage={canManage}
          isLocked={isLocked}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </Card>
  );
}
