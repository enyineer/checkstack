import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  useApi,
  accessApiRef,
  usePluginClient,
} from "@checkstack/frontend-api";
import { System, CatalogApi } from "../api";
import {
  catalogAccess,
  pluginMetadata as catalogPluginMetadata,
} from "@checkstack/catalog-common";
import { Tip } from "@checkstack/tips-frontend";
import {
  PageLayout,
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Button,
  EmptyState,
  ConfirmationModal,
  useToast,
} from "@checkstack/ui";
import { Plus, FolderPlus, LayoutGrid, Server } from "lucide-react";
import { SystemEditor } from "./SystemEditor";
import { GroupEditor } from "./GroupEditor";
import { DraggableSystem, SystemDragOverlay } from "./DraggableSystem";
import { DroppableGroup } from "./DroppableGroup";
import { extractErrorMessage } from "@checkstack/common";

export const CatalogConfigPage = () => {
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    catalogAccess.system.manage,
  );

  // Dialog state
  const [isSystemEditorOpen, setIsSystemEditorOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<System | undefined>();
  const [isGroupEditorOpen, setIsGroupEditorOpen] = useState(false);

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Drag-and-drop state
  const [activeSystemId, setActiveSystemId] = useState<string | undefined>();
  const [overGroupId, setOverGroupId] = useState<string | undefined>();
  // Tracks which system was most recently added to which group (for glow animation)
  const [recentlyAdded, setRecentlyAdded] = useState<{ systemId: string; groupId: string } | undefined>();

  // Fetch systems with useQuery
  const {
    data: systemsData,
    isLoading: systemsLoading,
    refetch: refetchSystems,
  } = catalogClient.getSystems.useQuery({});

  // Fetch groups with useQuery
  const {
    data: groupsData,
    isLoading: groupsLoading,
    refetch: refetchGroups,
  } = catalogClient.getGroups.useQuery({});

  const systems = systemsData?.systems ?? [];
  const groups = groupsData ?? [];
  const loading = systemsLoading || groupsLoading;

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setIsSystemEditorOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  // DnD sensors — pointer for desktop, touch for mobile
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 8px movement tolerance prevents accidental drags on clicks
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      // 250ms delay for touch to avoid conflicts with scrolling
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  // Mutations
  const createSystemMutation = catalogClient.createSystem.useMutation({
    onSuccess: () => {
      toast.success("System created successfully");
      setIsSystemEditorOpen(false);
      void refetchSystems();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to create system"),
      );
    },
  });

  const updateSystemMutation = catalogClient.updateSystem.useMutation({
    onSuccess: () => {
      toast.success("System updated successfully");
      setIsSystemEditorOpen(false);
      setEditingSystem(undefined);
      void refetchSystems();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to update system"),
      );
    },
  });

  const deleteSystemMutation = catalogClient.deleteSystem.useMutation({
    onSuccess: () => {
      toast.success("System deleted successfully");
      setConfirmModal({ ...confirmModal, isOpen: false });
      void refetchSystems();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to delete system"),
      );
    },
  });

  const createGroupMutation = catalogClient.createGroup.useMutation({
    onSuccess: () => {
      toast.success("Group created successfully");
      setIsGroupEditorOpen(false);
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to create group"),
      );
    },
  });

  const deleteGroupMutation = catalogClient.deleteGroup.useMutation({
    onSuccess: () => {
      toast.success("Group deleted successfully");
      setConfirmModal({ ...confirmModal, isOpen: false });
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to delete group"),
      );
    },
  });

  const updateGroupMutation = catalogClient.updateGroup.useMutation({
    onSuccess: () => {
      toast.success("Group name updated successfully");
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to update group name"),
      );
      throw error;
    },
  });

  const addSystemToGroupMutation = catalogClient.addSystemToGroup.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("System added to group successfully");
      setRecentlyAdded({ systemId: variables.systemId, groupId: variables.groupId });
      setTimeout(() => setRecentlyAdded(undefined), 1500);
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to add system to group"),
      );
    },
  });

  const removeSystemFromGroupMutation =
    catalogClient.removeSystemFromGroup.useMutation({
      onSuccess: () => {
        toast.success("System removed from group successfully");
        void refetchGroups();
      },
      onError: (error) => {
        toast.error(
          extractErrorMessage(error, "Failed to remove system from group"),
        );
      },
    });

  // Handlers
  const handleSaveSystem = async (data: {
    name: string;
    description?: string;
  }) => {
    if (editingSystem) {
      updateSystemMutation.mutate({ id: editingSystem.id, data });
    } else {
      createSystemMutation.mutate(data);
    }
  };

  const handleCreateGroup = async (data: { name: string }) => {
    createGroupMutation.mutate(data);
  };

  const handleDeleteSystem = (id: string) => {
    const system = systems.find((s) => s.id === id);
    setConfirmModal({
      isOpen: true,
      title: "Delete System",
      message: `Are you sure you want to delete "${system?.name}"? This will remove the system from all groups as well.`,
      onConfirm: () => {
        deleteSystemMutation.mutate(id);
      },
    });
  };

  const handleDeleteGroup = (id: string) => {
    const group = groups.find((g) => g.id === id);
    setConfirmModal({
      isOpen: true,
      title: "Delete Group",
      message: `Are you sure you want to delete "${group?.name}"? This action cannot be undone.`,
      onConfirm: () => {
        deleteGroupMutation.mutate(id);
      },
    });
  };

  const handleAddSystemToGroup = (systemId: string, groupId: string) => {
    addSystemToGroupMutation.mutate({ groupId, systemId });
  };

  const handleRemoveSystemFromGroup = (groupId: string, systemId: string) => {
    removeSystemFromGroupMutation.mutate({ groupId, systemId });
  };

  const handleUpdateGroupName = (id: string, newName: string) => {
    updateGroupMutation.mutate({ id, data: { name: newName } });
  };

  // DnD event handlers
  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveSystemId(String(active.id));
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    setOverGroupId(over ? String(over.id) : undefined);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveSystemId(undefined);
    setOverGroupId(undefined);

    if (!over) return;

    const systemId = String(active.id);
    const groupId = String(over.id);
    const targetGroup = groups.find((g) => g.id === groupId);

    // Block if already assigned to this group
    if (targetGroup?.systemIds?.includes(systemId)) return;

    handleAddSystemToGroup(systemId, groupId);
  };

  const handleDragCancel = () => {
    setActiveSystemId(undefined);
    setOverGroupId(undefined);
  };

  const activeSystem = activeSystemId
    ? systems.find((s) => s.id === activeSystemId)
    : undefined;

  // Build a map of systemId → groupIds for quick lookup
  const systemGroupMap = new Map<string, string[]>();
  for (const group of groups) {
    for (const sysId of group.systemIds ?? []) {
      const existing = systemGroupMap.get(sysId) ?? [];
      existing.push(group.id);
      systemGroupMap.set(sysId, existing);
    }
  }

  return (
    <PageLayout
      title="Catalog Management"
      subtitle="Manage systems and logical groups within your infrastructure"
      icon={Server}
      loading={loading || accessLoading}
      allowed={canManage}
    >
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Systems Management */}
          <Card>
            <CardHeader>
              <CardHeaderRow>
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-muted-foreground" />
                  Systems
                </CardTitle>
                <Tip
                  plugin={catalogPluginMetadata}
                  id="systems.create"
                  title="Start here: add a system"
                  description="A system is anything you want Checkstack to keep an eye on — a service, a host, a job, a database. Almost everything else (health checks, SLOs, incidents, notifications) hangs off systems."
                  side="bottom"
                  align="end"
                >
                  <Button size="sm" onClick={() => setIsSystemEditorOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add System
                  </Button>
                </Tip>
              </CardHeaderRow>
              {systems.length > 0 && groups.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Drag a system onto a group, or use the{" "}
                  <FolderPlus className="w-3 h-3 inline" /> button to assign it.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {systems.length === 0 ? (
                <EmptyState
                  icon={<Server className="size-10" />}
                  title="No systems yet"
                  description="Systems are the things you monitor. Once you add one, you can attach health checks, SLOs, maintenance windows and incident history to it."
                  steps={[
                    "Click “Add System” to register your first service, host or job.",
                    "Group related systems so dashboards and on-call rotations stay tidy.",
                    "Wire health checks to a system so its health status reflects reality and subscribers get notified on changes.",
                  ]}
                  actions={
                    <Button onClick={() => setIsSystemEditorOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add your first system
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-2">
                  {systems.map((system) => (
                    <DraggableSystem
                      key={system.id}
                      system={system}
                      groups={groups}
                      assignedGroupIds={systemGroupMap.get(system.id) ?? []}
                      onEdit={(s) => {
                        setEditingSystem(s);
                        setIsSystemEditorOpen(true);
                      }}
                      onDelete={handleDeleteSystem}
                      onAddToGroup={handleAddSystemToGroup}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Groups Management */}
          <Card>
            <CardHeader>
              <CardHeaderRow>
                <CardTitle className="flex items-center gap-2">
                  <LayoutGrid className="w-5 h-5 text-muted-foreground" />
                  Groups
                </CardTitle>
                <Tip
                  plugin={catalogPluginMetadata}
                  id="groups.create"
                  title="Group systems that belong together"
                  description="Groups are how Checkstack rolls up status: a group is healthy when all of its systems are healthy. Use them per team, per product area, or per environment."
                  side="bottom"
                  align="end"
                >
                  <Button size="sm" onClick={() => setIsGroupEditorOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Group
                  </Button>
                </Tip>
              </CardHeaderRow>
              {groups.length > 0 && systems.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Drop systems here to assign them to a group.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {groups.length === 0 ? (
                <EmptyState
                  icon={<LayoutGrid className="size-10" />}
                  title="No groups yet"
                  description="Groups roll up the health of multiple systems into a single status — useful for teams, products or environments."
                  steps={[
                    "Click “Add Group” and give it a meaningful name.",
                    "Drag systems from the left panel into the group, or use the assign button on each system.",
                    "Subscribe to the group from the status page to alert your team on any rolled-up incident.",
                  ]}
                  actions={
                    <Button onClick={() => setIsGroupEditorOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add your first group
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-2">
                  {groups.map((group) => (
                    <DroppableGroup
                      key={group.id}
                      group={group}
                      systems={systems}
                      isOver={overGroupId === group.id}
                      isDragging={activeSystemId !== undefined}
                      draggingSystemAlreadyInGroup={
                        activeSystemId !== undefined &&
                        (group.systemIds ?? []).includes(activeSystemId)
                      }
                      newlyAddedSystemId={
                        recentlyAdded?.groupId === group.id
                          ? recentlyAdded.systemId
                          : undefined
                      }
                      onDeleteGroup={handleDeleteGroup}
                      onUpdateGroupName={handleUpdateGroupName}
                      onRemoveSystem={handleRemoveSystemFromGroup}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Drag overlay — the floating ghost shown while dragging */}
        {/* dropAnimation must be null (not undefined) per @dnd-kit API to disable the fly-back animation */}
        { }
        <DragOverlay dropAnimation={null}>
          {activeSystem ? <SystemDragOverlay system={activeSystem} /> : undefined}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <SystemEditor
        open={isSystemEditorOpen}
        onClose={() => {
          setIsSystemEditorOpen(false);
          setEditingSystem(undefined);
        }}
        onSave={handleSaveSystem}
        initialData={
          editingSystem
            ? {
                id: editingSystem.id,
                name: editingSystem.name,
                description: editingSystem.description ?? undefined,
              }
            : undefined
        }
      />

      <GroupEditor
        open={isGroupEditorOpen}
        onClose={() => setIsGroupEditorOpen(false)}
        onSave={handleCreateGroup}
      />

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Delete"
        variant="danger"
      />
    </PageLayout>
  );
};
