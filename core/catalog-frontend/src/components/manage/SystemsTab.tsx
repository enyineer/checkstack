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
import { Plus, Server, Pencil, Trash2, Trash } from "lucide-react";
import type { Environment, Group, System } from "../../api";
import { CatalogApi } from "../../api";
import { AssignMenu } from "./AssignMenu";
import { MembershipChips } from "./MembershipChips";
import { CatalogBrowseDataBoundary } from "../browse/CatalogBrowseDataBoundary";

/** Stable empty group-id list: the manage systems table has no group rows. */
const NO_GROUP_IDS: string[] = [];

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

  // Every rendered row's id, handed to the CatalogSystemActionsSlot so a filler
  // (e.g. the health-check count badge) bulk-fetches per-system data for the
  // whole visible list in ONE deduped request instead of an N+1 per row. Same
  // array value for every row, so identical-input slot queries collapse to one.
  const visibleSystemIds = useMemo(() => systems.map((s) => s.id), [systems]);
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
      truncate: true,
      sortValue: (system) => system.name,
      cell: (system) => {
        const { isLocked, provenance } = getLock({
          kind: "System",
          entityId: system.id,
        });
        return (
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <p
                title={system.name}
                className="truncate font-medium leading-snug text-foreground"
              >
                {system.name}
              </p>
              {system.description && (
                <p
                  title={system.description}
                  className="truncate text-xs text-muted-foreground"
                >
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
      // Keep the state badges on ONE row (side by side), matching the browse and
      // detail views - `flex-wrap` in a fixed-narrow column made a second badge
      // wrap onto its own line and look stacked. Let the column size to content.
      headClassName: "whitespace-nowrap",
      cell: (system) => (
        <div className="flex items-center gap-1">
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
          isLocked={getLock({ kind: "System", entityId: system.id }).isLocked}
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
          visibleSystemIds={visibleSystemIds}
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

      {/*
       * Reuse catalog's shared badge-data boundary (the same one the browse view
       * uses) so every per-row SystemStateBadgesSlot contribution - health, SLO,
       * dependency, notification - reads its data from ONE bulk fetch per
       * provider instead of firing a per-system query per row (the Health-column
       * N+1). With no provider plugin installed it renders children unchanged.
       * The manage table has no group rows, so no group ids are surfaced.
       */}
      <CatalogBrowseDataBoundary
        systemIds={visibleSystemIds}
        groupIds={NO_GROUP_IDS}
      >
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
              visibleSystemIds={visibleSystemIds}
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
      </CatalogBrowseDataBoundary>
    </div>
  );
}

/** A system's group memberships as a compact count-pill + add menu. */
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
  const assigned = allGroups
    .filter((g) => assignedGroupIds.includes(g.id))
    .map((g) => ({ id: g.id, label: g.name }));
  const available = allGroups
    .filter((g) => !assignedGroupIds.includes(g.id))
    .map((g) => ({ id: g.id, label: g.name }));
  return (
    <MembershipChips
      noun={{ one: "group", many: "groups" }}
      assigned={assigned}
      available={available}
      canAdd={canManage}
      canRemove={() => canManage}
      isLocked={isLocked}
      lockReason="Managed by GitOps"
      onAdd={(groupId) => onAddToGroup(system.id, groupId)}
      onRemove={(groupId) => onRemoveFromGroup(groupId, system.id)}
      removeLabel={(item) => `Remove ${system.name} from ${item.label}`}
      addLabel={`Add ${system.name} to a group`}
      emptyAddLabel="No more groups"
    />
  );
}

/** A system's environment memberships as a compact count-pill + attach menu. */
function EnvChips({
  system,
  canManage,
  isLocked,
  allEnvironments,
  assignedEnvIds,
  onAddToEnvironment,
  onRemoveFromEnvironment,
}: {
  system: System;
  canManage: boolean;
  /** The system's GitOps lock also freezes its environment memberships. */
  isLocked: boolean;
  allEnvironments: Environment[];
  assignedEnvIds: string[];
  onAddToEnvironment: (systemId: string, environmentId: string) => void;
  onRemoveFromEnvironment: (systemId: string, environmentId: string) => void;
}): React.ReactElement {
  const assigned = allEnvironments
    .filter((e) => assignedEnvIds.includes(e.id))
    .map((e) => ({ id: e.id, label: e.name }));
  const available = allEnvironments
    .filter((e) => !assignedEnvIds.includes(e.id))
    .map((e) => ({ id: e.id, label: e.name }));
  return (
    <MembershipChips
      noun={{ one: "environment", many: "environments" }}
      assigned={assigned}
      available={available}
      canAdd={canManage}
      canRemove={() => canManage}
      isLocked={isLocked}
      lockReason="Managed by GitOps"
      onAdd={(envId) => onAddToEnvironment(system.id, envId)}
      onRemove={(envId) => onRemoveFromEnvironment(system.id, envId)}
      removeLabel={(item) => `Remove ${system.name} from ${item.label}`}
      addLabel={`Attach ${system.name} to an environment`}
      emptyAddLabel="No more environments"
    />
  );
}

interface SystemActionsProps {
  system: System;
  /** Whether the current user may manage (edit/delete) this system. */
  canManage: boolean;
  isLocked: boolean;
  /** Ids of every visible row, so slot fillers can bulk-fetch without N+1. */
  visibleSystemIds: string[];
  onEdit: (system: System) => void;
  onDelete: (id: string) => void;
}

/** Shared edit/delete action cluster used by row and mobile card. */
function SystemActions({
  system,
  canManage,
  isLocked,
  visibleSystemIds,
  onEdit,
  onDelete,
}: SystemActionsProps): React.ReactElement {
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;
  return (
    <RowActions>
      <ExtensionSlot
        slot={CatalogSystemActionsSlot}
        context={{
          systemId: system.id,
          systemName: system.name,
          visibleSystemIds,
        }}
      />
      {canManage && (
        <RowAction
          icon={Pencil}
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
  /** Ids of every visible row, so slot fillers can bulk-fetch without N+1. */
  visibleSystemIds: string[];
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
  visibleSystemIds,
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
            <p
              title={system.name}
              className="truncate font-medium leading-snug text-foreground"
            >
              {system.name}
            </p>
            {system.description && (
              <p
                title={system.description}
                className="truncate text-xs text-muted-foreground"
              >
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
          isLocked={isLocked}
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
          visibleSystemIds={visibleSystemIds}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </Card>
  );
}
