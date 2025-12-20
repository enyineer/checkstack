import type { Permission } from "@checkmate/common";

export const permissions = {
  entityRead: {
    id: "entity.read",
    description: "Read Systems and Groups",
  },
  entityCreate: {
    id: "entity.create",
    description: "Create Systems and Groups",
  },
  entityUpdate: {
    id: "entity.update",
    description: "Update Systems and Groups",
  },
  entityDelete: {
    id: "entity.delete",
    description: "Delete Systems and Groups",
  },
  incidentManage: {
    id: "incident.manage",
    description: "Manage Incidents (Create, Update, Resolve)",
  },
  maintenanceManage: {
    id: "maintenance.manage",
    description: "Manage Maintenances",
  },
  catalogManage: {
    id: "catalog.manage",
    description: "Full management of Catalog (Systems, Groups, Views)",
  },
} satisfies Record<string, Permission>;

export const permissionList = Object.values(permissions);
