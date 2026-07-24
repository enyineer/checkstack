import React from "react";
import { PageLayout } from "@checkstack/ui";
import { Users2 } from "lucide-react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { authAccess } from "@checkstack/auth-common";
import { useAccessRules } from "../hooks/useAccessRules";
import { TeamsTab } from "./TeamsTab";

/**
 * Standalone Teams management page, reachable by a global `auth.teams.read`
 * holder OR any user who is a member/manager of at least one team - separate
 * from the admin Auth Settings page (which needs admin rules). The page
 * self-scopes: `getTeams` returns every team for a global-read holder, otherwise
 * only the caller's team(s), so a team manager without any global rule can open
 * it to manage their own team(s). A user in no team (and no global rule) is not
 * allowed here. Global-admin affordances (create/delete team) stay gated on
 * `auth.teams.manage`.
 */
export const TeamsPage: React.FC = () => {
  const accessApi = useApi(accessApiRef);
  const { isInAnyTeam, loading } = useAccessRules();
  const canReadTeams = accessApi.useAccess(authAccess.teams.read);
  const canManageTeams = accessApi.useAccess(authAccess.teams.manage);

  const allowed = isInAnyTeam || canReadTeams.allowed;

  return (
    <PageLayout
      title="Teams"
      subtitle="Manage team membership, managers, and resource access."
      icon={Users2}
      loading={loading || canReadTeams.loading}
      allowed={allowed}
    >
      <TeamsTab
        canReadTeams={allowed}
        canManageTeams={canManageTeams.allowed}
        onDataChange={async () => {}}
      />
    </PageLayout>
  );
};
