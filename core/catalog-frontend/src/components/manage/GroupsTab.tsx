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
  type ProvenanceLock,
} from "@checkstack/gitops-frontend";
import {
  useResourcesManagedBy,
  ResourceOwnerBadge,
  ScopeToTeamAction,
  BulkScopeToTeamAction,
  type ResourceOwnership,
} from "@checkstack/auth-frontend";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  CatalogApi,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import {
  Plus,
  LayoutGrid,
  Pencil,
  Trash2,
  Trash,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { Group, System } from "../../api";
import { AssignMenu } from "./AssignMenu";
import { MembershipChips } from "./MembershipChips";

export interface GroupsTabProps {
  /** Groups after search/filter. */
  groups: Group[];
  /** The FULL group list in persisted browse order, used to compute reorders. */
  orderedGroups: Group[];
  totalCount: number;
  allSystems: System[];
  onAddGroup: () => void;
  onEditGroup: (group: Group) => void;
  onDeleteGroup: (id: string) => void;
  onBulkDeleteGroups: (ids: string[]) => void;
  /** Persist a new browse order (full ordered list of group ids). */
  onReorderGroups: (orderedIds: string[]) => void;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
  onClearFilters: () => void;
}

export function GroupsTab(props: GroupsTabProps): React.ReactElement {
  const { groups, orderedGroups, totalCount, allSystems, onAddGroup } = props;

  // Reorder acts on the FULL persisted order. A search/filter that hides some
  // groups makes "move up/down" ambiguous, so reorder controls are disabled
  // until filters are cleared.
  const isFiltered = groups.length !== orderedGroups.length;
  const orderIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (const [index, group] of orderedGroups.entries()) {
      map.set(group.id, index);
    }
    return map;
  }, [orderedGroups]);

  const moveGroup = (group: Group, direction: "up" | "down"): void => {
    const ids = orderedGroups.map((g) => g.id);
    const index = ids.indexOf(group.id);
    if (index === -1) return;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[index], ids[swapWith]] = [ids[swapWith], ids[index]];
    props.onReorderGroups(ids);
  };

  const systemsById = useMemo(() => {
    const map = new Map<string, System>();
    for (const system of allSystems) map.set(system.id, system);
    return map;
  }, [allSystems]);

  // One bulk provenance query for every row; `getLock` is a plain lookup safe
  // to call from column cell renderers.
  const { getLock } = useProvenanceLocks();

  // Adding a system to a group requires MANAGE on that SYSTEM, so only offer
  // systems the user actually manages (global-manage users get all). Resolved
  // once for the whole tab rather than per row.
  const accessApi = useApi(accessApiRef);
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: allSystems.map((s) => s.id),
  });

  // Group create/manage capability. `Add Group` is gated on the create verdict
  // (true for group creators AND, via `alsoAcceptCreatorOf`, system creators);
  // per-row rename/delete are gated on a manage grant for THAT group. Resolved
  // once for the whole tab over the full ordered id set (not per row).
  const { allowed: canCreateGroup } = accessApi.useProcedureAccess(
    CatalogApi.contract.createGroup,
  );
  // Reordering rewrites the single global sort order for ALL groups, so
  // `reorderGroups` requires the GLOBAL group-manage rule (it is `global: true`,
  // not per-instance). A team-scoped group manager cannot reorder, so hide the
  // arrows for them rather than show a control that 403s on click.
  const { allowed: canReorderGroups } = accessApi.useAccess(
    catalogAccess.group.manage,
  );
  const groupManageIds = useMemo(
    () => orderedGroups.map((g) => g.id),
    [orderedGroups],
  );
  const { canAccess: canManageGroup } = accessApi.useResourceAccess({
    accessRule: catalogAccess.group.manage,
    objectType: catalogResourceTypes.group,
    resourceIds: groupManageIds,
  });
  // Owning team per group (batched over the full id set - no per-row N+1) so
  // each row shows who may rename/delete it. Gated on `auth.teams.read` inside
  // the hook, so it renders nothing for a viewer who cannot read teams.
  const { getOwnership } = useResourcesManagedBy({
    resourceType: catalogResourceTypes.group,
    resourceIds: groupManageIds,
  });

  // Bulk scope/assign/delete of a group all need MANAGE on that group, so only
  // manageable groups are selectable (global-manage users get all). Unmanageable
  // rows render a disabled checkbox and are excluded from "select all".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectableIds = useMemo(
    () => groups.filter((g) => canManageGroup(g.id)).map((g) => g.id),
    [groups, canManageGroup],
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
  // Systems offered in the bulk "Add system" menu. Attaching a system to a group
  // is authorized by MANAGE on that SYSTEM, so only offer manageable ones (the
  // same filter the per-row add uses); name-sorted for a stable menu.
  const manageableSystems = useMemo(
    () =>
      allSystems
        .filter((s) => canAccess(s.id))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [allSystems, canAccess],
  );

  const deriveMembers = (
    group: Group,
  ): { members: System[]; available: System[] } => {
    const memberIds = group.systemIds ?? [];
    const members = memberIds
      .map((id) => systemsById.get(id))
      .filter((s): s is System => s !== undefined);
    const available = allSystems.filter(
      (s) => !memberIds.includes(s.id) && canAccess(s.id),
    );
    return { members, available };
  };

  const header = (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <LayoutGrid className="h-5 w-5 text-muted-foreground" />
          Groups
          <span className="text-sm font-normal text-muted-foreground">
            {totalCount}
          </span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Groups are shared across the instance and everyone can see them. Only
          the owning team (or a global admin) can rename or delete a group.
        </p>
      </div>
      {canCreateGroup && (
        <Button size="sm" onClick={onAddGroup}>
          <Plus className="mr-2 h-4 w-4" />
          Add Group
        </Button>
      )}
    </div>
  );

  const columns: DataTableColumn<Group>[] = [
    {
      id: "select",
      headClassName: "w-10",
      header: (
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all groups"
        />
      ),
      cell: (group) => (
        <Checkbox
          checked={selected.has(group.id)}
          disabled={!canManageGroup(group.id)}
          onCheckedChange={() => toggle(group.id)}
          aria-label={`Select ${group.name}`}
        />
      ),
    },
    {
      id: "order",
      header: "Order",
      headClassName: "w-24",
      sortValue: (group) => orderIndexById.get(group.id) ?? group.sortOrder,
      cell: (group) => {
        const index = orderIndexById.get(group.id) ?? 0;
        return (
          <ReorderControls
            groupName={group.name}
            position={index + 1}
            canReorder={canReorderGroups}
            canMoveUp={index > 0}
            canMoveDown={index < orderedGroups.length - 1}
            disabled={isFiltered}
            onMoveUp={() => moveGroup(group, "up")}
            onMoveDown={() => moveGroup(group, "down")}
          />
        );
      },
    },
    {
      id: "name",
      header: "Name",
      truncate: true,
      sortValue: (group) => group.name,
      cell: (group) => (
        <GroupName
          group={group}
          isLocked={getLock({ kind: "Group", entityId: group.id }).isLocked}
          provenance={getLock({ kind: "Group", entityId: group.id }).provenance}
          ownership={getOwnership(group.id)}
        />
      ),
    },
    {
      id: "systems",
      header: "Systems",
      cell: (group) => {
        const { members, available } = deriveMembers(group);
        return (
          <GroupMembers
            group={group}
            members={members}
            available={available}
            isLocked={getLock({ kind: "Group", entityId: group.id }).isLocked}
            canRemoveSystem={canAccess}
            onAddToGroup={props.onAddToGroup}
            onRemoveFromGroup={props.onRemoveFromGroup}
          />
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-px text-right",
      cell: (group) => (
        <GroupActions
          group={group}
          isLocked={getLock({ kind: "Group", entityId: group.id }).isLocked}
          canManage={canManageGroup(group.id)}
          onEdit={props.onEditGroup}
          onDelete={props.onDeleteGroup}
        />
      ),
    },
  ];

  if (totalCount === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={<LayoutGrid className="size-10" />}
          title="No groups yet"
          description="Groups roll up the health of related systems into one status - useful per team, product, or environment."
          steps={[
            "Click “Add Group” and give it a meaningful name.",
            "Add systems to the group from here or the Systems tab.",
            "Subscribe to the group to alert your team on rolled-up incidents.",
          ]}
          actions={
            canCreateGroup ? (
              <Button onClick={onAddGroup}>
                <Plus className="mr-2 h-4 w-4" />
                Add your first group
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
            triggerLabel="Add a system to the selected groups"
            trigger={<span>Add system</span>}
            items={manageableSystems.map((s) => ({ id: s.id, label: s.name }))}
            emptyLabel="No systems you can manage"
            onSelect={(systemId) => {
              for (const groupId of selectedVisible) {
                const group = groups.find((g) => g.id === groupId);
                if (!group?.systemIds?.includes(systemId)) {
                  props.onAddToGroup(systemId, groupId);
                }
              }
              clearSelection();
            }}
          />
          <BulkScopeToTeamAction
            resourceType={catalogResourceTypes.group}
            resources={selectedVisible.map((id) => ({
              id,
              name: groups.find((g) => g.id === id)?.name ?? id,
            }))}
            onDone={clearSelection}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive/90"
            onClick={() => {
              props.onBulkDeleteGroups(selectedVisible);
              clearSelection();
            }}
          >
            <Trash className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
        </div>
      )}

      <DataTable
        data={groups}
        columns={columns}
        getRowId={(group) => group.id}
        searchable={false}
        defaultSort={{ columnId: "order", direction: "asc" }}
        getRowProps={(group) => ({ selected: selected.has(group.id) })}
        noResultsState={
          <ListEmptyState
            resource="groups"
            description="No groups match the current search."
            actions={
              <Button variant="outline" onClick={props.onClearFilters}>
                Clear filters
              </Button>
            }
          />
        }
        renderMobileCard={(group) => {
          const { members, available } = deriveMembers(group);
          const { isLocked, provenance } = getLock({
            kind: "Group",
            entityId: group.id,
          });
          const index = orderIndexById.get(group.id) ?? 0;
          return (
            <Card
              className="p-3"
              data-state={selected.has(group.id) ? "selected" : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Checkbox
                    checked={selected.has(group.id)}
                    disabled={!canManageGroup(group.id)}
                    onCheckedChange={() => toggle(group.id)}
                    aria-label={`Select ${group.name}`}
                  />
                  <ReorderControls
                    groupName={group.name}
                    position={index + 1}
                    canReorder={canReorderGroups}
                    canMoveUp={index > 0}
                    canMoveDown={index < orderedGroups.length - 1}
                    disabled={isFiltered}
                    onMoveUp={() => moveGroup(group, "up")}
                    onMoveDown={() => moveGroup(group, "down")}
                  />
                  <div className="min-w-0 flex-1">
                    <GroupName
                      group={group}
                      isLocked={isLocked}
                      provenance={provenance}
                      ownership={getOwnership(group.id)}
                    />
                  </div>
                </div>
                <GroupActions
                  group={group}
                  isLocked={isLocked}
                  canManage={canManageGroup(group.id)}
                  onEdit={props.onEditGroup}
                  onDelete={props.onDeleteGroup}
                />
              </div>
              <div className="mt-2">
                <GroupMembers
                  group={group}
                  members={members}
                  available={available}
                  isLocked={isLocked}
                  canRemoveSystem={canAccess}
                  onAddToGroup={props.onAddToGroup}
                  onRemoveFromGroup={props.onRemoveFromGroup}
                />
              </div>
            </Card>
          );
        }}
      />
    </div>
  );
}

/**
 * Up/down reorder controls plus the current 1-based position, shared by the
 * desktop row and the mobile card. Disabled while a filter is active (moving a
 * hidden neighbor is ambiguous) or at the ends of the list.
 */
function ReorderControls({
  groupName,
  position,
  canReorder,
  canMoveUp,
  canMoveDown,
  disabled,
  onMoveUp,
  onMoveDown,
}: {
  groupName: string;
  position: number;
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): React.ReactElement {
  const filteredTitle = disabled ? "Clear filters to reorder" : undefined;
  // Reorder needs the global group-manage rule; without it, show just the
  // position (the arrows would only 403 on click).
  if (!canReorder) {
    return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {position}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <div className="flex flex-col">
        <button
          type="button"
          disabled={disabled || !canMoveUp}
          title={filteredTitle ?? "Move up"}
          aria-label={`Move ${groupName} up`}
          onClick={onMoveUp}
          className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled || !canMoveDown}
          title={filteredTitle ?? "Move down"}
          aria-label={`Move ${groupName} down`}
          onClick={onMoveDown}
          className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {position}
      </span>
    </div>
  );
}

/** Group name display (owner + GitOps badges), shared by row and card. Editing
 * is done through the shared GroupEditor dialog (the row's Edit action), so this
 * is display-only - matching Systems and Environments. */
function GroupName({
  group,
  isLocked,
  provenance,
  ownership,
}: {
  group: Group;
  isLocked: boolean;
  provenance: ProvenanceLock["provenance"];
  ownership: ResourceOwnership | undefined;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium text-foreground">{group.name}</span>
      <ResourceOwnerBadge ownership={ownership} />
      {isLocked && provenance && <GitOpsSourceBadge provenance={provenance} />}
    </div>
  );
}

/** A group's member systems as a compact count-pill + assign-system menu. */
function GroupMembers({
  group,
  members,
  available,
  isLocked,
  canRemoveSystem,
  onAddToGroup,
  onRemoveFromGroup,
}: {
  group: Group;
  members: System[];
  available: System[];
  isLocked: boolean;
  /** Removing a member needs MANAGE on THAT system (backend-enforced). */
  canRemoveSystem: (systemId: string) => boolean;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
}): React.ReactElement {
  return (
    <MembershipChips
      noun={{ one: "system", many: "systems" }}
      assigned={members.map((s) => ({ id: s.id, label: s.name }))}
      available={available.map((s) => ({ id: s.id, label: s.name }))}
      canAdd
      canRemove={(item) => canRemoveSystem(item.id)}
      isLocked={isLocked}
      lockReason="Managed by GitOps"
      onAdd={(systemId) => onAddToGroup(systemId, group.id)}
      onRemove={(systemId) => onRemoveFromGroup(group.id, systemId)}
      removeLabel={(item) => `Remove ${item.label} from ${group.name}`}
      addLabel={`Add a system to ${group.name}`}
      emptyAddLabel="All systems added"
    />
  );
}

/** Save (when editing) / delete action cluster, shared by row and card. */
function GroupActions({
  group,
  isLocked,
  canManage,
  onEdit,
  onDelete,
}: {
  group: Group;
  isLocked: boolean;
  canManage: boolean;
  onEdit: (group: Group) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;
  return (
    <RowActions>
      {/* Managing the group's owning team is a teams-admin action (self-gated),
          independent of managing the group itself - so it can appear even for a
          team admin who doesn't own this group. */}
      <ScopeToTeamAction
        resourceType={catalogResourceTypes.group}
        resourceId={group.id}
        resourceName={group.name}
      />
      {/* Edit/delete need MANAGE on THIS group (the backend rejects otherwise). */}
      {canManage && (
        <RowAction
          icon={Pencil}
          label={`Edit ${group.name}`}
          disabled={isLocked}
          title={lockTitle}
          onClick={() => onEdit(group)}
        />
      )}
      {canManage && (
        <RowAction
          icon={Trash2}
          tone="destructive"
          label={`Delete ${group.name}`}
          disabled={isLocked}
          title={lockTitle}
          onClick={() => onDelete(group.id)}
        />
      )}
    </RowActions>
  );
}
