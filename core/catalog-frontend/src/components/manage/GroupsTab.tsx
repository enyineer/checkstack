import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  Input,
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

  // A single inline-rename slot lifted to the tab (you rename one group at a
  // time). Shared between the Name cell's input and the Actions cell's save.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEditing = (group: Group): void => {
    setDraft(group.name);
    setEditingId(group.id);
  };
  const cancelEditing = (): void => setEditingId(null);
  const commitRename = (group: Group): void => {
    const next = draft.trim();
    if (next && next !== group.name) props.onRenameGroup(group.id, next);
    setEditingId(null);
  };

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

  const columns: DataTableColumn<Group>[] = [
    {
      id: "name",
      header: "Name",
      headClassName: "w-64",
      cellClassName: "align-top",
      sortValue: (group) => group.name,
      cell: (group) => (
        <GroupName
          group={group}
          isLocked={getLock({ kind: "Group", entityId: group.id }).isLocked}
          provenance={getLock({ kind: "Group", entityId: group.id }).provenance}
          editing={editingId === group.id}
          draft={draft}
          onDraftChange={setDraft}
          onStartEditing={() => startEditing(group)}
          onCommit={() => commitRename(group)}
          onCancel={cancelEditing}
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
          editing={editingId === group.id}
          isLocked={getLock({ kind: "Group", entityId: group.id }).isLocked}
          onCommit={() => commitRename(group)}
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
      <DataTable
        data={groups}
        columns={columns}
        getRowId={(group) => group.id}
        searchable={false}
        defaultSort={{ columnId: "name", direction: "asc" }}
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
          return (
            <Card className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <GroupName
                    group={group}
                    isLocked={isLocked}
                    provenance={provenance}
                    editing={editingId === group.id}
                    draft={draft}
                    onDraftChange={setDraft}
                    onStartEditing={() => startEditing(group)}
                    onCommit={() => commitRename(group)}
                    onCancel={cancelEditing}
                  />
                </div>
                <GroupActions
                  group={group}
                  editing={editingId === group.id}
                  isLocked={isLocked}
                  onCommit={() => commitRename(group)}
                  onDelete={props.onDeleteGroup}
                />
              </div>
              <div className="mt-2">
                <GroupMembers
                  group={group}
                  members={members}
                  available={available}
                  isLocked={isLocked}
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

/** Group name display / inline rename editor, shared by row and card. */
function GroupName({
  group,
  isLocked,
  provenance,
  editing,
  draft,
  onDraftChange,
  onStartEditing,
  onCommit,
  onCancel,
}: {
  group: Group;
  isLocked: boolean;
  provenance: ProvenanceLock["provenance"];
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartEditing: () => void;
  onCommit: () => void;
  onCancel: () => void;
}): React.ReactElement {
  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
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
          onClick={onStartEditing}
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
  members,
  available,
  isLocked,
  onAddToGroup,
  onRemoveFromGroup,
}: {
  group: Group;
  members: System[];
  available: System[];
  isLocked: boolean;
  onAddToGroup: (systemId: string, groupId: string) => void;
  onRemoveFromGroup: (groupId: string, systemId: string) => void;
}): React.ReactElement {
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;
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
  editing,
  isLocked,
  onCommit,
  onDelete,
}: {
  group: Group;
  editing: boolean;
  isLocked: boolean;
  onCommit: () => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  const lockTitle = isLocked ? "Managed by GitOps" : undefined;
  return (
    <RowActions>
      {editing && (
        <RowAction icon={Check} label="Save name" onClick={onCommit} />
      )}
      <RowAction
        icon={Trash2}
        tone="destructive"
        label={`Delete ${group.name}`}
        disabled={isLocked}
        title={lockTitle}
        onClick={() => onDelete(group.id)}
      />
    </RowActions>
  );
}
