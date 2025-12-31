import { createPermission } from "@checkmate/common";

export const permissions = {
  catalogRead: createPermission(
    "catalog",
    "read",
    "Read Catalog (Systems and Groups)",
    { isDefault: true }
  ),
  catalogManage: createPermission(
    "catalog",
    "manage",
    "Full management of Catalog (Systems and Groups)"
  ),
};

export const permissionList = Object.values(permissions);
