import {
  createBackendPlugin,
  type AuthStrategy,
  configString,
  coreServices,
  configBoolean,
  configNumber,
} from "@checkstack/backend-api";
import { pluginMetadata } from "./plugin-metadata";
import {
  betterAuthExtensionPoint,
  redirectToAuthError,
} from "@checkstack/auth-backend";
import { AuthApi } from "@checkstack/auth-common";
import { z } from "zod";
import { Client as LdapClient } from "ldapts";
import { hashPassword } from "better-auth/crypto";
import { extractGroups } from "./helpers";
import { extractErrorMessage } from "@checkstack/common";

// LDAP Configuration Schema V1
const _ldapConfigV1 = z.object({
  enabled: configBoolean({})
    .default(false)
    .describe("Enable LDAP authentication"),
  url: configString({})
    .url()
    .default("ldaps://ldap.example.com:636")
    .describe("LDAP server URL (e.g., ldaps://ldap.example.com:636)"),
  bindDN: configString({})
    .optional()
    .describe(
      "Service account DN for searching (e.g., cn=admin,dc=example,dc=com)",
    ),
  bindPassword: configString({ "x-secret": true })
    .describe("Service account password")
    .optional(),
  baseDN: configString({})
    .default("ou=users,dc=example,dc=com")
    .describe("Base DN for user searches (e.g., ou=users,dc=example,dc=com)"),
  searchFilter: configString({})
    .default("(uid={0})")
    .describe("LDAP search filter, {0} will be replaced with username"),
  usernameAttribute: configString({})
    .default("uid")
    .describe("LDAP attribute to match against login username"),
  attributeMapping: z
    .object({
      email: configString({})
        .default("mail")
        .describe("LDAP attribute for email address"),
      name: configString({})
        .default("displayName")
        .describe("LDAP attribute for display name"),
      firstName: configString({})
        .default("givenName")
        .describe("LDAP attribute for first name")
        .optional(),
      lastName: configString({})
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
      rejectUnauthorized: configBoolean({})
        .default(true)
        .describe("Reject unauthorized SSL certificates"),
      ca: configString({ "x-secret": true })
        .describe("[textarea] Custom CA certificate (PEM format)")
        .optional(),
    })
    .default({ rejectUnauthorized: true })
    .describe("TLS/SSL configuration"),
  timeout: configNumber({})
    .default(5000)
    .describe("Connection timeout in milliseconds"),
  autoCreateUsers: configBoolean({})
    .default(true)
    .describe("Automatically create users on first login"),
  autoUpdateUsers: configBoolean({})
    .default(true)
    .describe("Update user attributes on each login"),
});

// LDAP Configuration Schema V2 (kept for migration type reference)
const _ldapConfigV2 = z.object({
  url: configString({})
    .url()
    .default("ldaps://ldap.example.com:636")
    .describe("LDAP server URL (e.g., ldaps://ldap.example.com:636)"),
  bindDN: configString({})
    .optional()
    .describe(
      "Service account DN for searching (e.g., cn=admin,dc=example,dc=com)",
    ),
  bindPassword: configString({ "x-secret": true })
    .describe("Service account password")
    .optional(),
  baseDN: configString({})
    .default("ou=users,dc=example,dc=com")
    .describe("Base DN for user searches (e.g., ou=users,dc=example,dc=com)"),
  searchFilter: configString({})
    .default("(uid={0})")
    .describe("LDAP search filter, {0} will be replaced with username"),
  usernameAttribute: configString({})
    .default("uid")
    .describe("LDAP attribute to match against login username"),
  attributeMapping: z
    .object({
      email: configString({})
        .default("mail")
        .describe("LDAP attribute for email address"),
      name: configString({})
        .default("displayName")
        .describe("LDAP attribute for display name"),
      firstName: configString({})
        .default("givenName")
        .describe("LDAP attribute for first name")
        .optional(),
      lastName: configString({})
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
      rejectUnauthorized: configBoolean({})
        .default(true)
        .describe("Reject unauthorized SSL certificates"),
      ca: configString({ "x-secret": true })
        .describe("[textarea] Custom CA certificate (PEM format)")
        .optional(),
    })
    .default({ rejectUnauthorized: true })
    .describe("TLS/SSL configuration"),
  timeout: configNumber({})
    .default(5000)
    .describe("Connection timeout in milliseconds"),
  autoCreateUsers: configBoolean({})
    .default(true)
    .describe("Automatically create users on first login"),
  autoUpdateUsers: configBoolean({})
    .default(true)
    .describe("Update user attributes on each login"),
});

// LDAP Configuration Schema V3 - Adds group-to-role mapping
const ldapConfigV3 = z.object({
  url: configString({})
    .url()
    .default("ldaps://ldap.example.com:636")
    .describe("LDAP server URL (e.g., ldaps://ldap.example.com:636)"),
  bindDN: configString({})
    .optional()
    .describe(
      "Service account DN for searching (e.g., cn=admin,dc=example,dc=com)",
    ),
  bindPassword: configString({ "x-secret": true })
    .describe("Service account password")
    .optional(),
  baseDN: configString({})
    .default("ou=users,dc=example,dc=com")
    .describe("Base DN for user searches (e.g., ou=users,dc=example,dc=com)"),
  searchFilter: configString({})
    .default("(uid={0})")
    .describe("LDAP search filter, {0} will be replaced with username"),
  usernameAttribute: configString({})
    .default("uid")
    .describe("LDAP attribute to match against login username"),
  attributeMapping: z
    .object({
      email: configString({})
        .default("mail")
        .describe("LDAP attribute for email address"),
      name: configString({})
        .default("displayName")
        .describe("LDAP attribute for display name"),
      firstName: configString({})
        .default("givenName")
        .describe("LDAP attribute for first name")
        .optional(),
      lastName: configString({})
        .default("sn")
        .describe("LDAP attribute for last name")
        .optional(),
    })
    .default({
      email: "mail",
      name: "displayName",
    })
    .describe("Map LDAP attributes to user fields"),
  // Group to Role Mapping
  groupMapping: z
    .object({
      enabled: configBoolean({})
        .default(false)
        .describe("Enable group-to-role mapping"),
      memberOfAttribute: configString({})
        .default("memberOf")
        .describe("LDAP attribute containing group memberships"),
      mappings: z
        .array(
          z.object({
            directoryGroup: configString({}).describe(
              "Directory group DN (e.g., cn=developers,ou=groups,dc=example,dc=com)",
            ),
            checkstackRole: configString({
              "x-options-resolver": "roleOptions",
            }).describe("Checkstack role ID to assign"),
          }),
        )
        .default([])
        .describe("Map directory groups to Checkstack roles"),
      defaultRole: configString({
        "x-options-resolver": "roleOptions",
      })
        .optional()
        .describe("Default role assigned to all LDAP users (optional)"),
    })
    .default({
      enabled: false,
      memberOfAttribute: "memberOf",
      mappings: [],
    })
    .describe("Map LDAP groups to Checkstack roles"),
  tlsOptions: z
    .object({
      rejectUnauthorized: configBoolean({})
        .default(true)
        .describe("Reject unauthorized SSL certificates"),
      ca: configString({ "x-secret": true })
        .describe("[textarea] Custom CA certificate (PEM format)")
        .optional(),
    })
    .default({ rejectUnauthorized: true })
    .describe("TLS/SSL configuration"),
  timeout: configNumber({})
    .default(5000)
    .describe("Connection timeout in milliseconds"),
  autoCreateUsers: configBoolean({})
    .default(true)
    .describe("Automatically create users on first login"),
  autoUpdateUsers: configBoolean({})
    .default(true)
    .describe("Update user attributes on each login"),
});

type LdapConfig = z.infer<typeof ldapConfigV3>;

// LDAP Strategy Definition
const ldapStrategy: AuthStrategy<LdapConfig> = {
  id: "ldap",
  displayName: "LDAP",
  description: "Authenticate using LDAP directory",
  icon: "Network",
  configVersion: 3,
  configSchema: ldapConfigV3,
  requiresManualRegistration: false,
  clientFlow: {
    type: "form",
    target: "/api/auth-ldap/ldap/login",
    fields: [
      {
        name: "username",
        label: "Username",
        type: "text",
        placeholder: "Username",
      },
      {
        name: "password",
        label: "Password",
        type: "password",
        placeholder: "Password",
      },
    ],
  },
  adminInstructions: `
## LDAP Configuration

Configure LDAP authentication to allow users from your directory to sign in:

1. Enter your LDAP server **URL** (e.g., \`ldaps://ldap.example.com:636\`)
2. If your server requires bind authentication, provide **Bind DN** and **password**
3. Set the **Base DN** where user accounts are located
4. Configure the **search filter** to match usernames (e.g., \`(uid={0})\` or \`(sAMAccountName={0})\`)
5. Map **LDAP attributes** to user fields (email, name)

### Group to Role Mapping
Map LDAP groups to Checkstack roles for automatic role assignment:
1. Enable **Group to Role Mapping**
2. Set the **Member Of Attribute** (usually \`memberOf\`)
3. Add mappings from directory group DNs to Checkstack roles
4. Optionally set a **Default Role** for all LDAP users

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
    {
      description: "Add group-to-role mapping configuration",
      fromVersion: 2,
      toVersion: 3,
      migrate: (oldConfig: z.infer<typeof _ldapConfigV2>) => ({
        ...oldConfig,
        groupMapping: {
          enabled: false,
          memberOfAttribute: "memberOf",
          mappings: [],
        },
      }),
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
        rpcClient: coreServices.rpcClient,
      },
      init: async ({ rpc, logger, rpcClient }) => {
        logger.debug("[auth-ldap-backend] Initializing LDAP authentication...");

        // Create auth client once for reuse
        const authClient = rpcClient.forPlugin(AuthApi);

        // Helper function to authenticate against LDAP
        const authenticateLdap = async (
          username: string,
          password: string,
        ): Promise<{
          success: boolean;
          userAttributes?: Record<string, unknown>;
          error?: string;
        }> => {
          try {
            // Load LDAP configuration from central auth-backend
            const { config: rawConfig } =
              await authClient.getOwnStrategyConfig();
            const ldapConfig = ldapConfigV3.parse(rawConfig);

            if (!ldapConfig) {
              return {
                success: false,
                error: "LDAP authentication is not enabled",
              };
            }

            // Create LDAP client
            const isSecure = ldapConfig.url.startsWith("ldaps://");
            const client = new LdapClient({
              url: ldapConfig.url.trim(),
              timeout: ldapConfig.timeout,
              tlsOptions: isSecure
                ? ldapConfig.tlsOptions.ca
                  ? {
                      rejectUnauthorized:
                        ldapConfig.tlsOptions.rejectUnauthorized,
                      ca: ldapConfig.tlsOptions.ca,
                    }
                  : {
                      rejectUnauthorized:
                        ldapConfig.tlsOptions.rejectUnauthorized,
                    }
                : undefined,
            });

            try {
              // Step 1: Bind with service account (if configured)
              if (ldapConfig.bindDN && ldapConfig.bindPassword) {
                await client.bind(ldapConfig.bindDN, ldapConfig.bindPassword);
              }

              // Step 2: Search for the user
              const searchFilter = ldapConfig.searchFilter.replace(
                "{0}",
                username,
              );
              // Request all user attributes (*) plus the memberOf operational attribute
              // memberOf is not returned by default in most LDAP servers
              const searchAttributes = ["*"];
              if (
                ldapConfig.groupMapping?.enabled &&
                ldapConfig.groupMapping.memberOfAttribute
              ) {
                searchAttributes.push(
                  ldapConfig.groupMapping.memberOfAttribute,
                );
              }

              const searchResult = await client.search(ldapConfig.baseDN, {
                filter: searchFilter,
                scope: "sub",
                attributes: searchAttributes,
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
                  `Multiple LDAP entries found for username: ${username}`,
                );
              }

              const userEntry = searchResult.searchEntries[0];
              const userDN = userEntry.dn;

              // Step 3: Try to bind as the user to verify password
              const userClient = new LdapClient({
                url: ldapConfig.url.trim(),
                timeout: ldapConfig.timeout,
                tlsOptions: isSecure
                  ? ldapConfig.tlsOptions.ca
                    ? {
                        rejectUnauthorized:
                          ldapConfig.tlsOptions.rejectUnauthorized,
                        ca: ldapConfig.tlsOptions.ca,
                      }
                    : {
                        rejectUnauthorized:
                          ldapConfig.tlsOptions.rejectUnauthorized,
                      }
                  : undefined,
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
                  // Normalize memberOf attribute case and preserve arrays for group mapping
                  if (
                    ldapConfig.groupMapping?.enabled &&
                    ldapConfig.groupMapping.memberOfAttribute &&
                    key.toLowerCase() ===
                      ldapConfig.groupMapping.memberOfAttribute.toLowerCase()
                  ) {
                    attributes[ldapConfig.groupMapping.memberOfAttribute] =
                      value;
                  } else {
                    // Take first value for standard attributes like name/email
                    attributes[key] = value[0];
                  }
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
              error: extractErrorMessage(error, "Unknown error"),
            };
          }
        };

        // Helper function to create or update user via RPC
        const syncUser = async (
          username: string,
          ldapAttributes: Record<string, unknown>,
        ): Promise<{ userId: string; email: string; name: string }> => {
          const { config: rawConfig } = await authClient.getOwnStrategyConfig();
          const ldapConfig = ldapConfigV3.parse(rawConfig);

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
                "User does not exist and auto-creation is disabled",
              );
            }
          }

          // Extract groups and map to roles if enabled
          let syncRoles: string[] | undefined;
          let managedRoleIds: string[] | undefined;
          if (ldapConfig.groupMapping?.enabled) {
            const groups = extractGroups({
              ldapEntry: ldapAttributes,
              memberOfAttribute: ldapConfig.groupMapping.memberOfAttribute,
            });

            // Map groups to roles (case-insensitive comparison for DN matching)
            const mappedRoles = ldapConfig.groupMapping.mappings
              .filter((m) =>
                groups.some(
                  (g) => g.toLowerCase() === m.directoryGroup.toLowerCase(),
                ),
              )
              .map((m) => m.checkstackRole);

            // Add default role if configured
            if (ldapConfig.groupMapping.defaultRole) {
              mappedRoles.push(ldapConfig.groupMapping.defaultRole);
            }

            // Deduplicate roles
            syncRoles = [...new Set(mappedRoles)];

            // Collect all managed role IDs (all roles in mappings + default)
            // These are roles controlled by directory - will be removed if user leaves groups
            const allManagedRoles = ldapConfig.groupMapping.mappings.map(
              (m) => m.checkstackRole,
            );
            if (ldapConfig.groupMapping.defaultRole) {
              allManagedRoles.push(ldapConfig.groupMapping.defaultRole);
            }
            managedRoleIds = [...new Set(allManagedRoles)];

            if (syncRoles.length > 0) {
              logger.debug(
                `LDAP user ${email} matched ${groups.length} groups, assigning roles: ${syncRoles.join(", ")}`,
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
            syncRoles,
            managedRoleIds,
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
                authResult.error || "Authentication failed",
              );
            }

            // Sync user to database
            const { userId, email, name } = await syncUser(
              username,
              authResult.userAttributes!,
            );

            // Create session via RPC
            // This delegates cookie signing to the auth-backend (Better-Auth)
            const ipAddress =
              req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
              undefined;
            const userAgent = req.headers.get("user-agent") || undefined;

            const { setCookies } = await authClient.createSession({
              userId,
              ipAddress,
              userAgent,
            });

            logger.info(
              `Created bridged session for LDAP user: ${email} (IP: ${ipAddress ?? "unknown"})`,
            );

            // Return user info and include the signed session cookies from better-auth
            // Each cookie must be set as a separate Set-Cookie header
            const headers = new Headers();
            for (const cookie of setCookies) {
              headers.append("Set-Cookie", cookie);
            }

            return Response.json(
              {
                success: true,
                user: {
                  id: userId,
                  email,
                  name,
                },
              },
              { headers },
            );
          } catch (error) {
            logger.error("LDAP login error:", error);
            const message = extractErrorMessage(
              error,
              "Authentication failed. Please try again.",
            );
            return redirectToAuthError(message);
          }
        }, "/ldap/login");

        logger.debug("✅ LDAP authentication initialized");
      },
    });
  },
});
