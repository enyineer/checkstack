import React, { useState, useEffect } from "react";
import {
  useApi,
  permissionApiRef,
  ExtensionSlot,
} from "@checkmate/frontend-api";
import { catalogApiRef, System, Group } from "../api";
import { SLOT_CATALOG_SYSTEM_ACTIONS } from "@checkmate/common";
import {
  SectionHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  LoadingSpinner,
  EmptyState,
  PermissionDenied,
  EditableText,
  ConfirmationModal,
} from "@checkmate/ui";
import { Plus, Trash2, LayoutGrid, Server, Settings } from "lucide-react";

export const CatalogConfigPage = () => {
  const catalogApi = useApi(catalogApiRef);
  const permissionApi = useApi(permissionApiRef);
  const { allowed: canManage, loading: permissionLoading } =
    permissionApi.useManagePermission("catalog");

  const [systems, setSystems] = useState<System[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const [newSystemName, setNewSystemName] = useState("");
  const [newSystemDescription, setNewSystemDescription] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
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
      console.error("Failed to load catalog data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSystem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSystemName) return;
    catalogApi
      .createSystem({
        name: newSystemName,
        description: newSystemDescription || undefined,
      })
      .then(() => {
        setNewSystemName("");
        setNewSystemDescription("");
        loadData();
      })
      .catch((error) => {
        console.error("Failed to create system:", error);
      });
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName) return;
    catalogApi
      .createGroup({
        name: newGroupName,
      })
      .then(() => {
        setNewGroupName("");
        loadData();
      })
      .catch((error) => {
        console.error("Failed to create group:", error);
      });
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
          loadData();
        } catch (error) {
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
          loadData();
        } catch (error) {
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
      loadData();
    } catch (error) {
      console.error("Failed to add system to group:", error);
    }
  };

  const handleRemoveSystemFromGroup = async (
    groupId: string,
    systemId: string
  ) => {
    try {
      await catalogApi.removeSystemFromGroup({ groupId, systemId });
      loadData();
    } catch (error) {
      console.error("Failed to remove system from group:", error);
    }
  };

  const handleUpdateSystemName = async (id: string, newName: string) => {
    try {
      await catalogApi.updateSystem({ id, data: { name: newName } });
      loadData();
    } catch (error) {
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
      loadData();
    } catch (error) {
      console.error("Failed to update system description:", error);
      throw error;
    }
  };

  const handleUpdateGroupName = async (id: string, newName: string) => {
    try {
      await catalogApi.updateGroup({ id, data: { name: newName } });
      loadData();
    } catch (error) {
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
        icon={<Settings className="w-6 h-6 text-indigo-600" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Systems Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5 text-gray-500" />
              Systems
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleCreateSystem} className="space-y-3">
              <div>
                <Input
                  placeholder="New System Name (e.g. Payments)"
                  value={newSystemName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewSystemName(e.target.value)
                  }
                />
              </div>
              <div>
                <textarea
                  className="w-full flex min-h-[60px] rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                  placeholder="Description (optional)"
                  value={newSystemDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setNewSystemDescription(e.target.value)
                  }
                  rows={2}
                />
              </div>
              <Button type="submit" className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Add System
              </Button>
            </form>

            <div className="space-y-2">
              {systems.length === 0 ? (
                <EmptyState title="No systems created yet." />
              ) : (
                systems.map((system) => (
                  <div
                    key={system.id}
                    className="flex items-start justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <EditableText
                          value={system.name}
                          onSave={(newName) =>
                            handleUpdateSystemName(system.id, newName)
                          }
                          className="font-medium text-gray-900"
                        />
                        <ExtensionSlot
                          id={SLOT_CATALOG_SYSTEM_ACTIONS}
                          context={{ system }}
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
                        className="text-xs text-gray-500 font-mono"
                        placeholder="Add description..."
                      />
                    </div>
                    <Button
                      variant="ghost"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                      onClick={() => handleDeleteSystem(system.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Groups Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-gray-500" />
              Groups
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleCreateGroup} className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="New Group Name (e.g. Payment Flow)"
                  value={newGroupName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewGroupName(e.target.value)
                  }
                />
              </div>
              <Button type="submit">
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </form>

            <div className="space-y-2">
              {groups.length === 0 ? (
                <EmptyState title="No groups created yet." />
              ) : (
                groups.map((group) => (
                  <div
                    key={group.id}
                    className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <EditableText
                          value={group.name}
                          onSave={(newName) =>
                            handleUpdateGroupName(group.id, newName)
                          }
                          className="font-medium text-gray-900"
                        />
                        <p className="text-xs text-gray-500 font-mono">
                          {group.id}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                        onClick={() => handleDeleteGroup(group.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Systems in this group */}
                    {group.systemIds && group.systemIds.length > 0 && (
                      <div className="pl-4 space-y-1">
                        {group.systemIds.map((sysId) => {
                          const sys = systems.find((s) => s.id === sysId);
                          if (!sys) return;
                          return (
                            <div
                              key={sysId}
                              className="flex items-center justify-between text-sm bg-white p-2 rounded border border-gray-200"
                            >
                              <span className="text-gray-700">{sys.name}</span>
                              <Button
                                variant="ghost"
                                className="text-red-400 hover:text-red-600 h-6 w-6 p-0"
                                onClick={() =>
                                  handleRemoveSystemFromGroup(group.id, sysId)
                                }
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
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
                  className="w-full flex h-10 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="w-full flex h-10 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
