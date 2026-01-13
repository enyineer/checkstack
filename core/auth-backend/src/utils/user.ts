import { User } from "better-auth/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import type { RealUser } from "@checkstack/backend-api";
import * as schema from "../schema";

/**
 * Enriches a better-auth User with roles, permissions, and team memberships from the database.
 * Returns a RealUser type for use in the RPC context.
 */
export const enrichUser = async (
  user: User,
  db: NodePgDatabase<typeof schema>
): Promise<RealUser> => {
  // 1. Get Roles
  const userRoles = await db
    .select({
      roleName: schema.role.name,
      roleId: schema.role.id,
    })
    .from(schema.userRole)
    .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
    .where(eq(schema.userRole.userId, user.id));

  const roles = userRoles.map((r) => r.roleId);
  const permissions = new Set<string>();

  // 2. Get Permissions for each role
  for (const roleId of roles) {
    if (roleId === "admin") {
      permissions.add("*");
      continue;
    }

    const rolePermissions = await db
      .select({
        permissionId: schema.permission.id,
      })
      .from(schema.rolePermission)
      .innerJoin(
        schema.permission,
        eq(schema.permission.id, schema.rolePermission.permissionId)
      )
      .where(eq(schema.rolePermission.roleId, roleId));

    for (const p of rolePermissions) {
      permissions.add(p.permissionId);
    }
  }

  // 3. Get Team memberships
  const userTeams = await db
    .select({ teamId: schema.userTeam.teamId })
    .from(schema.userTeam)
    .where(eq(schema.userTeam.userId, user.id));
  const teamIds = userTeams.map((t) => t.teamId);

  return {
    // Spread user first to preserve additional properties
    ...user,
    // Override with required RealUser fields
    type: "user",
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    permissions: [...permissions],
    teamIds,
  };
};
