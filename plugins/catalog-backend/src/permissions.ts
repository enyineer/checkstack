export const permissions = {
  catalog: {
    entity: {
      read: {
        id: "catalog.entity.read",
        description: "Read Systems and Groups",
      },
      create: {
        id: "catalog.entity.create",
        description: "Create Systems and Groups",
      },
      update: {
        id: "catalog.entity.update",
        description: "Update Systems and Groups",
      },
      delete: {
        id: "catalog.entity.delete",
        description: "Delete Systems and Groups",
      },
    },
    incident: {
      manage: {
        id: "catalog.incident.manage",
        description: "Manage Incidents (Create, Update, Resolve)",
      },
    },
    maintenance: {
      manage: {
        id: "catalog.maintenance.manage",
        description: "Manage Maintenances",
      },
    },
  },
};
