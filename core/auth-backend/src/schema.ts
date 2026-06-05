import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
  integer,
  index,
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

export const accessRule = pgTable("access_rule", {
  id: text("id").primaryKey(), // 'core.manage-users', etc.
  description: text("description"),
});

export const roleAccessRule = pgTable(
  "role_access_rule",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => role.id),
    accessRuleId: text("access_rule_id")
      .notNull()
      .references(() => accessRule.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.accessRuleId] }),
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
 * Tracks authenticated default access rules that have been disabled by admins.
 * When a plugin registers an access rule with isAuthenticatedDefault=true, it gets assigned
 * to the "users" role unless it's in this table.
 */
export const disabledDefaultAccessRule = pgTable(
  "disabled_default_access_rule",
  {
    accessRuleId: text("access_rule_id")
      .primaryKey()
      .references(() => accessRule.id),
    disabledAt: timestamp("disabled_at").notNull(),
  }
);

/**
 * Tracks public default access rules that have been disabled by admins.
 * When a plugin registers an access rule with isPublicDefault=true, it gets assigned
 * to the "anonymous" role unless it's in this table.
 */
export const disabledPublicDefaultAccessRule = pgTable(
  "disabled_public_default_access_rule",
  {
    accessRuleId: text("access_rule_id")
      .primaryKey()
      .references(() => accessRule.id),
    disabledAt: timestamp("disabled_at").notNull(),
  }
);

// --- External Applications Schema ---

/**
 * External applications (API keys) for programmatic API access.
 * Applications have roles assigned like users and authenticate via Bearer tokens.
 */
export const application = pgTable("application", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull(),
  description: text("description"),
  // Hashed secret (bcrypt) - never stored in plain text
  secretHash: text("secret_hash").notNull(),
  // User who created this application
  createdById: text("created_by_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Track when the application was last used for API calls
  lastUsedAt: timestamp("last_used_at"),
});

/**
 * Application-to-Role mapping for RBAC.
 * Similar to userRole but for external applications.
 */
export const applicationRole = pgTable(
  "application_role",
  {
    applicationId: text("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => role.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.applicationId, t.roleId] }),
  })
);

// --- Teams Schema ---

/**
 * Teams for resource-level access control.
 * Users can be members of multiple teams, and resources can be scoped to teams.
 */
export const team = pgTable("team", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * User-to-Team membership (M:N).
 * Users can belong to multiple teams.
 */
export const userTeam = pgTable(
  "user_team",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.teamId] }),
  })
);

/**
 * Application-to-Team membership (M:N).
 * API keys can belong to teams for resource access.
 */
export const applicationTeam = pgTable(
  "application_team",
  {
    applicationId: text("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.applicationId, t.teamId] }),
  })
);

/**
 * Team managers - users who can manage a specific team's membership and resource access.
 * Team managers cannot delete the team or manage other teams.
 */
export const teamManager = pgTable(
  "team_manager",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.userId] }),
  })
);

/**
 * Resource-level access settings.
 * Controls whether a resource requires team membership (teamOnly) vs allowing global access.
 */
export const resourceAccessSettings = pgTable(
  "resource_access_settings",
  {
    resourceType: text("resource_type").notNull(), // e.g., "catalog.system"
    resourceId: text("resource_id").notNull(),
    teamOnly: boolean("team_only").notNull().default(false), // If true, global access doesn't apply
  },
  (t) => ({
    pk: primaryKey({ columns: [t.resourceType, t.resourceId] }),
  })
);

/**
 * Centralized resource-level access control.
 * Stores team grants for all resource types across the platform.
 */
export const resourceTeamAccess = pgTable(
  "resource_team_access",
  {
    resourceType: text("resource_type").notNull(), // e.g., "catalog.system"
    resourceId: text("resource_id").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    canRead: boolean("can_read").notNull().default(true),
    canManage: boolean("can_manage").notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.resourceType, t.resourceId, t.teamId] }),
  })
);

// --- AI platform: OAuth Authorization Server (better-auth oidcProvider/mcp) ---
//
// These three tables are OWNED by the better-auth `oidcProvider` + `mcp`
// plugins (Phase 2). The plugins' Drizzle adapter resolves them by the camelCase
// model keys below (`oauthApplication`, `oauthAccessToken`, `oauthConsent`) and
// the camelCase field keys; column names are snake_case to match repo
// convention. Field shapes mirror the plugin schema exactly (see
// SPIKE-findings.md). Access tokens are OPAQUE random strings persisted here —
// validation is an introspection lookup, not a JWKS verify (decision §11).

/** Registered OAuth clients (incl. dynamically-registered MCP clients). */
export const oauthApplication = pgTable("oauth_application", {
  id: text("id").primaryKey(),
  name: text("name"),
  icon: text("icon"),
  metadata: text("metadata"),
  clientId: text("client_id").unique(),
  clientSecret: text("client_secret"),
  redirectUrls: text("redirect_urls"),
  type: text("type"),
  disabled: boolean("disabled").default(false),
  userId: text("user_id"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/** Issued opaque access/refresh tokens + their granted scopes. */
export const oauthAccessToken = pgTable("oauth_access_token", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").unique(),
  refreshToken: text("refresh_token").unique(),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  clientId: text("client_id"),
  userId: text("user_id"),
  scopes: text("scopes"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/** Per-(client,user) consent record for the consent screen. */
export const oauthConsent = pgTable("oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id"),
  userId: text("user_id"),
  scopes: text("scopes"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  consentGiven: boolean("consent_given"),
});

// --- AI platform: shared-Postgres rate-limit counter (state-and-scale §14.5) ---
//
// Fixed-window counter so a limit holds across ALL pods (an in-memory per-pod
// limiter would let N pods each allow the cap = N x the intended limit). Used
// today for the DCR endpoint throttle (`dcr:<ip>`); per-principal tool budgets
// (Phase 3) reuse the same table with a different key.
export const aiRateLimit = pgTable(
  "ai_rate_limit",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.windowStart] }),
    keyIdx: index("ai_rate_limit_key_idx").on(t.key, t.windowStart),
  }),
);
