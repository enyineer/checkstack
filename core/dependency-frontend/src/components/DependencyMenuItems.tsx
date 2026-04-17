
import { Link } from "react-router-dom";
import { GitBranch } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { dependencyRoutes } from "@checkstack/dependency-common";

/**
 * Adds a "Dependency Map" link to the user menu.
 */
export const DependencyMenuItems = (_props: UserMenuItemsContext) => {
  return (
    <Link to={resolveRoute(dependencyRoutes.routes.map)}>
      <DropdownMenuItem icon={<GitBranch className="h-4 w-4" />}>
        Dependency Map
      </DropdownMenuItem>
    </Link>
  );
};
