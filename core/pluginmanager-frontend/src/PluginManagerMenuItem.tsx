import { useNavigate } from "react-router-dom";
import { Puzzle } from "lucide-react";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { pluginManagerRoutes } from "@checkstack/pluginmanager-common";

export function PluginManagerMenuItem() {
  const navigate = useNavigate();

  return (
    <DropdownMenuItem
      onClick={() =>
        navigate(resolveRoute(pluginManagerRoutes.routes.installed))
      }
      icon={<Puzzle className="h-4 w-4" />}
    >
      Plugin Manager
    </DropdownMenuItem>
  );
}
