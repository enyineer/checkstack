import React, { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi, accessApiRef, rpcApiRef } from "@checkstack/frontend-api";
import { PageLayout, useToast, Tabs, TabPanel } from "@checkstack/ui";
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
  const rpcApi = useApi(rpcApiRef);
  const authClient = rpcApi.forPlugin(AuthApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const session = authApi.useSession();

  const [activeTab, setActiveTab] = useState<
    "users" | "roles" | "teams" | "strategies" | "applications"
  >("users");
  const [users, setUsers] = useState<(AuthUser & { roles: string[] })[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [accessRuleEntries, setAccessRuleEntries] = useState<AccessRuleEntry[]>([]);
  const [strategies, setStrategies] = useState<AuthStrategy[]>([]);
  const [loading, setLoading] = useState(true);

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

  const accessRulesLoading =
    loading ||
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const usersData = (await authClient.getUsers()) as (AuthUser & {
        roles: string[];
      })[];
      const rolesData = await authClient.getRoles();
      const accessRulesData = await authClient.getAccessRules();
      const strategiesData = await authClient.getStrategies();
      setUsers(usersData);
      setRoles(rolesData);
      setAccessRuleEntries(accessRulesData);
      setStrategies(strategiesData);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch data";
      toast.error(message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Initial data fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Get current user's role IDs for the RolesTab
  const currentUserRoleIds =
    users.find((u) => u.id === session.data?.user?.id)?.roles || [];

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
          users={users}
          roles={roles}
          strategies={strategies}
          currentUserId={session.data?.user?.id}
          canReadUsers={canReadUsers.allowed}
          canCreateUsers={canCreateUsers.allowed}
          canManageUsers={canManageUsers.allowed}
          canManageRoles={canManageRoles.allowed}
          onDataChange={fetchData}
        />
      </TabPanel>

      <TabPanel id="roles" activeTab={activeTab}>
        <RolesTab
          roles={roles}
          accessRulesList={accessRuleEntries}
          userRoleIds={currentUserRoleIds}
          canReadRoles={canReadRoles.allowed}
          canCreateRoles={canCreateRoles.allowed}
          canUpdateRoles={canUpdateRoles.allowed}
          canDeleteRoles={canDeleteRoles.allowed}
          onDataChange={fetchData}
        />
      </TabPanel>

      <TabPanel id="teams" activeTab={activeTab}>
        <TeamsTab
          users={users}
          canReadTeams={canReadTeams.allowed}
          canManageTeams={canManageTeams.allowed}
          onDataChange={fetchData}
        />
      </TabPanel>

      <TabPanel id="strategies" activeTab={activeTab}>
        <StrategiesTab
          strategies={strategies}
          canManageStrategies={canManageStrategies.allowed}
          canManageRegistration={canManageRegistration.allowed}
          onDataChange={fetchData}
        />
      </TabPanel>

      <TabPanel id="applications" activeTab={activeTab}>
        <ApplicationsTab
          roles={roles}
          canManageApplications={canManageApplications.allowed}
        />
      </TabPanel>
    </PageLayout>
  );
};
