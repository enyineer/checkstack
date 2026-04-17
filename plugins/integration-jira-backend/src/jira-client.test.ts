import { describe, expect, it, beforeEach } from "bun:test";

import { createJiraClient } from "./jira-client";
import type { Logger } from "@checkstack/backend-api";

/** Minimal no-op logger for tests */
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Captured fetch call args */
interface CapturedFetchCall {
  url: string;
  init: RequestInit;
}

/**
 * Helper to intercept fetch calls and capture the request details.
 * Returns the captured calls array after the client method is invoked.
 */
function setupFetchMock(responseBody: unknown = {}, status = 200) {
  const calls: CapturedFetchCall[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

let fetchFixture: ReturnType<typeof setupFetchMock>;

beforeEach(() => {
  fetchFixture?.restore();
});

describe("createJiraClient", () => {
  describe("authentication headers", () => {
    it("uses Basic auth header for cloud mode", async () => {
      fetchFixture = setupFetchMock({ accountId: "test-user" });

      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "cloud-api-token",
        logger: testLogger,
      });

      await client.testConnection();

      const headers = fetchFixture.calls[0].init.headers as Record<
        string,
        string
      >;
      const expectedAuth = `Basic ${Buffer.from("user@example.com:cloud-api-token").toString("base64")}`;
      expect(headers.Authorization).toBe(expectedAuth);
    });

    it("uses Bearer auth header for datacenter mode", async () => {
      fetchFixture = setupFetchMock({ name: "test-user" });

      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "my-personal-access-token",
        logger: testLogger,
      });

      await client.testConnection();

      const headers = fetchFixture.calls[0].init.headers as Record<
        string,
        string
      >;
      expect(headers.Authorization).toBe("Bearer my-personal-access-token");
    });

    it("defaults to cloud mode (Basic auth) when authMode is not specified", async () => {
      fetchFixture = setupFetchMock({ accountId: "test-user" });

      const client = createJiraClient({
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });

      await client.testConnection();

      const headers = fetchFixture.calls[0].init.headers as Record<
        string,
        string
      >;
      expect(headers.Authorization).toStartWith("Basic ");
    });
  });

  describe("API version routing", () => {
    it("uses /rest/api/3 for cloud mode", async () => {
      fetchFixture = setupFetchMock({ accountId: "test-user" });

      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });

      await client.testConnection();

      expect(fetchFixture.calls[0].url).toBe(
        "https://mycompany.atlassian.net/rest/api/3/myself",
      );
    });

    it("uses /rest/api/2 for datacenter mode", async () => {
      fetchFixture = setupFetchMock({ name: "test-user" });

      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat-token",
        logger: testLogger,
      });

      await client.testConnection();

      expect(fetchFixture.calls[0].url).toBe(
        "https://jira.mycompany.com/rest/api/2/myself",
      );
    });

    it("strips trailing slash from base URL", async () => {
      fetchFixture = setupFetchMock({ accountId: "test-user" });

      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net/",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });

      await client.testConnection();

      expect(fetchFixture.calls[0].url).toBe(
        "https://mycompany.atlassian.net/rest/api/3/myself",
      );
    });
  });

  describe("createIssue description format", () => {
    it("uses Atlassian Document Format for cloud mode", async () => {
      fetchFixture = setupFetchMock({
        id: "10001",
        key: "PROJ-1",
        self: "https://mycompany.atlassian.net/rest/api/3/issue/10001",
      });

      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });

      await client.createIssue({
        projectKey: "PROJ",
        issueTypeId: "10001",
        summary: "Test issue",
        description: "This is a test description",
      });

      const body = JSON.parse(fetchFixture.calls[0].init.body as string) as {
        fields: { description: unknown };
      };

      // Cloud should use ADF
      expect(body.fields.description).toEqual({
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "This is a test description" }],
          },
        ],
      });
    });

    it("uses plain text for datacenter mode", async () => {
      fetchFixture = setupFetchMock({
        id: "10001",
        key: "PROJ-1",
        self: "https://jira.mycompany.com/rest/api/2/issue/10001",
      });

      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat-token",
        logger: testLogger,
      });

      await client.createIssue({
        projectKey: "PROJ",
        issueTypeId: "10001",
        summary: "Test issue",
        description: "This is a test description",
      });

      const body = JSON.parse(fetchFixture.calls[0].init.body as string) as {
        fields: { description: unknown };
      };

      // Data Center should use plain text
      expect(body.fields.description).toBe("This is a test description");
    });

    it("omits description when not provided", async () => {
      fetchFixture = setupFetchMock({
        id: "10001",
        key: "PROJ-1",
        self: "https://jira.mycompany.com/rest/api/2/issue/10001",
      });

      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat-token",
        logger: testLogger,
      });

      await client.createIssue({
        projectKey: "PROJ",
        issueTypeId: "10001",
        summary: "Test issue without description",
      });

      const body = JSON.parse(fetchFixture.calls[0].init.body as string) as {
        fields: Record<string, unknown>;
      };

      expect(body.fields.description).toBeUndefined();
    });
  });
});
