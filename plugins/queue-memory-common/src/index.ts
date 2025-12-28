import { Permission } from "@checkmate/common";

export const permissions = {
  queueRead: {
    id: "queue.read",
    description: "View queue configuration and statistics",
  } satisfies Permission,
  queueWrite: {
    id: "queue.write",
    description: "Modify queue configuration",
  } satisfies Permission,
};

export const permissionList: Permission[] = Object.values(permissions);
