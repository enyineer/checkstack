import { useNavigate } from "react-router-dom";
import { FileCode2 } from "lucide-react";
import { DropdownMenuItem } from "@checkstack/ui";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { pluginMetadata, apiDocsAccess } from "@checkstack/api-docs-common";
import { apiDocsRoutes } from "./index";
import React from "react";

const REQUIRED_ACCESS_RULE = `${pluginMetadata.pluginId}.${apiDocsAccess.view.id}`;

export function ApiDocsMenuItem({
  accessRules: userPerms,
}: UserMenuItemsContext) {
  const navigate = useNavigate();
  const canView =
    userPerms.includes("*") || userPerms.includes(REQUIRED_ACCESS_RULE);

  if (!canView) return <React.Fragment />;

  return (
    <DropdownMenuItem
      onClick={() => navigate(resolveRoute(apiDocsRoutes.routes.docs))}
      icon={<FileCode2 className="h-4 w-4" />}
    >
      API Documentation
    </DropdownMenuItem>
  );
}
