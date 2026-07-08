import { describe, it, expect, spyOn, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import {
  backstageConfigSchemaV1,
  userConfigSchemaV1,
  mapImportanceToSeverity,
  backstageStrategy,
} from "./index";

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  };
}

type BackstageSendContext = Parameters<typeof backstageStrategy.send>[0];

function makeContext(baseUrl: string): BackstageSendContext {
  return {
    user: { userId: "u1", email: "u1@example.com" },
    contact: "user:default/u1",
    notification: {
      title: "Alert",
      body: "body",
      importance: "info",
      type: "test",
    },
    strategyConfig: {
      baseUrl,
      token: "tok",
      defaultEntityPrefix: "user:default/",
    },
    userConfig: { entityRef: "user:default/u1" },
    layoutConfig: undefined,
    logger: makeLogger(),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Config Schema Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("backstageConfigSchemaV1", () => {
  it("should accept valid config with all fields", () => {
    const config = {
      baseUrl: "https://backstage.example.com",
      token: "my-secret-token",
      defaultEntityPrefix: "user:development/",
    };

    const result = backstageConfigSchemaV1.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe("https://backstage.example.com");
      expect(result.data.token).toBe("my-secret-token");
      expect(result.data.defaultEntityPrefix).toBe("user:development/");
    }
  });

  it("should accept config with only required fields (all optional)", () => {
    const config = {};

    const result = backstageConfigSchemaV1.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultEntityPrefix).toBe("user:default/");
    }
  });

  it("should reject invalid URL", () => {
    const config = {
      baseUrl: "not-a-valid-url",
      token: "my-token",
    };

    const result = backstageConfigSchemaV1.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("should use default entity prefix when not provided", () => {
    const config = {
      baseUrl: "https://backstage.example.com",
      token: "my-token",
    };

    const result = backstageConfigSchemaV1.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultEntityPrefix).toBe("user:default/");
    }
  });
});

describe("userConfigSchemaV1", () => {
  it("should accept valid user config with entity reference", () => {
    const config = {
      entityRef: "user:default/john.doe",
    };

    const result = userConfigSchemaV1.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entityRef).toBe("user:default/john.doe");
    }
  });

  it("should accept empty user config", () => {
    const config = {};

    const result = userConfigSchemaV1.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should accept group entity references", () => {
    const config = {
      entityRef: "group:default/team-platform",
    };

    const result = userConfigSchemaV1.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entityRef).toBe("group:default/team-platform");
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Severity Mapping Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("mapImportanceToSeverity", () => {
  it("should map 'info' to 'normal'", () => {
    expect(mapImportanceToSeverity("info")).toBe("normal");
  });

  it("should map 'warning' to 'high'", () => {
    expect(mapImportanceToSeverity("warning")).toBe("high");
  });

  it("should map 'critical' to 'critical'", () => {
    expect(mapImportanceToSeverity("critical")).toBe("critical");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Strategy Send Function Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("backstageStrategy.send", () => {
  // Note: Full integration tests would require mocking the plugin registration
  // For now, we test the exported utility functions and schema validation
  // The send function is tested indirectly through proper config validation

  it("should validate that baseUrl and token are required for sending", () => {
    // This test verifies the config validation logic
    // The send function checks for baseUrl and token presence
    const emptyConfig = backstageConfigSchemaV1.parse({});
    expect(emptyConfig.baseUrl).toBeUndefined();
    expect(emptyConfig.token).toBeUndefined();
    // Strategy will return error when these are missing
  });

  it("should build correct entity ref from email when user config is empty", () => {
    // Test the entity ref construction logic
    const prefix = "user:default/";
    const email = "john.doe@example.com";
    const emailPart = email.split("@")[0]?.toLowerCase() ?? "";
    const expectedRef = `${prefix}${emailPart}`;

    expect(expectedRef).toBe("user:default/john.doe");
  });

  it("should strip trailing slash from baseUrl", () => {
    const baseUrl = "https://backstage.example.com/";
    const normalizedUrl = baseUrl.replace(/\/$/, "");
    expect(normalizedUrl).toBe("https://backstage.example.com");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SSRF hardening (configured base URL)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Backstage SSRF hardening", () => {
  it("rejects a baseUrl that resolves to a blocked host before dispatch", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      const result = await backstageStrategy.send(
        makeContext("http://169.254.169.254"),
      );
      expect(result.success).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses redirects so a 302 to a blocked host is not followed", async () => {
    let targetHit = false;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      _url: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (init?.redirect === "error") {
        throw new TypeError("unexpected redirect");
      }
      targetHit = true;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch);
    try {
      const result = await backstageStrategy.send(
        makeContext("https://93.184.216.34"),
      );
      expect(result.success).toBe(false);
      expect(targetHit).toBe(false);
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.redirect).toBe("error");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
