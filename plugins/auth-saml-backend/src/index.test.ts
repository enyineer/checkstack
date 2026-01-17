import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { configString, configBoolean } from "@checkstack/backend-api";

// Re-create the config schema for testing
const samlConfigV1 = z.object({
  idpMetadataUrl: configString({}).url().optional(),
  idpMetadata: configString({}).optional(),
  idpEntityId: configString({}).optional(),
  idpSingleSignOnUrl: configString({}).url().optional(),
  idpCertificate: configString({ "x-secret": true }).optional(),
  spEntityId: configString({}).default("checkstack"),
  spPrivateKey: configString({ "x-secret": true }).optional(),
  spCertificate: configString({}).optional(),
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
      firstName: configString({}).optional(),
      lastName: configString({}).optional(),
    })
    .default({
      email:
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    }),
  wantAssertionsSigned: configBoolean({}).default(true),
  signAuthnRequest: configBoolean({}).default(false),
});

// Helper function to test
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

describe("SAML Configuration Schema", () => {
  describe("validation", () => {
    it("should accept valid config with metadata URL", () => {
      const config = {
        idpMetadataUrl: "https://idp.example.com/metadata",
        spEntityId: "my-app",
      };

      const result = samlConfigV1.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.idpMetadataUrl).toBe(
          "https://idp.example.com/metadata",
        );
        expect(result.data.spEntityId).toBe("my-app");
      }
    });

    it("should accept valid config with manual IdP settings", () => {
      const config = {
        idpSingleSignOnUrl: "https://idp.example.com/sso",
        idpCertificate:
          "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
        idpEntityId: "https://idp.example.com",
        spEntityId: "my-app",
      };

      const result = samlConfigV1.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should apply default values", () => {
      const config = {};

      const result = samlConfigV1.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spEntityId).toBe("checkstack");
        expect(result.data.wantAssertionsSigned).toBe(true);
        expect(result.data.signAuthnRequest).toBe(false);
        expect(result.data.attributeMapping.email).toBe(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        );
        expect(result.data.attributeMapping.name).toBe(
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
        );
      }
    });

    it("should reject invalid IdP metadata URL", () => {
      const config = {
        idpMetadataUrl: "not-a-valid-url",
      };

      const result = samlConfigV1.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject invalid IdP SSO URL", () => {
      const config = {
        idpSingleSignOnUrl: "not-a-valid-url",
      };

      const result = samlConfigV1.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe("attribute mapping", () => {
    it("should accept custom attribute mappings", () => {
      const config = {
        attributeMapping: {
          email: "mail",
          name: "displayName",
          firstName: "givenName",
          lastName: "sn",
        },
      };

      const result = samlConfigV1.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.attributeMapping.email).toBe("mail");
        expect(result.data.attributeMapping.name).toBe("displayName");
        expect(result.data.attributeMapping.firstName).toBe("givenName");
        expect(result.data.attributeMapping.lastName).toBe("sn");
      }
    });
  });
});

describe("extractAttribute helper", () => {
  it("should extract string values", () => {
    const attributes = { email: "user@example.com" };
    const result = extractAttribute({
      attributes,
      attributeName: "email",
    });
    expect(result).toBe("user@example.com");
  });

  it("should extract first element from arrays", () => {
    const attributes = { email: ["user@example.com", "other@example.com"] };
    const result = extractAttribute({
      attributes,
      attributeName: "email",
    });
    expect(result).toBe("user@example.com");
  });

  it("should return undefined for missing attributes", () => {
    const attributes = {};
    const result = extractAttribute({
      attributes,
      attributeName: "email",
    });
    expect(result).toBeUndefined();
  });

  it("should return undefined for empty arrays", () => {
    const attributes = { email: [] };
    const result = extractAttribute({
      attributes,
      attributeName: "email",
    });
    expect(result).toBeUndefined();
  });

  it("should convert non-string values to string", () => {
    const attributes = { id: [12345] };
    const result = extractAttribute({
      attributes,
      attributeName: "id",
    });
    expect(result).toBe("12345");
  });
});
