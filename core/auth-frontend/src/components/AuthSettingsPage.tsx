import React, { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useApi,
  accessApiRef,
  usePluginClient,
} from "@checkstack/frontend-api";
import { PageLayout, Tabs, TabPanel } from "@checkstack/ui";
import {
  authApiRef,
  AuthUser,
  Role,
  AuthStrategy,
  AccessRuleEntry,
} from "../api";
import { authAccess, AuthApi } from "@checkstack/auth-common";
import { Shield, Settings2, Users, Key, Users2 } from "lucide-react";
import { UsersTab } from "./UsersTab";
import { RolesTab } from "./RolesTab";
import { StrategiesTab } from "./StrategiesTab";
import { ApplicationsTab } from "./ApplicationsTab";
import { TeamsTab } from "./TeamsTab";

export const AuthSettingsPage: React.FC = () => {
  const authApi = useApi(authApiRef);
  const authClient = usePluginClient(AuthApi);
  const accessApi = useApi(accessApiRef);
  const [searchParams, setSearchParams] = useSearchParams();

  const session = authApi.useSession();

  const [activeTab, setActiveTab] = useState<
    "users" | "roles" | "teams" | "strategies" | "applications"
  >("users");

  const canReadUsers = accessApi.useAccess(authAccess.users.read);

  // Handle ?tab= URL parameters (from command palette)
  useEffect(() => {
    const tab = searchParams.get("tab");

    if (
      tab &&
      ["users", "roles", "teams", "strategies", "applications"].includes(tab)
    ) {
      setActiveTab(
        tab as "users" | "roles" | "teams" | "strategies" | "applications"
      );
    }

    // Clear the URL params after processing
    if (tab) {
      searchParams.delete("tab");
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const canManageUsers = accessApi.useAccess(authAccess.users.manage);
  const canCreateUsers = accessApi.useAccess(authAccess.users.create);
  const canReadRoles = accessApi.useAccess(authAccess.roles.read);
  const canCreateRoles = accessApi.useAccess(authAccess.roles.create);
  const canUpdateRoles = accessApi.useAccess(authAccess.roles.update);
  const canDeleteRoles = accessApi.useAccess(authAccess.roles.delete);
  const canManageRoles = accessApi.useAccess(authAccess.roles.manage);
  const canManageStrategies = accessApi.useAccess(authAccess.strategies);
  const canManageRegistration = accessApi.useAccess(authAccess.registration);
  const canManageApplications = accessApi.useAccess(authAccess.applications);
  const canReadTeams = accessApi.useAccess(authAccess.teams.read);
  const canManageTeams = accessApi.useAccess(authAccess.teams.manage);

  // Queries: Fetch data from API
  const {
    data: users = [],
    isLoading: usersLoading,
    refetch: refetchUsers,
  } = authClient.getUsers.useQuery({}, { enabled: canReadUsers.allowed });

  const {
    data: roles = [],
    isLoading: rolesLoading,
    refetch: refetchRoles,
  } = authClient.getRoles.useQuery({}, { enabled: canReadRoles.allowed });

  const {
    data: accessRuleEntries = [],
    isLoading: rulesLoading,
    refetch: refetchRules,
  } = authClient.getAccessRules.useQuery({}, { enabled: canReadRoles.allowed });

  const {
    data: strategies = [],
    isLoading: strategiesLoading,
    refetch: refetchStrategies,
  } = authClient.getStrategies.useQuery(
    {},
    { enabled: canManageStrategies.allowed }
  );

  const dataLoading =
    usersLoading || rolesLoading || rulesLoading || strategiesLoading;

  const accessRulesLoading =
    dataLoading ||
    canReadUsers.loading ||
    canReadRoles.loading ||
    canManageStrategies.loading ||
    canManageApplications.loading ||
    canReadTeams.loading;

  const hasAnyAccess =
    canReadUsers.allowed ||
    canReadRoles.allowed ||
    canManageStrategies.allowed ||
    canManageApplications.allowed ||
    canReadTeams.allowed;

  // Special case: if user is not logged in, show access denied
  const isAllowed = session.data?.user ? hasAnyAccess : false;

  // Compute visible tabs based on access rules
  const visibleTabs = useMemo(() => {
    const tabs: Array<{
      id: "users" | "roles" | "teams" | "strategies" | "applications";
      label: string;
      icon: React.ReactNode;
    }> = [];
    if (canReadUsers.allowed)
      tabs.push({
        id: "users",
        label: "Users & Roles",
        icon: <Users size={18} />,
      });
    if (canReadRoles.allowed)
      tabs.push({
        id: "roles",
        label: "Roles & Access Rules",
        icon: <Shield size={18} />,
      });
    if (canReadTeams.allowed)
      tabs.push({
        id: "teams",
        label: "Teams",
        icon: <Users2 size={18} />,
      });
    if (canManageStrategies.allowed)
      tabs.push({
        id: "strategies",
        label: "Auth Strategies",
        icon: <Settings2 size={18} />,
      });
    if (canManageApplications.allowed)
      tabs.push({
        id: "applications",
        label: "Applications",
        icon: <Key size={18} />,
      });
    return tabs;
  }, [
    canReadUsers.allowed,
    canReadRoles.allowed,
    canReadTeams.allowed,
    canManageStrategies.allowed,
    canManageApplications.allowed,
  ]);

  // Auto-select first visible tab if current tab is not accessible
  useEffect(() => {
    if (
      visibleTabs.length > 0 &&
      !visibleTabs.some((t) => t.id === activeTab)
    ) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [visibleTabs, activeTab]);

  const handleDataChange = async () => {
    await Promise.all([
      refetchUsers(),
      refetchRoles(),
      refetchRules(),
      refetchStrategies(),
    ]);
  };

  // Get current user's role IDs for the RolesTab
  const typedUsers = users as (AuthUser & { roles: string[] })[];
  const currentUserRoleIds =
    typedUsers.find((u) => u.id === session.data?.user?.id)?.roles || [];

  return (
    <PageLayout
      title="Authentication Settings"
      loading={accessRulesLoading}
      allowed={isAllowed}
    >
      <Tabs
        items={visibleTabs}
        activeTab={activeTab}
        onTabChange={(tabId) =>
          setActiveTab(
            tabId as "users" | "roles" | "teams" | "strategies" | "applications"
          )
        }
        className="mb-6"
      />

      <TabPanel id="users" activeTab={activeTab}>
        <UsersTab
          users={typedUsers}
          roles={roles as Role[]}
          strategies={strategies as AuthStrategy[]}
          currentUserId={session.data?.user?.id}
          canReadUsers={canReadUsers.allowed}
          canCreateUsers={canCreateUsers.allowed}
          canManageUsers={canManageUsers.allowed}
          canManageRoles={canManageRoles.allowed}
          onDataChange={handleDataChange}
        />
      </TabPanel>

      <TabPanel id="roles" activeTab={activeTab}>
        <RolesTab
          roles={roles as Role[]}
          accessRulesList={accessRuleEntries as AccessRuleEntry[]}
          userRoleIds={currentUserRoleIds}
          canReadRoles={canReadRoles.allowed}
          canCreateRoles={canCreateRoles.allowed}
          canUpdateRoles={canUpdateRoles.allowed}
          canDeleteRoles={canDeleteRoles.allowed}
          onDataChange={handleDataChange}
        />
      </TabPanel>

      <TabPanel id="teams" activeTab={activeTab}>
        <TeamsTab
          users={typedUsers}
          canReadTeams={canReadTeams.allowed}
          canManageTeams={canManageTeams.allowed}
          onDataChange={handleDataChange}
        />
      </TabPanel>

      <TabPanel id="strategies" activeTab={activeTab}>
        <StrategiesTab
          strategies={strategies as AuthStrategy[]}
          canManageStrategies={canManageStrategies.allowed}
          canManageRegistration={canManageRegistration.allowed}
          onDataChange={handleDataChange}
        />
      </TabPanel>

      <TabPanel id="applications" activeTab={activeTab}>
        <ApplicationsTab
          roles={roles as Role[]}
          canManageApplications={canManageApplications.allowed}
        />
      </TabPanel>
    </PageLayout>
  );
};
