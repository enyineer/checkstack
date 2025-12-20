import React, { useState, useEffect } from "react";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";
import { catalogApiRef, System, Group } from "../api";
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
} from "@checkmate/ui";
import { Plus, Trash2, LayoutGrid, Server, Settings } from "lucide-react";

export const CatalogConfigPage = () => {
  const catalogApi = useApi(catalogApiRef);
  const permissionApi = useApi(permissionApiRef);
  const canManage = permissionApi.usePermission("catalog.manage");

  const [systems, setSystems] = useState<System[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const [newSystemName, setNewSystemName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedSystemId, setSelectedSystemId] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, g] = await Promise.all([
        catalogApi.getSystems(),
        catalogApi.getGroups(),
      ]);
      setSystems(s);
      setGroups(g);
      if (s.length > 0 && !selectedSystemId) {
        setSelectedSystemId(s[0].id);
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

  if (!canManage) {
    return <PermissionDenied />;
  }

  const handleCreateSystem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSystemName) return;
    catalogApi
      .createSystem({
        id: newSystemName.toLowerCase().replaceAll(/\s+/g, "-"),
        name: newSystemName,
      })
      .then(() => {
        setNewSystemName("");
        loadData();
      })
      .catch((error) => {
        console.error("Failed to create system:", error);
      });
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName || !selectedSystemId) return;
    catalogApi
      .createGroup({
        id: `${selectedSystemId}-${newGroupName
          .toLowerCase()
          .replaceAll(/\s+/g, "-")}`,
        name: newGroupName,
        systemId: selectedSystemId,
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
    if (
      !confirm(
        "Are you sure? This will hide groups associated with this system if they are not deleted first."
      )
    )
      return;
    try {
      await catalogApi.deleteSystem(id);
      loadData();
    } catch (error) {
      console.error("Failed to delete system:", error);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm("Are you sure?")) return;
    try {
      await catalogApi.deleteGroup(id);
      loadData();
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
  };

  if (loading) return <LoadingSpinner />;

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
            <form onSubmit={handleCreateSystem} className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="New System Name (e.g. Payments)"
                  value={newSystemName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewSystemName(e.target.value)
                  }
                />
              </div>
              <Button type="submit">
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </form>

            <div className="space-y-2">
              {systems.length === 0 ? (
                <EmptyState title="No systems created yet." />
              ) : (
                systems.map((system) => (
                  <div
                    key={system.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div>
                      <span className="font-medium text-gray-900">
                        {system.name}
                      </span>
                      <p className="text-xs text-gray-500 font-mono">
                        {system.id}
                      </p>
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
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Target System</Label>
                <select
                  className="w-full flex h-10 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedSystemId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setSelectedSystemId(e.target.value)
                  }
                >
                  <option value="" disabled>
                    Select a system
                  </option>
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <form onSubmit={handleCreateGroup} className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder="New Group Name (e.g. API)"
                    value={newGroupName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setNewGroupName(e.target.value)
                    }
                  />
                </div>
                <Button type="submit" disabled={!selectedSystemId}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </form>
            </div>

            <div className="space-y-2">
              {groups.filter((g) => g.systemId === selectedSystemId).length ===
              0 ? (
                <EmptyState title="No groups in this system." />
              ) : (
                groups
                  .filter((g) => g.systemId === selectedSystemId)
                  .map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div>
                        <span className="font-medium text-gray-900">
                          {group.name}
                        </span>
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
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
