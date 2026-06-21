import { describe, expect, test } from "bun:test";

import {
  MCP_OAUTH_CONFIG_ID,
  MCP_OAUTH_CONFIG_VERSION,
  mcpOAuthConfigV1,
} from "./mcp-oauth-config";
import {
  PLATFORM_REGISTRATION_CONFIG_ID,
  PLATFORM_REGISTRATION_CONFIG_VERSION,
  platformRegistrationConfigV1,
} from "./platform-registration-config";

// These platform meta-config schemas encode security-relevant fail-safe
// defaults (the OAuth Authorization Server and Dynamic Client Registration are
// OFF until an operator opts in; the DCR rate-limit must stay a positive
// integer). A regression that flips a default or drops a constraint has
// user-visible / security blast radius, so guard the defaults explicitly.

describe("mcpOAuthConfigV1", () => {
  test("an empty config resolves to the fail-safe defaults", () => {
    expect(mcpOAuthConfigV1.parse({})).toEqual({
      enabled: false,
      allowDynamicClientRegistration: false,
      dcrRateLimitMax: 5,
      dcrRateLimitWindowSeconds: 3600,
    });
  });

  test("explicit values override the defaults", () => {
    expect(
      mcpOAuthConfigV1.parse({
        enabled: true,
        allowDynamicClientRegistration: true,
        dcrRateLimitMax: 10,
        dcrRateLimitWindowSeconds: 60,
      }),
    ).toEqual({
      enabled: true,
      allowDynamicClientRegistration: true,
      dcrRateLimitMax: 10,
      dcrRateLimitWindowSeconds: 60,
    });
  });

  test.each([
    ["zero max", { dcrRateLimitMax: 0 }],
    ["negative max", { dcrRateLimitMax: -1 }],
    ["non-integer max", { dcrRateLimitMax: 1.5 }],
    ["zero window", { dcrRateLimitWindowSeconds: 0 }],
    ["negative window", { dcrRateLimitWindowSeconds: -1 }],
    ["non-integer window", { dcrRateLimitWindowSeconds: 60.5 }],
  ])("rejects %s", (_label, patch) => {
    expect(() => mcpOAuthConfigV1.parse(patch)).toThrow();
  });

  test("has a stable version and config id", () => {
    expect(MCP_OAUTH_CONFIG_VERSION).toBe(1);
    expect(MCP_OAUTH_CONFIG_ID).toBe("ai.mcp-oauth");
  });
});

describe("platformRegistrationConfigV1", () => {
  test("registration is allowed by default", () => {
    expect(platformRegistrationConfigV1.parse({})).toEqual({
      allowRegistration: true,
    });
  });

  test("registration can be explicitly disabled", () => {
    expect(
      platformRegistrationConfigV1.parse({ allowRegistration: false }),
    ).toEqual({ allowRegistration: false });
  });

  test("rejects a non-boolean allowRegistration", () => {
    expect(() =>
      platformRegistrationConfigV1.parse({ allowRegistration: "yes" }),
    ).toThrow();
  });

  test("has a stable version and config id", () => {
    expect(PLATFORM_REGISTRATION_CONFIG_VERSION).toBe(1);
    expect(PLATFORM_REGISTRATION_CONFIG_ID).toBe("platform.registration");
  });
});
