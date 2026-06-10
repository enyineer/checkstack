import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useApi,
  accessApiRef,
  usePluginClient,
} from "@checkstack/frontend-api";
import { System, Environment, CatalogApi } from "../api";
import { catalogAccess } from "@checkstack/catalog-common";
import type { CatalogHealthStatuses } from "@checkstack/catalog-common";
import {
  PageLayout,
  Tabs,
  ConfirmationModal,
  useToast,
} from "@checkstack/ui";
import { Server, LayoutGrid, Boxes } from "lucide-react";
import { SystemEditor } from "./SystemEditor";
import { GroupEditor } from "./GroupEditor";
import { EnvironmentEditor } from "./EnvironmentEditor";
import { extractErrorMessage } from "@checkstack/common";
import { useCatalogBrowseState } from "../hooks/useCatalogBrowseState";
import { CatalogBrowseToolbar } from "./browse/CatalogBrowseToolbar";
import { CatalogBrowseHealth } from "./browse/CatalogBrowseHealth";
import {
  collectTagOptions,
  filterManagementLists,
} from "./browse/filterEntities.logic";
import { SystemsTab } from "./manage/SystemsTab";
import { GroupsTab } from "./manage/GroupsTab";
import { EnvironmentsTab } from "./manage/EnvironmentsTab";

type ManageTab = "systems" | "groups" | "environments";

export const CatalogConfigPage = () => {
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    catalogAccess.system.manage,
  );
  // Environment CRUD is gated on its own access rule, independent of the
  // system-level manage permission that gates the rest of this page.
  const { allowed: canManageEnvironments } = accessApi.useAccess(
    catalogAccess.environment.manage,
  );

  const [activeTab, setActiveTab] = useState<ManageTab>("systems");

  // Dialog state
  const [isSystemEditorOpen, setIsSystemEditorOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<System | undefined>();
  const [isGroupEditorOpen, setIsGroupEditorOpen] = useState(false);
  const [isEnvironmentEditorOpen, setIsEnvironmentEditorOpen] = useState(false);
  const [editingEnvironment, setEditingEnvironment] = useState<
    Environment | undefined
  >();

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

  // Fetch environments with useQuery
  const {
    data: environmentsData,
    isLoading: environmentsLoading,
    refetch: refetchEnvironments,
  } = catalogClient.listEnvironments.useQuery({});

  const systems = useMemo(() => systemsData?.systems ?? [], [systemsData]);
  const groups = useMemo(() => groupsData ?? [], [groupsData]);
  const environments = useMemo(
    () => environmentsData ?? [],
    [environmentsData],
  );
  const loading = systemsLoading || groupsLoading || environmentsLoading;

  // Shared browse/manage filter state (search + group/health/tag), reusing the
  // URL-state hook + pure filter logic so the management lists get the same
  // search/filter/grouping as the browse view.
  const browse = useCatalogBrowseState();
  const tagOptions = useMemo(() => collectTagOptions(systems), [systems]);

  // Bulk health reported by the optional CatalogBrowseHealthSlot filler (shared
  // with the browse view). `null` until/unless a filler reports; powers the
  // health filter and enables the toolbar's health control.
  const [healthStatuses, setHealthStatuses] =
    useState<CatalogHealthStatuses | null>(null);
  const healthEnabled = healthStatuses !== null;
  const systemIds = useMemo(() => systems.map((s) => s.id), [systems]);

  const filtered = useMemo(
    () =>
      filterManagementLists({
        systems,
        groups,
        // Filter on the debounced query so typing stays smooth on large lists.
        state: { ...browse.state, query: browse.debouncedQuery },
        statuses: healthStatuses ?? undefined,
      }),
    [systems, groups, browse.state, browse.debouncedQuery, healthStatuses],
  );
  const visibleSystems = filtered.systems;
  const visibleGroups = filtered.groups;

  // Environments aren't part of filterManagementLists; filter by name on the
  // shared query so the search box works on the Environments tab too.
  const visibleEnvironments = useMemo(() => {
    const q = browse.debouncedQuery.trim().toLowerCase();
    if (!q) return environments;
    return environments.filter((e) => e.name.toLowerCase().includes(q));
  }, [environments, browse.debouncedQuery]);

  // systemId -> the group ids it belongs to (built from the full group set so a
  // filtered-out group still shows membership).
  const systemGroupMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of groups) {
      for (const sysId of group.systemIds ?? []) {
        const existing = map.get(sysId) ?? [];
        existing.push(group.id);
        map.set(sysId, existing);
      }
    }
    return map;
  }, [groups]);

  // systemId -> the environment ids it's attached to (environments carry
  // `systemIds`, mirroring groups).
  const systemEnvMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const env of environments) {
      for (const sysId of env.systemIds ?? []) {
        const existing = map.get(sysId) ?? [];
        existing.push(env.id);
        map.set(sysId, existing);
      }
    }
    return map;
  }, [environments]);

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setActiveTab("systems");
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
    // Error is handled in SystemEditor's catch block (inline for team-create
    // errors, generic toast for everything else). No onError here to avoid
    // double-reporting when mutateAsync throws.
  });

  const updateSystemMutation = catalogClient.updateSystem.useMutation({
    onSuccess: () => {
      toast.success("System updated successfully");
      setIsSystemEditorOpen(false);
      setEditingSystem(undefined);
      void refetchSystems();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update system"));
    },
  });

  const deleteSystemMutation = catalogClient.deleteSystem.useMutation({
    onSuccess: () => {
      toast.success("System deleted successfully");
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      void refetchSystems();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete system"));
    },
  });

  const createGroupMutation = catalogClient.createGroup.useMutation({
    onSuccess: () => {
      toast.success("Group created successfully");
      setIsGroupEditorOpen(false);
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to create group"));
    },
  });

  const deleteGroupMutation = catalogClient.deleteGroup.useMutation({
    onSuccess: () => {
      toast.success("Group deleted successfully");
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete group"));
    },
  });

  const updateGroupMutation = catalogClient.updateGroup.useMutation({
    onSuccess: () => {
      toast.success("Group name updated successfully");
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update group name"));
      throw error;
    },
  });

  const addSystemToGroupMutation = catalogClient.addSystemToGroup.useMutation({
    onSuccess: () => {
      toast.success("System added to group successfully");
      void refetchGroups();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to add system to group"));
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

  const createEnvironmentMutation = catalogClient.createEnvironment.useMutation({
    onSuccess: () => {
      toast.success("Environment created successfully");
      setIsEnvironmentEditorOpen(false);
      setEditingEnvironment(undefined);
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to create environment"));
    },
  });

  const updateEnvironmentMutation = catalogClient.updateEnvironment.useMutation({
    onSuccess: () => {
      toast.success("Environment updated successfully");
      setIsEnvironmentEditorOpen(false);
      setEditingEnvironment(undefined);
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update environment"));
    },
  });

  const deleteEnvironmentMutation = catalogClient.deleteEnvironment.useMutation({
    onSuccess: () => {
      toast.success("Environment deleted successfully");
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete environment"));
    },
  });

  // System<->environment membership is a full-set replace; the add/remove
  // helpers below recompute the set from `systemEnvMap`.
  const setSystemEnvironmentsMutation =
    catalogClient.setSystemEnvironments.useMutation({
      onSuccess: () => {
        void refetchEnvironments();
      },
      onError: (error) => {
        toast.error(
          extractErrorMessage(error, "Failed to update system environments"),
        );
      },
    });

  // Handlers
  const handleSaveSystem = async (data: {
    name: string;
    description?: string;
    teamId?: string;
  }) => {
    if (editingSystem) {
      updateSystemMutation.mutate({ id: editingSystem.id, data: { name: data.name, description: data.description } });
    } else {
      // mutateAsync so errors propagate to SystemEditor's catch block, which
      // routes team-create errors inline to the TeamOwnershipPicker.
      await createSystemMutation.mutateAsync(data);
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
      onConfirm: () => deleteSystemMutation.mutate({ id }),
    });
  };

  const handleBulkDeleteSystems = (ids: string[]) => {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      handleDeleteSystem(ids[0]);
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: `Delete ${ids.length} systems`,
      message: `Are you sure you want to delete these ${ids.length} systems? This will remove them from all groups as well.`,
      onConfirm: () => {
        for (const id of ids) deleteSystemMutation.mutate({ id });
      },
    });
  };

  const handleDeleteGroup = (id: string) => {
    const group = groups.find((g) => g.id === id);
    setConfirmModal({
      isOpen: true,
      title: "Delete Group",
      message: `Are you sure you want to delete "${group?.name}"? This action cannot be undone.`,
      onConfirm: () => deleteGroupMutation.mutate(id),
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

  const handleSaveEnvironment = async (data: {
    name: string;
    description?: string;
    metadata?: Record<string, string>;
  }) => {
    if (editingEnvironment) {
      updateEnvironmentMutation.mutate({
        environmentId: editingEnvironment.id,
        data,
      });
    } else {
      createEnvironmentMutation.mutate(data);
    }
  };

  const handleDeleteEnvironment = (id: string) => {
    const environment = environments.find((e) => e.id === id);
    setConfirmModal({
      isOpen: true,
      title: "Delete Environment",
      message: `Are you sure you want to delete "${environment?.name}"? This will remove it from all systems.`,
      onConfirm: () => deleteEnvironmentMutation.mutate({ environmentId: id }),
    });
  };

  const handleAddSystemEnvironment = (
    systemId: string,
    environmentId: string,
  ) => {
    const current = systemEnvMap.get(systemId) ?? [];
    if (current.includes(environmentId)) return;
    setSystemEnvironmentsMutation.mutate({
      systemId,
      environmentIds: [...current, environmentId],
    });
  };

  const handleRemoveSystemEnvironment = (
    systemId: string,
    environmentId: string,
  ) => {
    const current = systemEnvMap.get(systemId) ?? [];
    setSystemEnvironmentsMutation.mutate({
      systemId,
      environmentIds: current.filter((id) => id !== environmentId),
    });
  };

  const hasContent = systems.length > 0 || groups.length > 0;

  return (
    <PageLayout
      title="Catalog Management"
      subtitle="Manage systems, logical groups, and environments"
      icon={Server}
      loading={loading || accessLoading}
      allowed={canManage}
    >
      {hasContent && (
        <div className="mb-4">
          {/* Headless health boundary (slot unfilled → renders nothing). */}
          <CatalogBrowseHealth
            systemIds={systemIds}
            onStatuses={setHealthStatuses}
          />
          <CatalogBrowseToolbar
            query={browse.state.query}
            onQueryChange={browse.setQuery}
            group={browse.state.group}
            onGroupChange={browse.setGroup}
            groups={groups}
            health={browse.state.health}
            onHealthChange={browse.setHealth}
            healthEnabled={healthEnabled}
            tag={browse.state.tag}
            onTagChange={browse.setTag}
            tagOptions={tagOptions}
          />
        </div>
      )}

      <Tabs
        className="mb-4"
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ManageTab)}
        items={[
          { id: "systems", label: "Systems", icon: <Server className="h-4 w-4" /> },
          { id: "groups", label: "Groups", icon: <LayoutGrid className="h-4 w-4" /> },
          {
            id: "environments",
            label: "Environments",
            icon: <Boxes className="h-4 w-4" />,
          },
        ]}
      />

      {activeTab === "systems" && (
        <SystemsTab
          systems={visibleSystems}
          totalCount={systems.length}
          allGroups={groups}
          systemGroupMap={systemGroupMap}
          allEnvironments={environments}
          systemEnvMap={systemEnvMap}
          onAddToEnvironment={handleAddSystemEnvironment}
          onRemoveFromEnvironment={handleRemoveSystemEnvironment}
          onAddSystem={() => {
            setEditingSystem(undefined);
            setIsSystemEditorOpen(true);
          }}
          onEditSystem={(s) => {
            setEditingSystem(s);
            setIsSystemEditorOpen(true);
          }}
          onDeleteSystem={handleDeleteSystem}
          onBulkDeleteSystems={handleBulkDeleteSystems}
          onAddToGroup={handleAddSystemToGroup}
          onRemoveFromGroup={handleRemoveSystemFromGroup}
          onClearFilters={browse.clearFilters}
        />
      )}

      {activeTab === "groups" && (
        <GroupsTab
          groups={visibleGroups}
          totalCount={groups.length}
          allSystems={systems}
          onAddGroup={() => setIsGroupEditorOpen(true)}
          onDeleteGroup={handleDeleteGroup}
          onRenameGroup={handleUpdateGroupName}
          onAddToGroup={handleAddSystemToGroup}
          onRemoveFromGroup={handleRemoveSystemFromGroup}
          onClearFilters={browse.clearFilters}
        />
      )}

      {activeTab === "environments" && (
        <EnvironmentsTab
          environments={visibleEnvironments}
          totalCount={environments.length}
          canManage={canManageEnvironments}
          allSystems={systems}
          onAddSystemToEnvironment={handleAddSystemEnvironment}
          onRemoveSystemFromEnvironment={handleRemoveSystemEnvironment}
          onAddEnvironment={() => {
            setEditingEnvironment(undefined);
            setIsEnvironmentEditorOpen(true);
          }}
          onEditEnvironment={(env) => {
            setEditingEnvironment(env);
            setIsEnvironmentEditorOpen(true);
          }}
          onDeleteEnvironment={handleDeleteEnvironment}
          onClearFilters={browse.clearFilters}
        />
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

      <EnvironmentEditor
        open={isEnvironmentEditorOpen}
        onClose={() => {
          setIsEnvironmentEditorOpen(false);
          setEditingEnvironment(undefined);
        }}
        onSave={handleSaveEnvironment}
        initialData={
          editingEnvironment
            ? {
                name: editingEnvironment.name,
                description: editingEnvironment.description ?? undefined,
                metadata: editingEnvironment.metadata,
              }
            : undefined
        }
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
