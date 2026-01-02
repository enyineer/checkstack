import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

// --- Better Auth Schema ---
// Tables use pgTable (schemaless) - runtime schema is set via search_path
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// --- RBAC Schema ---
export const role = pgTable("role", {
  id: text("id").primaryKey(), // 'admin', 'user', 'anonymous'
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(false), // Prevent deletion of core roles
});

export const permission = pgTable("permission", {
  id: text("id").primaryKey(), // 'core.manage-users', etc.
  description: text("description"),
});

export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => role.id),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permission.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  })
);

export const userRole = pgTable(
  "user_role",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    roleId: text("role_id")
      .notNull()
      .references(() => role.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  })
);

/**
 * Tracks authenticated default permissions that have been disabled by admins.
 * When a plugin registers a permission with isAuthenticatedDefault=true, it gets assigned
 * to the "users" role unless it's in this table.
 */
export const disabledDefaultPermission = pgTable(
  "disabled_default_permission",
  {
    permissionId: text("permission_id")
      .primaryKey()
      .references(() => permission.id),
    disabledAt: timestamp("disabled_at").notNull(),
  }
);

/**
 * Tracks public default permissions that have been disabled by admins.
 * When a plugin registers a permission with isPublicDefault=true, it gets assigned
 * to the "anonymous" role unless it's in this table.
 */
export const disabledPublicDefaultPermission = pgTable(
  "disabled_public_default_permission",
  {
    permissionId: text("permission_id")
      .primaryKey()
      .references(() => permission.id),
    disabledAt: timestamp("disabled_at").notNull(),
  }
);
