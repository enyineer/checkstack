import { useNavigate } from "react-router-dom";
import { FileCode2 } from "lucide-react";
import { DropdownMenuItem } from "@checkmate/ui";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";
import { resolveRoute } from "@checkmate/common";
import { apiDocsRoutes, REQUIRED_PERMISSION } from "./index";

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
