import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useApi,
  accessApiRef,
  ExtensionSlot,
  usePluginClient,
} from "@checkstack/frontend-api";
import { System, CatalogApi } from "../api";
import {
  CatalogSystemActionsSlot,
  catalogAccess,
} from "@checkstack/catalog-common";
import {
  SectionHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Label,
  LoadingSpinner,
  EmptyState,
  AccessDenied,
  EditableText,
  ConfirmationModal,
  useToast,
} from "@checkstack/ui";
import { Plus, Trash2, LayoutGrid, Server, Settings, Edit } from "lucide-react";
import { SystemEditor } from "./SystemEditor";
import { GroupEditor } from "./GroupEditor";

export const CatalogConfigPage = () => {
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    catalogAccess.system.manage
  );

  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedSystemToAdd, setSelectedSystemToAdd] = useState("");

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

  // Set initial group selection
  useEffect(() => {
    if (groups.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setIsSystemEditorOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  // Mutations
  const createSystemMutation = catalogClient.createSystem.useMutation({
    onSuccess: () => {
      toast.success("System created successfully");
      setIsSystemEditorOpen(false);
      void refetchSystems();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create system"
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
        error instanceof Error ? error.message : "Failed to update system"
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
        error instanceof Error ? error.message : "Failed to delete system"
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
        error instanceof Error ? error.message : "Failed to create group"
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
        error instanceof Error ? error.message : "Failed to delete group"
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
        error instanceof Error ? error.message : "Failed to update group name"
      );
      throw error;
    },
  });

  const addSystemToGroupMutation = catalogClient.addSystemToGroup.useMutation({
    onSuccess: () => {
      toast.success("System added to group successfully");
      setSelectedSystemToAdd("");
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to add system to group"
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
          error instanceof Error
            ? error.message
            : "Failed to remove system from group"
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

  const handleAddSystemToGroup = () => {
    if (!selectedGroupId || !selectedSystemToAdd) return;
    addSystemToGroupMutation.mutate({
      groupId: selectedGroupId,
      systemId: selectedSystemToAdd,
    });
  };

  const handleRemoveSystemFromGroup = (groupId: string, systemId: string) => {
    removeSystemFromGroupMutation.mutate({ groupId, systemId });
  };

  const handleUpdateGroupName = (id: string, newName: string) => {
    updateGroupMutation.mutate({ id, data: { name: newName } });
  };

  if (loading || accessLoading) return <LoadingSpinner />;

  if (!canManage) {
    return <AccessDenied />;
  }

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const availableSystems = systems.filter(
    (s) => !selectedGroup?.systemIds?.includes(s.id)
  );

  return (
    <div className="space-y-8">
      <SectionHeader
        title="Catalog Management"
        description="Manage systems and logical groups within your infrastructure"
        icon={<Settings className="w-6 h-6 text-primary" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Systems Management */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5 text-muted-foreground" />
              Systems
            </CardTitle>
            <Button size="sm" onClick={() => setIsSystemEditorOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add System
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {systems.length === 0 ? (
              <EmptyState title="No systems created yet." />
            ) : (
              <div className="space-y-2">
                {systems.map((system) => (
                  <div
                    key={system.id}
                    className="flex items-start justify-between p-3 bg-muted/30 rounded-lg border border-border"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">
                          {system.name}
                        </span>
                        <ExtensionSlot
                          slot={CatalogSystemActionsSlot}
                          context={{
                            systemId: system.id,
                            systemName: system.name,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {system.description || "No description"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => {
                          setEditingSystem(system);
                          setIsSystemEditorOpen(true);
                        }}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-destructive hover:text-destructive/90 hover:bg-destructive/10 h-8 w-8 p-0"
                        onClick={() => handleDeleteSystem(system.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Groups Management */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-muted-foreground" />
              Groups
            </CardTitle>
            <Button size="sm" onClick={() => setIsGroupEditorOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Group
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {groups.length === 0 ? (
              <EmptyState title="No groups created yet." />
            ) : (
              <div className="space-y-2">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className="p-3 bg-muted/30 rounded-lg border border-border space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <EditableText
                          value={group.name}
                          onSave={(newName) =>
                            handleUpdateGroupName(group.id, newName)
                          }
                          className="font-medium text-foreground"
                        />
                        <p className="text-xs text-muted-foreground font-mono">
                          {group.id}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        className="text-destructive hover:text-destructive/90 hover:bg-destructive/10 h-8 w-8 p-0"
                        onClick={() => handleDeleteGroup(group.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Systems in this group */}
                    {group.systemIds && group.systemIds.length > 0 && (
                      <div className="pl-4 space-y-1">
                        {group.systemIds
                          .map((sysId) => systems.find((s) => s.id === sysId))
                          .filter((sys): sys is System => !!sys)
                          .map((sys) => (
                            <div
                              key={sys.id}
                              className="flex items-center justify-between text-sm bg-background p-2 rounded border border-border"
                            >
                              <span className="text-foreground">
                                {sys.name}
                              </span>
                              <Button
                                variant="ghost"
                                className="text-destructive/60 hover:text-destructive h-6 w-6 p-0"
                                onClick={() =>
                                  handleRemoveSystemFromGroup(group.id, sys.id)
                                }
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add System to Group Section */}
      {groups.length > 0 && systems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Add System to Group</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Select Group</Label>
                <select
                  className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedGroupId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setSelectedGroupId(e.target.value)
                  }
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Select System</Label>
                <select
                  className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedSystemToAdd}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setSelectedSystemToAdd(e.target.value)
                  }
                >
                  <option value="">Select a system</option>
                  {availableSystems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleAddSystemToGroup}
                  disabled={!selectedSystemToAdd}
                  className="w-full"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add to Group
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
};
