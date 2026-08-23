import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
  integer,
  bigint,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// resource_access_settings, resource_team_access, and resource_create_grant
// were collapsed into the single `relation_tuple` store below (Target B). Their
// data is backfilled and the tables dropped in migration 0008.

/**
 * Relation tuples — the single ReBAC store (Target B) that replaces
 * `resource_team_access` (read/manage/owner), `resource_access_settings`
 * (teamOnly), and `resource_create_grant` (create-capability). One row =
 * "<subject> has <relation> on <object>".
 *
 * - object = (objectType, objectId). `objectId = "*"` is the type-level object
 *   used by the `creator` relation ("team may create this type").
 * - relation ∈ { viewer, editor, owner, creator } with implication
 *   owner ⊃ editor ⊃ viewer (resolved in code, not stored).
 * - subject = (subjectType, subjectId): `team:<id>` for team grants, or the
 *   special `public:*` whose `viewer` tuple is the PRIVACY MARKER — its presence
 *   means "the global RBAC path is open for this object" (today's `teamOnly =
 *   false`); its absence (when team grants exist) means private.
 *
 * `subject_id` is polymorphic so it has no FK; team existence is enforced in the
 * write path and team deletion cascades by deleting the team's tuples in the
 * team-delete handler.
 */
export const relationTuple = pgTable(
  "relation_tuple",
  {
    objectType: text("object_type").notNull(), // e.g. "catalog.system"
    objectId: text("object_id").notNull(), // resource id, or "*" for type-level
    relation: text("relation").notNull(), // viewer | editor | owner | creator
    subjectType: text("subject_type").notNull(), // team | public
    subjectId: text("subject_id").notNull(), // teamId, or "*" for public
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [
        t.objectType,
        t.objectId,
        t.relation,
        t.subjectType,
        t.subjectId,
      ],
    }),
    // "what can this team touch" + team-delete cleanup.
    bySubject: index("relation_tuple_by_subject").on(
      t.subjectType,
      t.subjectId,
      t.objectType,
      t.relation
    ),
    // "does this team hold any grant of a relation on this type" (G11 403).
    byTypeRelation: index("relation_tuple_by_type_relation").on(
      t.objectType,
      t.relation,
      t.subjectType,
      t.subjectId
    ),
    // At most one owning team per object (replaces is_owner partial unique).
    ownerUnique: uniqueIndex("relation_tuple_owner_unique")
      .on(t.objectType, t.objectId)
      .where(sql`${t.relation} = 'owner' AND ${t.subjectType} = 'team'`),
  })
);

// --- Better Auth JWT/OAuth Provider schema ---
//
// Better Auth 1.7's MCP plugin is built on the OAuth Provider. These tables
// intentionally follow its model and field names so the Drizzle adapter can
// resolve every provider operation. The previous oidcProvider tables are
// migrated to legacy names in the follow-up migration; old opaque tokens are
// not valid against the new token storage format.

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

/** Registered OAuth clients, including dynamically registered MCP clients. */
export const oauthClient = pgTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes")
      .array()
      .default([]),
    userId: text("user_id").references(() => user.id),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required",
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    userIdIdx: index("oauth_client_user_id_idx").on(table.userId),
  }),
);

/** Protected resources whose identifiers become JWT audiences. */
export const oauthResource = pgTable(
  "oauth_resource",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull().unique(),
    name: text("name").notNull(),
    accessTokenTtl: integer("access_token_ttl"),
    refreshTokenTtl: integer("refresh_token_ttl"),
    signingAlgorithm: text("signing_algorithm"),
    signingKeyId: text("signing_key_id"),
    allowedScopes: text("allowed_scopes").array(),
    customClaims: jsonb("custom_claims"),
    dpopBoundAccessTokensRequired: boolean(
      "dpop_bound_access_tokens_required",
    ).default(false),
    disabled: boolean("disabled").default(false),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    policyVersion: integer("policy_version").default(1),
    metadata: jsonb("metadata"),
  },
);

/** Client/resource links used by the provider's per-resource policy. */
export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at"),
  },
  (table) => ({
    clientResourceUnique: uniqueIndex("oauth_client_resource_unique").on(
      table.clientId,
      table.resourceId,
    ),
    clientIdIdx: index("oauth_client_resource_client_id_idx").on(
      table.clientId,
    ),
    resourceIdIdx: index("oauth_client_resource_resource_id_idx").on(
      table.resourceId,
    ),
  }),
);

/** Hashed refresh tokens and their immutable granted scope set. */
export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").notNull().references(() => user.id),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    rotatedAt: timestamp("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
    authTime: timestamp("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => ({
    clientIdIdx: index("oauth_refresh_token_client_id_idx").on(
      table.clientId,
    ),
    authorizationCodeIdIdx: index(
      "oauth_refresh_token_authorization_code_id_idx",
    ).on(table.authorizationCodeId),
    sessionIdIdx: index("oauth_refresh_token_session_id_idx").on(
      table.sessionId,
    ),
    userIdIdx: index("oauth_refresh_token_user_id_idx").on(table.userId),
  }),
);

/** Opaque access tokens used by the live scope-narrowing resource server. */
export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => ({
    clientIdIdx: index("oauth_access_token_client_id_idx").on(table.clientId),
    authorizationCodeIdIdx: index(
      "oauth_access_token_authorization_code_id_idx",
    ).on(table.authorizationCodeId),
    sessionIdIdx: index("oauth_access_token_session_id_idx").on(
      table.sessionId,
    ),
    userIdIdx: index("oauth_access_token_user_id_idx").on(table.userId),
    refreshIdIdx: index("oauth_access_token_refresh_id_idx").on(
      table.refreshId,
    ),
  }),
);

/** Per-(client,user) consent record for the consent screen. */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text("user_id").references(() => user.id),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => ({
    clientIdIdx: index("oauth_consent_client_id_idx").on(table.clientId),
    userIdIdx: index("oauth_consent_user_id_idx").on(table.userId),
  }),
);

/** Replay tombstones for private_key_jwt client assertions. */
export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
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

// --- better-auth rate-limit storage (shared-Postgres, state-and-scale §14.5) ---
//
// better-auth's BUILT-IN brute-force limiter (login, password-reset, etc.)
// defaults to `storage: "memory"`, i.e. a per-pod in-process Map. With N pods
// behind one database that makes the effective limit N x the intended cap — a
// classic horizontal-scale brute-force hole that a single-process test never
// catches. We back better-auth's limiter with THIS shared table via a
// `customStorage` adapter (see `better-auth-rate-limit-store.ts`), so the
// counter is global across all pods. `key` is better-auth's per-IP+path key,
// `count` the running count in the current window, `lastRequest` the last hit
// in epoch milliseconds.
export const betterAuthRateLimit = pgTable("better_auth_rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  lastRequest: bigint("last_request", { mode: "number" }).notNull().default(0),
});
