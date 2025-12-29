import { createPermission } from "@checkmate/common";

export const permissions = {
  healthCheckRead: createPermission(
    "healthcheck",
    "read",
    "Read Health Check Configurations and Status"
  ),
  healthCheckManage: createPermission(
    "healthcheck",
    "manage",
    "Full management of Health Check Configurations"
  ),
};

export const permissionList = Object.values(permissions);
