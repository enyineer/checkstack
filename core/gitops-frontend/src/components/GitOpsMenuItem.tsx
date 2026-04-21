import { useNavigate } from "react-router-dom";
import { GitBranch } from "lucide-react";
import { DropdownMenuItem } from "@checkstack/ui";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { pluginMetadata, gitopsAccess, gitopsRoutes } from "@checkstack/gitops-common";
import React from "react";

const REQUIRED_ACCESS_RULE = `${pluginMetadata.pluginId}.${gitopsAccess.provider.read.id}`;

export function GitOpsMenuItem({
  accessRules: userPerms,
}: UserMenuItemsContext) {
  const navigate = useNavigate();
  const canView =
    userPerms.includes("*") || userPerms.includes(REQUIRED_ACCESS_RULE);

  if (!canView) return <React.Fragment />;

  return (
    <DropdownMenuItem
      onClick={() => navigate(resolveRoute(gitopsRoutes.routes.home))}
      icon={<GitBranch className="h-4 w-4" />}
    >
      GitOps
    </DropdownMenuItem>
  );
}
