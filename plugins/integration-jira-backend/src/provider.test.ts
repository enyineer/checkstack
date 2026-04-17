import { describe, expect, it } from "bun:test";

import {
  JiraConnectionConfigSchema,
  JIRA_AUTH_MODES,
  createJiraProvider,
} from "./provider";

describe("JIRA_AUTH_MODES", () => {
  it("contains cloud and datacenter", () => {
    expect(JIRA_AUTH_MODES).toEqual(["cloud", "datacenter"]);
  });
});

describe("JiraConnectionConfigSchema", () => {
  describe("cloud mode", () => {
    it("accepts valid cloud config with email", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "my-api-token",
      });
      expect(result.success).toBe(true);
    });

    it("rejects cloud config without email", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        apiToken: "my-api-token",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const emailIssue = result.error.issues.find((i) =>
          i.path.includes("email"),
        );
        expect(emailIssue).toBeDefined();
      }
    });

    it("defaults authMode to cloud when not provided", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "my-api-token",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.authMode).toBe("cloud");
      }
    });

    it("rejects invalid email format in cloud mode", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "not-an-email",
        apiToken: "my-api-token",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("datacenter mode", () => {
    it("accepts valid datacenter config without email", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "my-personal-access-token",
      });
      expect(result.success).toBe(true);
    });

    it("accepts datacenter config with optional email", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        email: "user@example.com",
        apiToken: "my-personal-access-token",
      });
      expect(result.success).toBe(true);
    });

    it("accepts any valid URL for datacenter base URL", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "datacenter",
        baseUrl: "https://jira.internal.corp:8443",
        apiToken: "my-personal-access-token",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("validation", () => {
    it("rejects invalid authMode", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "invalid",
        baseUrl: "https://jira.example.com",
        email: "user@example.com",
        apiToken: "token",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing baseUrl", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "cloud",
        email: "user@example.com",
        apiToken: "token",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid baseUrl", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "cloud",
        baseUrl: "not-a-url",
        email: "user@example.com",
        apiToken: "token",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing apiToken", () => {
      const result = JiraConnectionConfigSchema.safeParse({
        authMode: "cloud",
        baseUrl: "https://jira.example.com",
        email: "user@example.com",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("connectionSchema migration v1 → v2", () => {
  const provider = createJiraProvider();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const connectionSchema = provider.connectionSchema!;

  it("migrates v1 config by adding authMode: cloud", async () => {
    const v1Record = {
      version: 1,
      data: {
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "old-token",
      },
    };

    const result = await connectionSchema.parse(v1Record);
    expect(result.authMode).toBe("cloud");
    expect(result.baseUrl).toBe("https://mycompany.atlassian.net");
    expect(result.email).toBe("user@example.com");
    expect(result.apiToken).toBe("old-token");
  });

  it("parses v2 config directly without migration", async () => {
    const v2Record = {
      version: 2,
      data: {
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat-token",
      },
    };

    const result = await connectionSchema.parse(v2Record);
    expect(result.authMode).toBe("datacenter");
    expect(result.baseUrl).toBe("https://jira.mycompany.com");
    expect(result.apiToken).toBe("pat-token");
  });

  it("reports needsMigration correctly", () => {
    expect(
      connectionSchema.needsMigration({ version: 1, data: {} }),
    ).toBe(true);
    expect(
      connectionSchema.needsMigration({ version: 2, data: {} }),
    ).toBe(false);
  });
});
