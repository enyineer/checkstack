import React from "react";
import { Link } from "react-router-dom";
import { Server } from "lucide-react";
import {
  type UserMenuItemsContext,
  pluginRegistry,
} from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  infrastructureRoutes,
  InfrastructureTabsSlot,
  type InfrastructureTabMetadata,
} from "@checkstack/infrastructure-common";

/**
 * User menu item pointing to Infrastructure Settings.
 * Only visible if the user has read access to at least one infrastructure tab.
 *
 * The check is best-effort/synchronous: it uses the user's pre-fetched
 * access-rule list rather than calling `useAccess`, which avoids hooks in a
 * component that may be rendered without a Suspense boundary.
 */
export const InfrastructureUserMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const tabs = pluginRegistry.getExtensions(InfrastructureTabsSlot.id);

  const canReadAny = tabs.some((ext) => {
    const meta = ext.metadata as InfrastructureTabMetadata | undefined;
    if (!meta) return false;
    return (
      userPerms.includes("*") || userPerms.includes(meta.readAccess.id)
    );
  });

  if (!canReadAny) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(infrastructureRoutes.routes.config)}>
      <DropdownMenuItem icon={<Server className="h-4 w-4" />}>
        Infrastructure Settings
      </DropdownMenuItem>
    </Link>
  );
};
