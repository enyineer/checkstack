import React from "react";
import { PageLayout } from "@checkstack/ui";
import { Users2 } from "lucide-react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { authAccess } from "@checkstack/auth-common";
import { TeamsTab } from "./TeamsTab";

/**
 * Standalone Teams management page, reachable on its own nav entry gated at
 * `auth.teams.read` — separate from the admin Auth Settings page (which needs
 * admin rules). This is how a team manager opens the page to manage their own
 * team(s) without platform-admin access.
 */
export const TeamsPage: React.FC = () => {
  const accessApi = useApi(accessApiRef);
  const canReadTeams = accessApi.useAccess(authAccess.teams.read);
  const canManageTeams = accessApi.useAccess(authAccess.teams.manage);

  return (
    <PageLayout
      title="Teams"
      subtitle="Manage team membership, managers, and resource access."
      icon={Users2}
      loading={canReadTeams.loading}
      allowed={canReadTeams.allowed}
    >
      <TeamsTab
        canReadTeams={canReadTeams.allowed}
        canManageTeams={canManageTeams.allowed}
        onDataChange={async () => {}}
      />
    </PageLayout>
  );
};
