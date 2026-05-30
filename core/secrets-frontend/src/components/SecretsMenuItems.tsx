import React from "react";
import { Link } from "react-router-dom";
import { KeyRound } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  secretsRoutes,
  secretsAccess,
  pluginMetadata,
} from "@checkstack/secrets-common";

/**
 * "Secrets" entry in the user/settings menu. Gated on `secrets.manage`
 * (the page route is also access-gated); hiding the link is the cleaner
 * UX for unauthorised users.
 */
export const SecretsMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${secretsAccess.secret.manage.id}`;
  const canManage = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canManage) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(secretsRoutes.routes.home)}>
      <DropdownMenuItem icon={<KeyRound className="w-4 h-4" />}>
        Secrets
      </DropdownMenuItem>
    </Link>
  );
};
