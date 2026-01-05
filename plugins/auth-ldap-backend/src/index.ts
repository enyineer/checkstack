import {
  createBackendPlugin,
  type AuthStrategy,
  secret,
  coreServices,
} from "@checkmate/backend-api";
import { pluginMetadata } from "./plugin-metadata";
import {
  betterAuthExtensionPoint,
  redirectToAuthError,
} from "@checkmate/auth-backend";
import { AuthApi } from "@checkmate/auth-common";
import { z } from "zod";
import { Client as LdapClient } from "ldapts";
import { hashPassword } from "better-auth/crypto";

// LDAP Configuration Schema V1
const _ldapConfigV1 = z.object({
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
  bindPassword: secret({ description: "Service account password" }).optional(),
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
      ca: secret({
        description: "Custom CA certificate (PEM format)",
      }).optional(),
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

// LDAP Configuration Schema V1
const ldapConfigV2 = z.object({
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
  bindPassword: secret({ description: "Service account password" }).optional(),
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
      ca: secret({
        description: "Custom CA certificate (PEM format)",
      }).optional(),
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

type LdapConfig = z.infer<typeof ldapConfigV2>;

// LDAP Strategy Definition
const ldapStrategy: AuthStrategy<LdapConfig> = {
  id: "ldap",
  displayName: "LDAP",
  description: "Authenticate using LDAP directory",
  icon: "network",
  configVersion: 2,
  configSchema: ldapConfigV2,
  requiresManualRegistration: false,
  adminInstructions: `
## LDAP Configuration

Configure LDAP authentication to allow users from your directory to sign in:

1. Enter your LDAP server **URL** (e.g., \`ldaps://ldap.example.com:636\`)
2. If your server requires bind authentication, provide **Bind DN** and **password**
3. Set the **Base DN** where user accounts are located
4. Configure the **search filter** to match usernames (e.g., \`(uid={0})\` or \`(sAMAccountName={0})\`)
5. Map **LDAP attributes** to user fields (email, name)

> **Active Directory**: Use \`ldaps://\` with port 636, \`sAMAccountName\` for username, and \`userPrincipalName\` for email.
`.trim(),
  migrations: [
    {
      description: "Migrate LDAP configuration to version 2",
      fromVersion: 1,
      toVersion: 2,
      migrate: (oldConfig: z.infer<typeof _ldapConfigV1>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { enabled, ...rest } = oldConfig;
        return rest;
      },
    },
  ],
};

export default createBackendPlugin({
  metadata: pluginMetadata,
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
        rpcClient: coreServices.rpcClient,
      },
      init: async ({ rpc, logger, config, rpcClient }) => {
        logger.debug("[auth-ldap-backend] Initializing LDAP authentication...");

        // Create auth client once for reuse
        const authClient = rpcClient.forPlugin(AuthApi);

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
            const ldapConfig = await config.get("ldap", ldapConfigV2, 2);

            if (!ldapConfig) {
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

        // Helper function to create or update user via RPC
        const syncUser = async (
          username: string,
          ldapAttributes: Record<string, unknown>
        ): Promise<{ userId: string; email: string; name: string }> => {
          const ldapConfig = await config.get("ldap", ldapConfigV2, 2);
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

          // Check if auto-creation is disabled and user doesn't exist
          if (!ldapConfig.autoCreateUsers) {
            const existingUser = await authClient.findUserByEmail({ email });
            if (!existingUser) {
              throw new Error(
                "User does not exist and auto-creation is disabled"
              );
            }
          }

          // Use RPC to upsert user (handles registration check, user/account creation)
          const hashedPassword = await hashPassword(crypto.randomUUID()); // Random password, won't be used

          const { userId, created } = await authClient.upsertExternalUser({
            email,
            name,
            providerId: "ldap",
            accountId: username,
            password: hashedPassword,
            autoUpdateUser: ldapConfig.autoUpdateUsers,
          });

          if (created) {
            logger.info(`Created new user from LDAP: ${email}`);
          } else if (ldapConfig.autoUpdateUsers) {
            logger.debug(`Updated LDAP user: ${email}`);
          }

          return { userId, email, name };
        };

        // Register custom HTTP handler for LDAP login
        // Path /ldap/login will resolve to /api/auth-ldap/ldap/login
        rpc.registerHttpHandler(async (req: Request) => {
          try {
            const body = await req.json();
            const { username, password } = body;

            if (!username || !password) {
              return redirectToAuthError("Username and password are required");
            }

            // Authenticate with LDAP
            const authResult = await authenticateLdap(username, password);

            if (!authResult.success) {
              return redirectToAuthError(
                authResult.error || "Authentication failed"
              );
            }

            // Sync user to database
            const { userId, email, name } = await syncUser(
              username,
              authResult.userAttributes!
            );

            // Create session via RPC
            const sessionToken = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

            await authClient.createSession({
              userId,
              token: sessionToken,
              expiresAt,
            });

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
            const message =
              error instanceof Error
                ? error.message
                : "Authentication failed. Please try again.";
            return redirectToAuthError(message);
          }
        });

        logger.debug("✅ LDAP authentication initialized");
      },
    });
  },
});
