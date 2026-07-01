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
  Input,
  EmptyState,
  ListEmptyState,
  MobileCardList,
  ResponsiveTable,
} from "@checkstack/ui";
import {
  useProvenanceLock,
  GitOpsSourceBadge,
} from "@checkstack/gitops-frontend";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { catalogAccess, catalogResourceTypes } from "@checkstack/catalog-common";
import { Plus, LayoutGrid, Check, Pencil, Trash2, X } from "lucide-react";
import type { Group, System } from "../../api";
import { AssignMenu } from "./AssignMenu";

export interface GroupsTabProps {
  /** Groups after search/filter. */
  groups: Group[];
  totalCount: number;
  allSystems: System[];
  onAddGroup: () => void;
  onDeleteGroup: (id: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
  onClearFilters: () => void;
}

export function GroupsTab(props: GroupsTabProps): React.ReactElement {
  const { groups, totalCount, allSystems, onAddGroup } = props;

  const systemsById = useMemo(() => {
    const map = new Map<string, System>();
    for (const system of allSystems) map.set(system.id, system);
    return map;
  }, [allSystems]);

  const header = (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <LayoutGrid className="h-5 w-5 text-muted-foreground" />
        Groups
        <span className="text-sm font-normal text-muted-foreground">
          {totalCount}
        </span>
      </h2>
      <Button size="sm" onClick={onAddGroup}>
        <Plus className="mr-2 h-4 w-4" />
        Add Group
      </Button>
    </div>
  );

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
            <Button onClick={onAddGroup}>
              <Plus className="mr-2 h-4 w-4" />
              Add your first group
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      {header}
      {groups.length === 0 ? (
        <ListEmptyState
          resource="groups"
          description="No groups match the current search."
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
                  <TableHead className="w-64">Name</TableHead>
                  <TableHead>Systems</TableHead>
                  <TableHead className="w-px text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    systemsById={systemsById}
                    allSystems={allSystems}
                    onDelete={props.onDeleteGroup}
                    onRename={props.onRenameGroup}
                    onAddToGroup={props.onAddToGroup}
                    onRemoveFromGroup={props.onRemoveFromGroup}
                  />
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>

          <MobileCardList>
            {groups.map((group) => (
              <GroupMobileCard
                key={group.id}
                group={group}
                systemsById={systemsById}
                allSystems={allSystems}
                onDelete={props.onDeleteGroup}
                onRename={props.onRenameGroup}
                onAddToGroup={props.onAddToGroup}
                onRemoveFromGroup={props.onRemoveFromGroup}
              />
            ))}
          </MobileCardList>
        </>
      )}
    </div>
  );
}

interface GroupRowProps {
  group: Group;
  systemsById: Map<string, System>;
  allSystems: System[];
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
}

interface GroupRowState {
  isLocked: boolean;
  provenance: ReturnType<typeof useProvenanceLock>["provenance"];
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  commitRename: () => void;
  members: System[];
  available: System[];
  lockTitle: string | undefined;
}

/** Shared row/card behaviour: provenance lock, rename draft, membership lists. */
function useGroupRowState({
  group,
  systemsById,
  allSystems,
  onRename,
}: Pick<
  GroupRowProps,
  "group" | "systemsById" | "allSystems" | "onRename"
>): GroupRowState {
  const { isLocked, provenance } = useProvenanceLock({
    kind: "Group",
    entityId: group.id,
  });
  const accessApi = useApi(accessApiRef);
  // Adding a system to a group requires MANAGE on that SYSTEM, so only offer
  // systems the user actually manages (global-manage users get all).
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: allSystems.map((s) => s.id),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);

  const memberIds = group.systemIds ?? [];
  const members = memberIds
    .map((id) => systemsById.get(id))
    .filter((s): s is System => s !== undefined);
  const available = allSystems.filter(
    (s) => !memberIds.includes(s.id) && canAccess(s.id),
  );
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;

  const commitRename = (): void => {
    const next = draft.trim();
    if (next && next !== group.name) onRename(group.id, next);
    else setDraft(group.name);
    setEditing(false);
  };

  const startEditing = (): void => {
    setDraft(group.name);
    setEditing(true);
  };

  const cancelEditing = (): void => {
    setDraft(group.name);
    setEditing(false);
  };

  return {
    isLocked,
    provenance,
    editing,
    draft,
    setDraft,
    startEditing,
    cancelEditing,
    commitRename,
    members,
    available,
    lockTitle,
  };
}

/** Group name display / inline rename editor, shared by row and card. */
function GroupName({
  group,
  state,
}: {
  group: Group;
  state: GroupRowState;
}): React.ReactElement {
  const { isLocked, provenance, editing, draft, setDraft } = state;
  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={state.commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") state.commitRename();
          if (e.key === "Escape") state.cancelEditing();
        }}
        className="h-8"
        aria-label={`Rename ${group.name}`}
      />
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-foreground">{group.name}</span>
      {isLocked && provenance ? (
        <GitOpsSourceBadge provenance={provenance} />
      ) : (
        <button
          type="button"
          aria-label={`Rename ${group.name}`}
          className="text-muted-foreground hover:text-foreground"
          onClick={state.startEditing}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Group membership chips plus the assign-system menu, shared by row and card. */
function GroupMembers({
  group,
  state,
  onAddToGroup,
  onRemoveFromGroup,
}: {
  group: Group;
  state: GroupRowState;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
}): React.ReactElement {
  const { members, available, isLocked, lockTitle } = state;
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
            disabled={isLocked}
            title={lockTitle ?? `Remove ${system.name}`}
            aria-label={`Remove ${system.name} from ${group.name}`}
            onClick={() => onRemoveFromGroup(group.id, system.id)}
            className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <AssignMenu
        disabled={isLocked || available.length === 0}
        triggerLabel={lockTitle ?? `Add a system to ${group.name}`}
        trigger={
          <>
            <Plus className="h-3 w-3" />
            System
          </>
        }
        items={available.map((s) => ({ id: s.id, label: s.name }))}
        emptyLabel="All systems added"
        onSelect={(systemId) => onAddToGroup(systemId, group.id)}
      />
    </div>
  );
}

/** Save (when editing) / delete action cluster, shared by row and card. */
function GroupActions({
  group,
  state,
  onDelete,
}: {
  group: Group;
  state: GroupRowState;
  onDelete: (id: string) => void;
}): React.ReactElement {
  const { editing, isLocked, lockTitle } = state;
  return (
    <div className="flex items-center justify-end gap-1">
      {editing && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Save name"
          onClick={state.commitRename}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive/90"
        disabled={isLocked}
        title={lockTitle}
        aria-label={`Delete ${group.name}`}
        onClick={() => onDelete(group.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function GroupRow({
  group,
  systemsById,
  allSystems,
  onDelete,
  onRename,
  onAddToGroup,
  onRemoveFromGroup,
}: GroupRowProps): React.ReactElement {
  const state = useGroupRowState({ group, systemsById, allSystems, onRename });

  return (
    <TableRow>
      <TableCell className="align-top">
        <GroupName group={group} state={state} />
      </TableCell>
      <TableCell>
        <GroupMembers
          group={group}
          state={state}
          onAddToGroup={onAddToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
        />
      </TableCell>
      <TableCell>
        <GroupActions group={group} state={state} onDelete={onDelete} />
      </TableCell>
    </TableRow>
  );
}

function GroupMobileCard({
  group,
  systemsById,
  allSystems,
  onDelete,
  onRename,
  onAddToGroup,
  onRemoveFromGroup,
}: GroupRowProps): React.ReactElement {
  const state = useGroupRowState({ group, systemsById, allSystems, onRename });

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <GroupName group={group} state={state} />
        </div>
        <GroupActions group={group} state={state} onDelete={onDelete} />
      </div>
      <div className="mt-2">
        <GroupMembers
          group={group}
          state={state}
          onAddToGroup={onAddToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
        />
      </div>
    </Card>
  );
}
