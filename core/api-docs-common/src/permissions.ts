import { createPermission } from "@checkmate-monitor/common";

export const permissions = {
  apiDocsView: createPermission("api-docs", "read", "View API Documentation", {
    isAuthenticatedDefault: true,
  }),
};

export const permissionList = Object.values(permissions);
