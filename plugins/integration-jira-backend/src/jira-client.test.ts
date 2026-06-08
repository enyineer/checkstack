import { describe, expect, it, beforeEach } from "bun:test";

import { buildSearchJql, createJiraClient } from "./jira-client";
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

/**
 * Like `setupFetchMock` but cycles through a list of staged responses
 * so workflows that issue multiple Jira API calls (e.g.
 * `transitionIssue` = getTransitions + getIssueStatus + POST) can be
 * exercised end-to-end.
 */
interface StagedResponse {
  body?: unknown;
  status?: number;
  /** When true, return an empty body (used for 204 No Content). */
  empty?: boolean;
}

function setupFetchSequence(responses: StagedResponse[]) {
  const calls: CapturedFetchCall[] = [];
  const originalFetch = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses[i++] ?? { body: {}, status: 200 };
    if (next.empty) {
      return new Response(null, { status: next.status ?? 204 });
    }
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
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

  describe("getTransitions", () => {
    it("parses transition + destination status", async () => {
      fetchFixture = setupFetchMock({
        transitions: [
          { id: "11", name: "Start Progress", to: { id: "3", name: "In Progress" } },
          { id: "31", name: "Resolve Issue", to: { id: "10001", name: "Done" } },
        ],
      });
      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });
      const transitions = await client.getTransitions("PROJ-1");
      expect(transitions).toEqual([
        { id: "11", name: "Start Progress", to: { id: "3", name: "In Progress" } },
        { id: "31", name: "Resolve Issue", to: { id: "10001", name: "Done" } },
      ]);
      expect(fetchFixture.calls[0].url).toContain(
        "/rest/api/3/issue/PROJ-1/transitions",
      );
    });
  });

  describe("transitionIssue", () => {
    it("short-circuits when the issue is already in the target status", async () => {
      const seq = setupFetchSequence([
        {
          body: {
            transitions: [
              { id: "31", name: "Resolve", to: { id: "10001", name: "Done" } },
            ],
          },
        },
        {
          body: {
            fields: {
              status: { id: "10001", name: "Done", statusCategory: { key: "done" } },
            },
          },
        },
      ]);
      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });
      const result = await client.transitionIssue("PROJ-1", "31");
      expect(result.alreadyApplied).toBe(true);
      // Only two reads, no POST
      expect(seq.calls).toHaveLength(2);
      seq.restore();
    });

    it("POSTs the transition + optional comment when not already applied", async () => {
      const seq = setupFetchSequence([
        {
          body: {
            transitions: [
              { id: "31", name: "Resolve", to: { id: "10001", name: "Done" } },
            ],
          },
        },
        {
          body: {
            fields: {
              status: { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
            },
          },
        },
        { empty: true, status: 204 },
      ]);
      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat",
        logger: testLogger,
      });
      const result = await client.transitionIssue(
        "PROJ-1",
        "31",
        "Resolved by automation",
      );
      expect(result.alreadyApplied).toBe(false);
      expect(seq.calls).toHaveLength(3);
      const transitionCall = seq.calls[2];
      const body = JSON.parse(transitionCall.init.body as string) as {
        transition: { id: string };
        update: { comment: Array<{ add: { body: string } }> };
      };
      expect(body.transition.id).toBe("31");
      // datacenter uses plain text for the comment body
      expect(body.update.comment[0].add.body).toBe("Resolved by automation");
      seq.restore();
    });

    it("throws when the transition id is not available on the issue", async () => {
      const seq = setupFetchSequence([
        {
          body: {
            transitions: [
              { id: "11", name: "Start", to: { id: "3", name: "In Progress" } },
            ],
          },
        },
        {
          body: {
            fields: {
              status: { id: "1", name: "Open" },
            },
          },
        },
      ]);
      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });
      await expect(client.transitionIssue("PROJ-1", "99")).rejects.toThrow(
        /not available/,
      );
      seq.restore();
    });
  });

  describe("addComment", () => {
    it("uses Atlassian Document Format for cloud", async () => {
      fetchFixture = setupFetchMock({ id: "5001" });
      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });
      const result = await client.addComment("PROJ-1", "Hello");
      expect(result.id).toBe("5001");
      const body = JSON.parse(fetchFixture.calls[0].init.body as string) as {
        body: unknown;
      };
      expect(body.body).toEqual({
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      });
    });

    it("uses plain text for datacenter", async () => {
      fetchFixture = setupFetchMock({ id: "5002" });
      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat",
        logger: testLogger,
      });
      await client.addComment("PROJ-1", "Hello");
      const body = JSON.parse(fetchFixture.calls[0].init.body as string) as {
        body: unknown;
      };
      expect(body.body).toBe("Hello");
    });
  });
});

describe("buildSearchJql", () => {
  it("ANDs the structured clauses", () => {
    const jql = buildSearchJql({
      projectKey: "PROJ",
      status: "Open",
      summaryContains: "database",
    });
    expect(jql).toBe(
      'project = "PROJ" AND status = "Open" AND summary ~ "database"',
    );
  });

  it("wraps raw JQL and ANDs it with structured clauses", () => {
    const jql = buildSearchJql({
      projectKey: "PROJ",
      jql: "labels = incident",
    });
    expect(jql).toBe('project = "PROJ" AND (labels = incident)');
  });

  it("escapes quotes and backslashes inside values", () => {
    const jql = buildSearchJql({ summaryContains: 'say "hi" \\o/' });
    expect(jql).toBe('summary ~ "say \\"hi\\" \\\\o/"');
  });

  it("returns an empty string when nothing is supplied", () => {
    expect(buildSearchJql({})).toBe("");
  });
});
