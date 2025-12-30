import {
  createBackendPlugin,
  type AuthStrategy,
  secret,
  coreServices,
} from "@checkmate/backend-api";
import { betterAuthExtensionPoint } from "@checkmate/auth-backend";
import { z } from "zod";
import { Client as LdapClient } from "ldapts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

// LDAP Configuration Schema V1
const ldapConfigV1 = z.object({
  enabled: z.boolean().default(false).describe("Enable LDAP authentication"),
  url: z
    .string()
    .url()
    .default("ldaps://ldap.example.com:636")
    .describe("LDAP server URL (e.g., ldaps://ldap.example.com:636)"),
  bindDN: z
    .string()
    .optional()
    .describe(
      "Service account DN for searching (e.g., cn=admin,dc=example,dc=com)"
    ),
  bindPassword: secret().optional().describe("Service account password"),
  baseDN: z
    .string()
    .default("ou=users,dc=example,dc=com")
    .describe("Base DN for user searches (e.g., ou=users,dc=example,dc=com)"),
  searchFilter: z
    .string()
    .default("(uid={0})")
    .describe("LDAP search filter, {0} will be replaced with username"),
  usernameAttribute: z
    .string()
    .default("uid")
    .describe("LDAP attribute to match against login username"),
  attributeMapping: z
    .object({
      email: z
        .string()
        .default("mail")
        .describe("LDAP attribute for email address"),
      name: z
        .string()
        .default("displayName")
        .describe("LDAP attribute for display name"),
      firstName: z
        .string()
        .default("givenName")
        .describe("LDAP attribute for first name")
        .optional(),
      lastName: z
        .string()
        .default("sn")
        .describe("LDAP attribute for last name")
        .optional(),
    })
    .default({
      email: "mail",
      name: "displayName",
    })
    .describe("Map LDAP attributes to user fields"),
  tlsOptions: z
    .object({
      rejectUnauthorized: z
        .boolean()
        .default(true)
        .describe("Reject unauthorized SSL certificates"),
      ca: secret().optional().describe("Custom CA certificate (PEM format)"),
    })
    .default({ rejectUnauthorized: true })
    .describe("TLS/SSL configuration"),
  timeout: z
    .number()
    .default(5000)
    .describe("Connection timeout in milliseconds"),
  autoCreateUsers: z
    .boolean()
    .default(true)
    .describe("Automatically create users on first login"),
  autoUpdateUsers: z
    .boolean()
    .default(true)
    .describe("Update user attributes on each login"),
});

type LdapConfig = z.infer<typeof ldapConfigV1>;

// LDAP Strategy Definition
const ldapStrategy: AuthStrategy<LdapConfig> = {
  id: "ldap",
  displayName: "LDAP",
  description: "Authenticate using LDAP directory",
  icon: "network",
  configVersion: 1,
  configSchema: ldapConfigV1,
  requiresManualRegistration: false,
};

export default createBackendPlugin({
  pluginId: "auth-ldap-backend",
  register(env) {
    // Register the LDAP strategy
    const extensionPoint = env.getExtensionPoint(betterAuthExtensionPoint);
    extensionPoint.addStrategy(ldapStrategy);

    // Register init logic for custom login endpoint
    env.registerInit({
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        config: coreServices.config,
        database: coreServices.database,
      },
      init: async ({ rpc, logger, config, database }) => {
        logger.debug("[auth-ldap-backend] Initializing LDAP authentication...");

        // Helper function to authenticate against LDAP
        const authenticateLdap = async (
          username: string,
          password: string
        ): Promise<{
          success: boolean;
          userAttributes?: Record<string, unknown>;
          error?: string;
        }> => {
          try {
            // Load LDAP configuration
            const ldapConfig = await config.get("ldap", ldapConfigV1, 1);

            if (!ldapConfig || !ldapConfig.enabled) {
              return {
                success: false,
                error: "LDAP authentication is not enabled",
              };
            }

            // Create LDAP client
            const client = new LdapClient({
              url: ldapConfig.url,
              timeout: ldapConfig.timeout,
              tlsOptions: ldapConfig.tlsOptions.ca
                ? {
                    rejectUnauthorized:
                      ldapConfig.tlsOptions.rejectUnauthorized,
                    ca: ldapConfig.tlsOptions.ca,
                  }
                : {
                    rejectUnauthorized:
                      ldapConfig.tlsOptions.rejectUnauthorized,
                  },
            });

            try {
              // Step 1: Bind with service account (if configured)
              if (ldapConfig.bindDN && ldapConfig.bindPassword) {
                await client.bind(ldapConfig.bindDN, ldapConfig.bindPassword);
              }

              // Step 2: Search for the user
              const searchFilter = ldapConfig.searchFilter.replace(
                "{0}",
                username
              );
              const searchResult = await client.search(ldapConfig.baseDN, {
                filter: searchFilter,
                scope: "sub",
              });

              if (
                !searchResult.searchEntries ||
                searchResult.searchEntries.length === 0
              ) {
                return {
                  success: false,
                  error: "User not found in LDAP directory",
                };
              }

              if (searchResult.searchEntries.length > 1) {
                logger.warn(
                  `Multiple LDAP entries found for username: ${username}`
                );
              }

              const userEntry = searchResult.searchEntries[0];
              const userDN = userEntry.dn;

              // Step 3: Try to bind as the user to verify password
              const userClient = new LdapClient({
                url: ldapConfig.url,
                timeout: ldapConfig.timeout,
                tlsOptions: ldapConfig.tlsOptions.ca
                  ? {
                      rejectUnauthorized:
                        ldapConfig.tlsOptions.rejectUnauthorized,
                      ca: ldapConfig.tlsOptions.ca,
                    }
                  : {
                      rejectUnauthorized:
                        ldapConfig.tlsOptions.rejectUnauthorized,
                    },
              });

              try {
                await userClient.bind(userDN, password);
              } catch (bindError) {
                logger.debug(`LDAP bind failed for user ${userDN}:`, bindError);
                return { success: false, error: "Invalid credentials" };
              } finally {
                await userClient.unbind();
              }

              // Step 4: Extract user attributes
              const attributes: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(userEntry)) {
                if (typeof value === "string" || typeof value === "number") {
                  attributes[key] = value;
                } else if (Array.isArray(value) && value.length > 0) {
                  // Take first value for arrays
                  attributes[key] = value[0];
                }
              }

              return { success: true, userAttributes: attributes };
            } finally {
              await client.unbind();
            }
          } catch (error) {
            logger.error("LDAP authentication error:", error);
            return {
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        };

        // Helper function to create or update user in database
        const syncUser = async (
          username: string,
          ldapAttributes: Record<string, unknown>
        ): Promise<{ userId: string; email: string; name: string }> => {
          const ldapConfig = await config.get("ldap", ldapConfigV1, 1);
          if (!ldapConfig) {
            throw new Error("LDAP configuration not found");
          }

          // Extract user info from LDAP attributes
          const mapping = ldapConfig.attributeMapping;
          const email =
            (ldapAttributes[mapping.email] as string | undefined) ||
            `${username}@ldap.local`;

          // Build name from available attributes
          let name: string;
          if (ldapAttributes[mapping.name]) {
            name = ldapAttributes[mapping.name] as string;
          } else if (
            mapping.firstName &&
            mapping.lastName &&
            ldapAttributes[mapping.firstName] &&
            ldapAttributes[mapping.lastName]
          ) {
            name = `${ldapAttributes[mapping.firstName]} ${
              ldapAttributes[mapping.lastName]
            }`;
          } else {
            name = username;
          }

          // Use raw SQL to access auth-backend schema tables
          // Check if user exists by email
          const existingUsers = await (
            database as NodePgDatabase<Record<string, unknown>>
          ).execute(
            sql`SELECT id FROM plugin_auth_backend."user" WHERE email = ${email}`
          );

          let userId: string;

          if (existingUsers.rows && existingUsers.rows.length > 0) {
            // User exists - update if autoUpdateUsers is enabled
            userId = (existingUsers.rows[0] as Record<string, string>).id;

            if (ldapConfig.autoUpdateUsers) {
              await (
                database as NodePgDatabase<Record<string, unknown>>
              ).execute(
                sql`
                  UPDATE plugin_auth_backend."user" 
                  SET name = ${name}, updated_at = NOW() 
                  WHERE id = ${userId}
                `
              );
              logger.debug(`Updated LDAP user: ${email}`);
            }
          } else {
            // Create new user
            if (!ldapConfig.autoCreateUsers) {
              throw new Error(
                "User does not exist and auto-creation is disabled"
              );
            }

            userId = crypto.randomUUID();
            await (database as NodePgDatabase<Record<string, unknown>>).execute(
              sql`
                INSERT INTO plugin_auth_backend."user" 
                (id, email, name, email_verified, created_at, updated_at)
                VALUES (${userId}, ${email}, ${name}, false, NOW(), NOW())
              `
            );

            // Create LDAP account entry
            const accountId = crypto.randomUUID();
            const hashedPassword = await hashPassword(crypto.randomUUID()); // Random password, won't be used

            await (database as NodePgDatabase<Record<string, unknown>>).execute(
              sql`
                INSERT INTO plugin_auth_backend."account" 
                (id, account_id, provider_id, user_id, password, created_at, updated_at)
                VALUES (${accountId}, ${username}, 'ldap', ${userId}, ${hashedPassword}, NOW(), NOW())
              `
            );

            logger.info(`Created new user from LDAP: ${email}`);
          }

          return { userId, email, name };
        };

        // Register custom HTTP handler for LDAP login
        rpc.registerHttpHandler(
          "/api/auth-backend/ldap/login",
          async (req: Request) => {
            try {
              const body = await req.json();
              const { username, password } = body;

              if (!username || !password) {
                return Response.json(
                  {
                    error: "Username and password are required",
                  },
                  {
                    status: 400,
                  }
                );
              }

              // Authenticate with LDAP
              const authResult = await authenticateLdap(username, password);

              if (!authResult.success) {
                return Response.json(
                  {
                    error: authResult.error || "Authentication failed",
                  },
                  {
                    status: 401,
                  }
                );
              }

              // Sync user to database
              const { userId, email, name } = await syncUser(
                username,
                authResult.userAttributes!
              );

              // Create better-auth session manually
              const sessionId = crypto.randomUUID();
              const sessionToken = crypto.randomUUID();
              const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

              await (
                database as NodePgDatabase<Record<string, unknown>>
              ).execute(
                sql`
                  INSERT INTO plugin_auth_backend."session" 
                  (id, user_id, token, expires_at, created_at, updated_at)
                  VALUES (${sessionId}, ${userId}, ${sessionToken}, ${expiresAt}, NOW(), NOW())
                `
              );

              logger.info(`Created session for LDAP user: ${email}`);

              // Return session token in cookie format
              return Response.json(
                {
                  success: true,
                  user: {
                    id: userId,
                    email,
                    name,
                  },
                },
                {
                  status: 200,
                  headers: {
                    "Content-Type": "application/json",
                    "Set-Cookie": `better-auth.session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
                      7 * 24 * 60 * 60
                    }`,
                  },
                }
              );
            } catch (error) {
              logger.error("LDAP login error:", error);
              return Response.json(
                {
                  error:
                    error instanceof Error
                      ? error.message
                      : "Internal server error",
                },
                {
                  status: 500,
                }
              );
            }
          }
        );

        logger.debug("✅ LDAP authentication initialized");
      },
    });
  },
});
