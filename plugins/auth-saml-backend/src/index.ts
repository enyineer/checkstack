import {
  createBackendPlugin,
  type AuthStrategy,
  configString,
  coreServices,
  configBoolean,
} from "@checkstack/backend-api";
import { pluginMetadata } from "./plugin-metadata";
import {
  betterAuthExtensionPoint,
  redirectToAuthError,
} from "@checkstack/auth-backend";
import { AuthApi } from "@checkstack/auth-common";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import * as samlify from "samlify";
import { extractAttribute, extractGroups } from "./helpers";
import { extractErrorMessage } from "@checkstack/common";

// SAML Configuration Schema V1
const _samlConfigV1 = z.object({
  // Identity Provider configuration
  idpMetadataUrl: configString({})
    .url()
    .optional()
    .describe(
      "URL to fetch IdP metadata XML (optional if providing metadata directly)",
    ),
  idpMetadata: configString({})
    .optional()
    .describe("IdP metadata XML content (used if URL is not provided)"),
  idpEntityId: configString({})
    .optional()
    .describe("IdP Entity ID (extracted from metadata if not provided)"),
  idpSingleSignOnUrl: configString({})
    .url()
    .optional()
    .describe("IdP SSO URL (extracted from metadata if not provided)"),
  idpCertificate: configString({ "x-secret": true })
    .optional()
    .describe("IdP X.509 certificate for signature validation (PEM format)"),

  // Service Provider configuration
  spEntityId: configString({})
    .default("checkstack")
    .describe("Service Provider Entity ID (your application identifier)"),
  spPrivateKey: configString({ "x-secret": true })
    .optional()
    .describe("SP private key for signing requests (PEM format)"),
  spCertificate: configString({})
    .optional()
    .describe("SP public certificate (PEM format)"),

  // Attribute mapping
  attributeMapping: z
    .object({
      email: configString({})
        .default(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        )
        .describe("SAML attribute for email address"),
      name: configString({})
        .default("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
        .describe("SAML attribute for display name"),
      firstName: configString({})
        .default(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
        )
        .describe("SAML attribute for first name")
        .optional(),
      lastName: configString({})
        .default(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
        )
        .describe("SAML attribute for last name")
        .optional(),
    })
    .default({
      email:
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    })
    .describe("Map SAML attributes to user fields"),

  // Security options
  wantAssertionsSigned: configBoolean({})
    .default(true)
    .describe("Require signed SAML assertions"),
  signAuthnRequest: configBoolean({})
    .default(false)
    .describe("Sign authentication requests sent to IdP"),
});

// SAML Configuration Schema V2 - Adds group-to-role mapping
const samlConfigV2 = z.object({
  // Identity Provider configuration
  idpMetadataUrl: configString({})
    .url()
    .optional()
    .describe(
      "URL to fetch IdP metadata XML (optional if providing metadata directly)",
    ),
  idpMetadata: configString({})
    .optional()
    .describe("IdP metadata XML content (used if URL is not provided)"),
  idpEntityId: configString({})
    .optional()
    .describe("IdP Entity ID (extracted from metadata if not provided)"),
  idpSingleSignOnUrl: configString({})
    .url()
    .optional()
    .describe("IdP SSO URL (extracted from metadata if not provided)"),
  idpCertificate: configString({ "x-secret": true })
    .optional()
    .describe("IdP X.509 certificate for signature validation (PEM format)"),

  // Service Provider configuration
  spEntityId: configString({})
    .default("checkstack")
    .describe("Service Provider Entity ID (your application identifier)"),
  spPrivateKey: configString({ "x-secret": true })
    .optional()
    .describe("SP private key for signing requests (PEM format)"),
  spCertificate: configString({})
    .optional()
    .describe("SP public certificate (PEM format)"),

  // Attribute mapping
  attributeMapping: z
    .object({
      email: configString({})
        .default(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        )
        .describe("SAML attribute for email address"),
      name: configString({})
        .default("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
        .describe("SAML attribute for display name"),
      firstName: configString({})
        .default(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
        )
        .describe("SAML attribute for first name")
        .optional(),
      lastName: configString({})
        .default(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
        )
        .describe("SAML attribute for last name")
        .optional(),
    })
    .default({
      email:
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    })
    .describe("Map SAML attributes to user fields"),

  // Group to Role Mapping
  groupMapping: z
    .object({
      enabled: configBoolean({})
        .default(false)
        .describe("Enable group-to-role mapping"),
      groupAttribute: configString({})
        .default("http://schemas.xmlsoap.org/claims/Group")
        .describe("SAML attribute containing group memberships"),
      mappings: z
        .array(
          z.object({
            directoryGroup: configString({}).describe(
              "Directory group name or DN",
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
        .describe("Default role assigned to all SAML users (optional)"),
    })
    .default({
      enabled: false,
      groupAttribute: "http://schemas.xmlsoap.org/claims/Group",
      mappings: [],
    })
    .describe("Map SAML groups to Checkstack roles"),

  // Security options
  wantAssertionsSigned: configBoolean({})
    .default(true)
    .describe("Require signed SAML assertions"),
  signAuthnRequest: configBoolean({})
    .default(false)
    .describe("Sign authentication requests sent to IdP"),
});

type SamlConfig = z.infer<typeof samlConfigV2>;

// SAML Strategy Definition
const samlStrategy: AuthStrategy<SamlConfig> = {
  id: "saml",
  displayName: "SAML SSO",
  description: "Enterprise Single Sign-On via SAML 2.0",
  icon: "KeyRound",
  configVersion: 2,
  configSchema: samlConfigV2,
  migrations: [
    {
      description: "Add group-to-role mapping configuration",
      fromVersion: 1,
      toVersion: 2,
      migrate: (oldConfig: z.infer<typeof _samlConfigV1>) => ({
        ...oldConfig,
        groupMapping: {
          enabled: false,
          groupAttribute: "http://schemas.xmlsoap.org/claims/Group",
          mappings: [],
        },
      }),
    },
  ],
  requiresManualRegistration: false,
  clientFlow: {
    type: "redirect",
    target: "/api/auth-saml/saml/login",
  },
  adminInstructions: `
## SAML SSO Configuration

Configure SAML 2.0 Single Sign-On to allow users to authenticate via your organization's Identity Provider:

### Option 1: Using IdP Metadata URL (Recommended)
1. Copy your IdP's metadata URL from your identity provider (Okta, Azure AD, OneLogin, ADFS)
2. Paste it in the **IdP Metadata URL** field
3. Set your **SP Entity ID** (a unique identifier for this application)

### Option 2: Manual Configuration
1. Enter the **IdP SSO URL** from your identity provider
2. Paste the **IdP Certificate** (X.509 format, PEM encoded)
3. Set the **IdP Entity ID** if different from the SSO URL

### Service Provider Setup
Configure your IdP with these values:
- **SP Entity ID**: Your configured entity ID (default: \`checkstack\`)
- **ACS URL**: \`https://yourdomain.com/api/auth-saml/saml/acs\`
- **SP Metadata**: \`https://yourdomain.com/api/auth-saml/saml/metadata\`

### Attribute Mapping
Map SAML attributes from your IdP to user fields:
- **Email**: Usually \`http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress\`
- **Name**: Usually \`http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name\`

### Group to Role Mapping
Map SAML groups to Checkstack roles for automatic role assignment:
1. Enable **Group to Role Mapping**
2. Set the **Group Attribute** (the SAML claim containing group memberships)
3. Add mappings from directory groups to Checkstack roles
4. Optionally set a **Default Role** for all SAML users

> **Tip**: Most IdPs use standard claim URIs. Consult your IdP documentation for specific attribute names.
`.trim(),
};

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    // Register the SAML strategy
    const extensionPoint = env.getExtensionPoint(betterAuthExtensionPoint);
    extensionPoint.addStrategy(samlStrategy);

    // Register init logic for SAML endpoints
    env.registerInit({
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        rpcClient: coreServices.rpcClient,
      },
      init: async ({ rpc, logger, rpcClient }) => {
        logger.debug("[auth-saml-backend] Initializing SAML authentication...");

        // Create auth client once for reuse
        const authClient = rpcClient.forPlugin(AuthApi);

        // Helper to create SP/IdP instances from current config
        // Note: Instances are created fresh per request to ensure config changes
        // propagate immediately across all horizontally scaled instances
        const getSamlInstances = async (): Promise<{
          sp: samlify.ServiceProviderInstance;
          idp: samlify.IdentityProviderInstance;
        }> => {
          const { config: rawConfig } = await authClient.getOwnStrategyConfig();
          const samlConfig = samlConfigV2.parse(rawConfig);

          if (!samlConfig) {
            throw new Error("SAML configuration not found");
          }

          // Determine IdP metadata source
          let idpMetadata: string | undefined = samlConfig.idpMetadata;

          if (!idpMetadata && samlConfig.idpMetadataUrl) {
            // Fetch metadata from URL
            try {
              const response = await fetch(samlConfig.idpMetadataUrl);
              if (!response.ok) {
                throw new Error(
                  `Failed to fetch IdP metadata: ${response.status}`,
                );
              }
              idpMetadata = await response.text();
            } catch (error) {
              logger.error("Failed to fetch IdP metadata:", error);
              throw new Error("Failed to fetch IdP metadata from URL");
            }
          }

          // Build the base URL from environment or request context
          const baseUrl =
            process.env.PUBLIC_URL ||
            process.env.BASE_URL ||
            "http://localhost:3000";
          const acsUrl = `${baseUrl}/api/auth-saml/saml/acs`;

          // Create Service Provider
          const spConfig: Parameters<typeof samlify.ServiceProvider>[0] = {
            entityID: samlConfig.spEntityId,
            assertionConsumerService: [
              {
                Binding: samlify.Constants.namespace.binding.post,
                Location: acsUrl,
              },
            ],
            wantAssertionsSigned: samlConfig.wantAssertionsSigned,
            authnRequestsSigned: samlConfig.signAuthnRequest,
          };

          if (samlConfig.spPrivateKey) {
            spConfig.privateKey = samlConfig.spPrivateKey;
          }
          if (samlConfig.spCertificate) {
            spConfig.signingCert = samlConfig.spCertificate;
          }

          const sp = samlify.ServiceProvider(spConfig);

          // Create Identity Provider
          let idp: samlify.IdentityProviderInstance;
          if (idpMetadata) {
            idp = samlify.IdentityProvider({
              metadata: idpMetadata,
            });
          } else if (
            samlConfig.idpSingleSignOnUrl &&
            samlConfig.idpCertificate
          ) {
            idp = samlify.IdentityProvider({
              entityID: samlConfig.idpEntityId || samlConfig.idpSingleSignOnUrl,
              singleSignOnService: [
                {
                  Binding: samlify.Constants.namespace.binding.redirect,
                  Location: samlConfig.idpSingleSignOnUrl,
                },
              ],
              signingCert: samlConfig.idpCertificate,
            });
          } else {
            throw new Error(
              "IdP configuration incomplete: provide metadata URL/XML or manual SSO URL + certificate",
            );
          }

          return { sp, idp };
        };

        // Helper function to sync user via RPC
        const syncUser = async ({
          nameId,
          attributes,
        }: {
          nameId: string;
          attributes: Record<string, unknown>;
        }): Promise<{ userId: string; email: string; name: string }> => {
          const { config: rawConfig } = await authClient.getOwnStrategyConfig();
          const samlConfig = samlConfigV2.parse(rawConfig);

          if (!samlConfig) {
            throw new Error("SAML configuration not found");
          }

          // Extract user info from SAML attributes
          const mapping = samlConfig.attributeMapping;
          const email =
            extractAttribute({ attributes, attributeName: mapping.email }) ||
            nameId;

          // Build name from available attributes
          let name: string;
          const extractedName = extractAttribute({
            attributes,
            attributeName: mapping.name,
          });
          if (extractedName) {
            name = extractedName;
          } else if (mapping.firstName && mapping.lastName) {
            const firstName = extractAttribute({
              attributes,
              attributeName: mapping.firstName,
            });
            const lastName = extractAttribute({
              attributes,
              attributeName: mapping.lastName,
            });
            name =
              firstName && lastName
                ? `${firstName} ${lastName}`
                : email.split("@")[0];
          } else {
            name = email.split("@")[0];
          }

          // Extract groups and map to roles if enabled
          let syncRoles: string[] | undefined;
          let managedRoleIds: string[] | undefined;
          if (samlConfig.groupMapping?.enabled) {
            const groups = extractGroups({
              attributes,
              groupAttribute: samlConfig.groupMapping.groupAttribute,
            });

            // Map groups to roles
            const mappedRoles = samlConfig.groupMapping.mappings
              .filter((m) => groups.includes(m.directoryGroup))
              .map((m) => m.checkstackRole);

            // Add default role if configured
            if (samlConfig.groupMapping.defaultRole) {
              mappedRoles.push(samlConfig.groupMapping.defaultRole);
            }

            // Deduplicate roles
            syncRoles = [...new Set(mappedRoles)];

            // Collect all managed role IDs (all roles in mappings + default)
            // These are roles controlled by directory - will be removed if user leaves groups
            const allManagedRoles = samlConfig.groupMapping.mappings.map(
              (m) => m.checkstackRole,
            );
            if (samlConfig.groupMapping.defaultRole) {
              allManagedRoles.push(samlConfig.groupMapping.defaultRole);
            }
            managedRoleIds = [...new Set(allManagedRoles)];

            if (syncRoles.length > 0) {
              logger.debug(
                `SAML user ${email} will be assigned roles: ${syncRoles.join(", ")}`,
              );
            }
          }

          // Use RPC to upsert user - always create/update SAML users
          const hashedPassword = await hashPassword(crypto.randomUUID());

          const { userId, created } = await authClient.upsertExternalUser({
            email,
            name,
            providerId: "saml",
            accountId: nameId,
            password: hashedPassword,
            autoUpdateUser: true,
            syncRoles,
            managedRoleIds,
          });

          if (created) {
            logger.info(`Created new user from SAML: ${email}`);
          } else {
            logger.debug(`Updated SAML user: ${email}`);
          }

          return { userId, email, name };
        };

        // SSO initiation endpoint: /saml/login
        rpc.registerHttpHandler(async () => {
          try {
            const { sp, idp } = await getSamlInstances();

            // Create login request
            const { context } = sp.createLoginRequest(idp, "redirect");

            // Redirect to IdP
            return new Response(undefined, {
              status: 302,
              headers: {
                Location: context,
              },
            });
          } catch (error) {
            logger.error("SAML login initiation failed:", error);
            return redirectToAuthError(
              extractErrorMessage(error, "Failed to initiate SAML login"),
            );
          }
        }, "saml/login");

        // Assertion Consumer Service: /saml/acs
        rpc.registerHttpHandler(async (req: Request) => {
          try {
            const { sp, idp } = await getSamlInstances();

            // Parse the POST body
            const formData = await req.formData();
            const samlResponse = formData.get("SAMLResponse");

            if (!samlResponse || typeof samlResponse !== "string") {
              return redirectToAuthError("Missing SAML response");
            }

            // Parse and validate the SAML response
            const parseResult = await sp.parseLoginResponse(idp, "post", {
              body: { SAMLResponse: samlResponse },
            });

            if (!parseResult.extract) {
              return redirectToAuthError("Failed to parse SAML assertion");
            }

            const { nameID, attributes } = parseResult.extract;

            if (!nameID) {
              return redirectToAuthError("Missing NameID in SAML assertion");
            }

            // Sync user to database
            const { userId, email } = await syncUser({
              nameId: nameID,
              attributes: attributes ?? {},
            });

            // Create session via RPC
            // This delegates cookie signing to the auth-backend (Better-Auth)
            const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || undefined;
            const userAgent = req.headers.get("user-agent") || undefined;

            const { setCookie } = await authClient.createSession({
              userId,
              ipAddress,
              userAgent,
            });

            logger.info(`Created bridged session for SAML user: ${email} (IP: ${ipAddress ?? "unknown"})`);

            // Redirect to home with the signed session cookie from better-auth
            return new Response(undefined, {
              status: 302,
              headers: {
                Location: "/",
                "Set-Cookie": setCookie,
              },
            });
          } catch (error) {
            logger.error("SAML ACS error:", error);
            const message =
              extractErrorMessage(error, "SAML authentication failed");
            return redirectToAuthError(message);
          }
        }, "saml/acs");

        // SP Metadata endpoint: /saml/metadata
        rpc.registerHttpHandler(async () => {
          try {
            const { sp } = await getSamlInstances();
            const metadata = sp.getMetadata();

            return new Response(metadata, {
              status: 200,
              headers: {
                "Content-Type": "application/xml",
              },
            });
          } catch (error) {
            logger.error("Failed to generate SP metadata:", error);
            return new Response("Failed to generate metadata", { status: 500 });
          }
        }, "saml/metadata");

        logger.debug("✅ SAML authentication initialized");
      },
    });
  },
});
