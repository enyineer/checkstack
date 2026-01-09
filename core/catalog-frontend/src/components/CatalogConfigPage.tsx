import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useApi,
  permissionApiRef,
  ExtensionSlot,
} from "@checkmate-monitor/frontend-api";
import { catalogApiRef, System, Group } from "../api";
import { CatalogSystemActionsSlot } from "@checkmate-monitor/catalog-common";
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
  PermissionDenied,
  EditableText,
  ConfirmationModal,
  useToast,
} from "@checkmate-monitor/ui";
import { Plus, Trash2, LayoutGrid, Server, Settings } from "lucide-react";
import { SystemEditor } from "./SystemEditor";
import { GroupEditor } from "./GroupEditor";

export const CatalogConfigPage = () => {
  const catalogApi = useApi(catalogApiRef);
  const permissionApi = useApi(permissionApiRef);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canManage, loading: permissionLoading } =
    permissionApi.useManagePermission("catalog");

  const [systems, setSystems] = useState<System[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [isSystemEditorOpen, setIsSystemEditorOpen] = useState(false);
  const [isGroupEditorOpen, setIsGroupEditorOpen] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedSystemToAdd, setSelectedSystemToAdd] = useState("");

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

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, g] = await Promise.all([
        catalogApi.getSystems(),
        catalogApi.getGroups(),
      ]);
      setSystems(s);
      setGroups(g);
      if (g.length > 0 && !selectedGroupId) {
        setSelectedGroupId(g[0].id);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load catalog data";
      toast.error(message);
      console.error("Failed to load catalog data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setIsSystemEditorOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  const handleCreateSystem = async (data: {
    name: string;
    description?: string;
  }) => {
    await catalogApi.createSystem(data);
    toast.success("System created successfully");
    await loadData();
  };

  const handleCreateGroup = async (data: { name: string }) => {
    await catalogApi.createGroup(data);
    toast.success("Group created successfully");
    await loadData();
  };

  const handleDeleteSystem = async (id: string) => {
    const system = systems.find((s) => s.id === id);
    setConfirmModal({
      isOpen: true,
      title: "Delete System",
      message: `Are you sure you want to delete "${system?.name}"? This will remove the system from all groups as well.`,
      onConfirm: async () => {
        try {
          await catalogApi.deleteSystem(id);
          setConfirmModal({ ...confirmModal, isOpen: false });
          toast.success("System deleted successfully");
          loadData();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to delete system";
          toast.error(message);
          console.error("Failed to delete system:", error);
        }
      },
    });
  };

  const handleDeleteGroup = async (id: string) => {
    const group = groups.find((g) => g.id === id);
    setConfirmModal({
      isOpen: true,
      title: "Delete Group",
      message: `Are you sure you want to delete "${group?.name}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await catalogApi.deleteGroup(id);
          setConfirmModal({ ...confirmModal, isOpen: false });
          toast.success("Group deleted successfully");
          loadData();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to delete group";
          toast.error(message);
          console.error("Failed to delete group:", error);
        }
      },
    });
  };

  const handleAddSystemToGroup = async () => {
    if (!selectedGroupId || !selectedSystemToAdd) return;
    try {
      await catalogApi.addSystemToGroup({
        groupId: selectedGroupId,
        systemId: selectedSystemToAdd,
      });
      setSelectedSystemToAdd("");
      toast.success("System added to group successfully");
      loadData();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to add system to group";
      toast.error(message);
      console.error("Failed to add system to group:", error);
    }
  };

  const handleRemoveSystemFromGroup = async (
    groupId: string,
    systemId: string
  ) => {
    try {
      await catalogApi.removeSystemFromGroup({ groupId, systemId });
      toast.success("System removed from group successfully");
      loadData();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to remove system from group";
      toast.error(message);
      console.error("Failed to remove system from group:", error);
    }
  };

  const handleUpdateSystemName = async (id: string, newName: string) => {
    try {
      await catalogApi.updateSystem({ id, data: { name: newName } });
      toast.success("System name updated successfully");
      loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update system name";
      toast.error(message);
      console.error("Failed to update system name:", error);
      throw error;
    }
  };

  const handleUpdateSystemDescription = async (
    id: string,
    newDescription: string
  ) => {
    try {
      await catalogApi.updateSystem({
        id,
        data: { description: newDescription },
      });
      toast.success("System description updated successfully");
      loadData();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update system description";
      toast.error(message);
      console.error("Failed to update system description:", error);
      throw error;
    }
  };

  const handleUpdateGroupName = async (id: string, newName: string) => {
    try {
      await catalogApi.updateGroup({ id, data: { name: newName } });
      toast.success("Group name updated successfully");
      loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update group name";
      toast.error(message);
      console.error("Failed to update group name:", error);
      throw error;
    }
  };

  if (loading || permissionLoading) return <LoadingSpinner />;

  if (!canManage) {
    return <PermissionDenied />;
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
                        <EditableText
                          value={system.name}
                          onSave={(newName) =>
                            handleUpdateSystemName(system.id, newName)
                          }
                          className="font-medium text-foreground"
                        />
                        <ExtensionSlot
                          slot={CatalogSystemActionsSlot}
                          context={{
                            systemId: system.id,
                            systemName: system.name,
                          }}
                        />
                      </div>
                      <EditableText
                        value={system.description || "No description"}
                        onSave={(newDescription) =>
                          handleUpdateSystemDescription(
                            system.id,
                            newDescription
                          )
                        }
                        className="text-xs text-muted-foreground font-mono"
                        placeholder="Add description..."
                      />
                    </div>
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive/90 hover:bg-destructive/10 h-8 w-8 p-0"
                      onClick={() => handleDeleteSystem(system.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
        onClose={() => setIsSystemEditorOpen(false)}
        onSave={handleCreateSystem}
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
