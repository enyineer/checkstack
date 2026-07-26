import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  useApi,
  accessApiRef,
  usePluginClient,
} from "@checkstack/frontend-api";
import { System, Environment, Group, CatalogApi } from "../api";
import {
  catalogAccess,
  catalogResourceTypes,
  pluginMetadata as catalogPluginMetadata,
} from "@checkstack/catalog-common";
import type { CatalogHealthStatuses } from "@checkstack/catalog-common";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import { TipBanner } from "@checkstack/tips-frontend";
import {
  PageLayout,
  Tabs,
  ConfirmationModal,
  useToast,
  toastSuccess,
  toastError,
} from "@checkstack/ui";
import { Server, LayoutGrid, Boxes, ExternalLink } from "lucide-react";

/**
 * In-app deep-link to the Systems and groups concept page (same-origin Starlight
 * build served at `/checkstack/*`). Slug is centralised in `APP_DOC_SLUGS` and
 * guarded against renames by `docs-links.test.ts`.
 */
const DOCS_SYSTEMS_AND_GROUPS = docsPath(APP_DOC_SLUGS.systemsAndGroups);

/** Inline "Learn more" link to the systems-and-groups concept docs. */
const CatalogLearnMore = () => (
  <a
    href={DOCS_SYSTEMS_AND_GROUPS}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline"
  >
    Learn more
    <ExternalLink className="h-3 w-3" />
  </a>
);
import { SystemEditor } from "./SystemEditor";
import { GroupEditor } from "./GroupEditor";
import { EnvironmentEditor } from "./EnvironmentEditor";
import { useCatalogBrowseState } from "../hooks/useCatalogBrowseState";
import { CatalogBrowseToolbar } from "./browse/CatalogBrowseToolbar";
import { CatalogBrowseHealth } from "./browse/CatalogBrowseHealth";
import {
  collectTagOptions,
  filterEnvironments,
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
  // Create capability: gates the "Add System" action and the ?action=create
  // deep-link. A team-scoped user needs a `creator` grant to create systems.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useProcedureAccess(CatalogApi.contract.createSystem);
  // Surface access: gates reaching this management page at all. A user who can
  // MANAGE an existing system (via a team) should be able to open it to edit
  // that system, even without create capability - matching the route guard.
  const { allowed: canAccessSurface, loading: surfaceLoading } =
    accessApi.useCanAccessType({
      accessRule: catalogAccess.system.manage,
      objectType: catalogResourceTypes.system,
    });
  // Environment create/manage gating now lives in EnvironmentsTab (create verdict
  // for the Add button, per-instance manage for row actions), matching GroupsTab.

  const [activeTab, setActiveTab] = useState<ManageTab>("systems");

  // Dialog state
  const [isSystemEditorOpen, setIsSystemEditorOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<System | undefined>();
  const [isGroupEditorOpen, setIsGroupEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | undefined>();
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
  // Whether the shared health filler is still bulk-fetching, so the manage
  // tabs can show a per-row placeholder instead of health badges popping in.
  const [healthLoading, setHealthLoading] = useState(false);
  const systemIds = useMemo(() => systems.map((s) => s.id), [systems]);

  const filtered = useMemo(
    () =>
      filterManagementLists({
        systems,
        groups,
        // `applied` carries the debounced query, so typing stays smooth.
        state: { ...browse.applied, ...browse.view },
        statuses: healthStatuses ?? undefined,
      }),
    [systems, groups, browse.applied, browse.view, healthStatuses],
  );
  const visibleSystems = filtered.systems;
  const visibleGroups = filtered.groups;

  // Environments have no group/health/tag dimension, so they take only the
  // shared search - through the same matcher the systems list uses.
  const visibleEnvironments = useMemo(
    () => filterEnvironments({ environments, filters: browse.applied }),
    [environments, browse.applied],
  );

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
      toastSuccess(toast, "System created successfully");
      setIsSystemEditorOpen(false);
      void refetchSystems();
    },
    // Error is handled in SystemEditor's catch block (inline for team-create
    // errors, generic toast for everything else). No onError here to avoid
    // double-reporting when mutateAsync throws.
  });

  const updateSystemMutation = catalogClient.updateSystem.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "System updated successfully");
      setIsSystemEditorOpen(false);
      setEditingSystem(undefined);
      void refetchSystems();
    },
    onError: (error) => {
      toastError(toast, "Failed to update system", error);
    },
  });

  const deleteSystemMutation = catalogClient.deleteSystem.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "System deleted successfully");
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      void refetchSystems();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete system", error);
    },
  });

  const createGroupMutation = catalogClient.createGroup.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Group created successfully");
      setIsGroupEditorOpen(false);
      setEditingGroup(undefined);
      void refetchGroups();
    },
    // Error handled in GroupEditor's catch (inline for team-create errors,
    // generic toast otherwise). No onError here to avoid double-reporting when
    // mutateAsync throws.
  });

  const deleteGroupMutation = catalogClient.deleteGroup.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Group deleted successfully");
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      void refetchGroups();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete group", error);
    },
  });

  const reorderGroupsMutation = catalogClient.reorderGroups.useMutation({
    onSuccess: () => {
      void refetchGroups();
    },
    onError: (error) => {
      toastError(toast, "Failed to reorder groups", error);
    },
  });

  const updateGroupMutation = catalogClient.updateGroup.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Group updated successfully");
      setIsGroupEditorOpen(false);
      setEditingGroup(undefined);
      void refetchGroups();
    },
    onError: (error) => {
      toastError(toast, "Failed to update group", error);
    },
  });

  const addSystemToGroupMutation = catalogClient.addSystemToGroup.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "System added to group successfully");
      void refetchGroups();
    },
    onError: (error) => {
      toastError(toast, "Failed to add system to group", error);
    },
  });

  const removeSystemFromGroupMutation =
    catalogClient.removeSystemFromGroup.useMutation({
      onSuccess: () => {
        toastSuccess(toast, "System removed from group successfully");
        void refetchGroups();
      },
      onError: (error) => {
        toastError(toast, "Failed to remove system from group", error);
      },
    });

  const createEnvironmentMutation = catalogClient.createEnvironment.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Environment created successfully");
      setIsEnvironmentEditorOpen(false);
      setEditingEnvironment(undefined);
    },
    // Error handled in EnvironmentEditor's catch (inline for team-create errors,
    // generic toast otherwise). No onError here to avoid double-reporting when
    // mutateAsync throws.
  });

  const updateEnvironmentMutation = catalogClient.updateEnvironment.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Environment updated successfully");
      setIsEnvironmentEditorOpen(false);
      setEditingEnvironment(undefined);
    },
    onError: (error) => {
      toastError(toast, "Failed to update environment", error);
    },
  });

  const deleteEnvironmentMutation = catalogClient.deleteEnvironment.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Environment deleted successfully");
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
    },
    onError: (error) => {
      toastError(toast, "Failed to delete environment", error);
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
        toastError(toast, "Failed to update system environments", error);
      },
    });

  // Handlers
  const handleSaveSystem = async (data: {
    name: string;
    description?: string;
    teamId?: string;
    metadata?: Record<string, string>;
  }) => {
    if (editingSystem) {
      updateSystemMutation.mutate({
        id: editingSystem.id,
        data: {
          name: data.name,
          description: data.description,
          metadata: data.metadata,
        },
      });
    } else {
      // mutateAsync so errors propagate to SystemEditor's catch block, which
      // routes team-create errors inline to the TeamOwnershipPicker.
      await createSystemMutation.mutateAsync(data);
    }
  };

  const handleSaveGroup = async (data: { name: string; teamId?: string }) => {
    if (editingGroup) {
      // Edit never carries teamId (create-only); strip it defensively.
      const { teamId: _teamId, ...updateData } = data;
      updateGroupMutation.mutate({ id: editingGroup.id, data: updateData });
    } else {
      // mutateAsync so team-create errors propagate to GroupEditor's catch
      // (inline OWNER_TEAM_REQUIRED routing to the TeamOwnershipPicker).
      await createGroupMutation.mutateAsync(data);
    }
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
      onConfirm: () => deleteGroupMutation.mutate({ id }),
    });
  };

  const handleBulkDeleteGroups = (ids: string[]) => {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      handleDeleteGroup(ids[0]);
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: `Delete ${ids.length} groups`,
      message: `Are you sure you want to delete these ${ids.length} groups? This action cannot be undone.`,
      onConfirm: () => {
        for (const id of ids) deleteGroupMutation.mutate({ id });
      },
    });
  };

  const handleAddSystemToGroup = (systemId: string, groupId: string) => {
    addSystemToGroupMutation.mutate({ groupId, systemId });
  };

  const handleRemoveSystemFromGroup = (groupId: string, systemId: string) => {
    removeSystemFromGroupMutation.mutate({ groupId, systemId });
  };

  const handleSaveEnvironment = async (data: {
    name: string;
    description?: string;
    teamId?: string;
    metadata?: Record<string, string>;
  }) => {
    if (editingEnvironment) {
      // Edit never carries teamId (create-only); strip it defensively.
      const { teamId: _teamId, ...updateData } = data;
      updateEnvironmentMutation.mutate({
        environmentId: editingEnvironment.id,
        data: updateData,
      });
    } else {
      // mutateAsync so team-create errors propagate to EnvironmentEditor's catch.
      await createEnvironmentMutation.mutateAsync(data);
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

  const handleBulkDeleteEnvironments = (ids: string[]) => {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      handleDeleteEnvironment(ids[0]);
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: `Delete ${ids.length} environments`,
      message: `Are you sure you want to delete these ${ids.length} environments? This will remove them from all systems.`,
      onConfirm: () => {
        for (const id of ids) deleteEnvironmentMutation.mutate({ environmentId: id });
      },
    });
  };

  // Attach ONE system to many environments in a single desired-set write. Env
  // membership is stored as the system's env set (setSystemEnvironments is a
  // read-modify-write), so looping per env would race on the shared systemId and
  // only the last add would stick; union up-front and write once instead.
  const handleAttachSystemToEnvironments = (
    systemId: string,
    environmentIds: string[],
  ) => {
    const current = systemEnvMap.get(systemId) ?? [];
    const next = [...new Set([...current, ...environmentIds])];
    if (next.length === current.length) return;
    setSystemEnvironmentsMutation.mutate({ systemId, environmentIds: next });
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
      loading={loading || accessLoading || surfaceLoading}
      allowed={canAccessSurface}
    >
      <TipBanner
        plugin={catalogPluginMetadata}
        id="config.intro"
        title="Start here: the catalog is your inventory"
        description={
          <>
            A system is a thing you monitor; groups bundle systems by team or
            domain, and environments tag where they run. Everything else - health
            checks, SLOs, incidents - attaches to the systems you add here, so
            this is the usual first step. <CatalogLearnMore />
          </>
        }
      />

      {hasContent && (
        <div className="mb-4">
          {/* Headless health boundary (slot unfilled → renders nothing). */}
          <CatalogBrowseHealth
            systemIds={systemIds}
            onStatuses={setHealthStatuses}
            onLoading={setHealthLoading}
          />
          {/* ONE toolbar for all three tabs: the state is lifted to the page,
              so switching tabs keeps the same search and filters. */}
          <CatalogBrowseToolbar
            filters={browse.filters.state}
            onFiltersChange={browse.filters.setState}
            onClear={browse.filters.clear}
            groups={groups}
            tagOptions={tagOptions}
            healthEnabled={healthEnabled}
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
          healthLoading={healthLoading}
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
          onClearFilters={browse.filters.clear}
        />
      )}

      {activeTab === "groups" && (
        <GroupsTab
          groups={visibleGroups}
          orderedGroups={groups}
          isFiltered={browse.filters.active}
          totalCount={groups.length}
          allSystems={systems}
          onAddGroup={() => {
            setEditingGroup(undefined);
            setIsGroupEditorOpen(true);
          }}
          onEditGroup={(group) => {
            setEditingGroup(group);
            setIsGroupEditorOpen(true);
          }}
          onDeleteGroup={handleDeleteGroup}
          onBulkDeleteGroups={handleBulkDeleteGroups}
          onReorderGroups={(orderedIds) =>
            reorderGroupsMutation.mutate({ orderedIds })
          }
          onAddToGroup={handleAddSystemToGroup}
          onRemoveFromGroup={handleRemoveSystemFromGroup}
          onClearFilters={browse.filters.clear}
        />
      )}

      {activeTab === "environments" && (
        <EnvironmentsTab
          environments={visibleEnvironments}
          totalCount={environments.length}
          allSystems={systems}
          onAddSystemToEnvironment={handleAddSystemEnvironment}
          onRemoveSystemFromEnvironment={handleRemoveSystemEnvironment}
          onAttachSystemToEnvironments={handleAttachSystemToEnvironments}
          onAddEnvironment={() => {
            setEditingEnvironment(undefined);
            setIsEnvironmentEditorOpen(true);
          }}
          onEditEnvironment={(env) => {
            setEditingEnvironment(env);
            setIsEnvironmentEditorOpen(true);
          }}
          onDeleteEnvironment={handleDeleteEnvironment}
          onBulkDeleteEnvironments={handleBulkDeleteEnvironments}
          onClearFilters={browse.filters.clear}
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
                metadata: editingSystem.metadata,
              }
            : undefined
        }
      />

      <GroupEditor
        open={isGroupEditorOpen}
        onClose={() => {
          setIsGroupEditorOpen(false);
          setEditingGroup(undefined);
        }}
        onSave={handleSaveGroup}
        initialData={
          editingGroup
            ? { id: editingGroup.id, name: editingGroup.name }
            : undefined
        }
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
                id: editingEnvironment.id,
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
