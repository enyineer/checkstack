import { useNavigate } from "react-router-dom";
import { FileCode2 } from "lucide-react";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { useApi, permissionApiRef } from "@checkmate-monitor/frontend-api";
import { resolveRoute, qualifyPermissionId } from "@checkmate-monitor/common";
import {
  pluginMetadata,
  permissions,
} from "@checkmate-monitor/api-docs-common";
import { apiDocsRoutes } from "./index";

const REQUIRED_PERMISSION = qualifyPermissionId(
  pluginMetadata,
  permissions.apiDocsView
);

export function ApiDocsMenuItem() {
  const navigate = useNavigate();
  const permissionApi = useApi(permissionApiRef);
  const canView = permissionApi.usePermission(REQUIRED_PERMISSION);

  if (canView.loading || !canView.allowed) return;

  return (
    <DropdownMenuItem
      onClick={() => navigate(resolveRoute(apiDocsRoutes.routes.docs))}
      icon={<FileCode2 className="h-4 w-4" />}
    >
      API Documentation
    </DropdownMenuItem>
  );
}
