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

// SAML Configuration Schema V1
const samlConfigV1 = z.object({
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

type SamlConfig = z.infer<typeof samlConfigV1>;

// SAML Strategy Definition
const samlStrategy: AuthStrategy<SamlConfig> = {
  id: "saml",
  displayName: "SAML SSO",
  description: "Enterprise Single Sign-On via SAML 2.0",
  icon: "KeyRound",
  configVersion: 1,
  configSchema: samlConfigV1,
  requiresManualRegistration: false,
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

> **Tip**: Most IdPs use standard claim URIs. Consult your IdP documentation for specific attribute names.
`.trim(),
};

// Helper to extract attribute value from SAML assertion
const extractAttribute = ({
  attributes,
  attributeName,
}: {
  attributes: Record<string, unknown>;
  attributeName: string;
}): string | undefined => {
  const value = attributes[attributeName];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return String(value[0]);
  return undefined;
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
        config: coreServices.config,
        rpcClient: coreServices.rpcClient,
      },
      init: async ({ rpc, logger, config, rpcClient }) => {
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
          const samlConfig = await config.get("saml", samlConfigV1, 1);

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
          const samlConfig = await config.get("saml", samlConfigV1, 1);
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

          // Use RPC to upsert user - always create/update SAML users
          const hashedPassword = await hashPassword(crypto.randomUUID());

          const { userId, created } = await authClient.upsertExternalUser({
            email,
            name,
            providerId: "saml",
            accountId: nameId,
            password: hashedPassword,
            autoUpdateUser: true,
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
              error instanceof Error
                ? error.message
                : "Failed to initiate SAML login",
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
            const sessionToken = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

            await authClient.createSession({
              userId,
              token: sessionToken,
              expiresAt,
            });

            logger.info(`Created session for SAML user: ${email}`);

            // Redirect to home with session cookie
            return new Response(undefined, {
              status: 302,
              headers: {
                Location: "/",
                "Set-Cookie": `better-auth.session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
                  7 * 24 * 60 * 60
                }`,
              },
            });
          } catch (error) {
            logger.error("SAML ACS error:", error);
            const message =
              error instanceof Error
                ? error.message
                : "SAML authentication failed";
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
