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

  describe("searchIssues endpoint (Cloud removed legacy /search; CHANGE-2046)", () => {
    it("uses /rest/api/3/search/jql for cloud mode", async () => {
      fetchFixture = setupFetchMock({ issues: [{ key: "SCRUM-1", fields: {} }] });

      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "user@example.com",
        apiToken: "token",
        logger: testLogger,
      });

      const result = await client.searchIssues({ jql: "project = SCRUM" });

      expect(fetchFixture.calls[0].url).toBe(
        "https://mycompany.atlassian.net/rest/api/3/search/jql",
      );
      // The new endpoint returns no `total`; existence is derived from issues.
      expect(result.found).toBe(true);
      expect(result.count).toBe(1);
    });

    it("keeps the legacy /rest/api/2/search for datacenter (on-prem) mode", async () => {
      fetchFixture = setupFetchMock({ total: 2, issues: [{ key: "OPS-1", fields: {} }] });

      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat-token",
        logger: testLogger,
      });

      const result = await client.searchIssues({ jql: "project = OPS" });

      expect(fetchFixture.calls[0].url).toBe(
        "https://jira.mycompany.com/rest/api/2/search",
      );
      // Data Center still reports `total`.
      expect(result.count).toBe(2);
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

  describe("getFields (createmeta endpoint differs by deployment)", () => {
    it("uses the granular createmeta endpoint and field array on cloud", async () => {
      fetchFixture = setupFetchMock({
        startAt: 0,
        maxResults: 50,
        total: 2,
        fields: [
          {
            fieldId: "labels",
            name: "Labels",
            required: false,
            schema: { type: "array", items: "string", system: "labels" },
          },
          {
            fieldId: "customfield_10010",
            name: "Story Points",
            required: true,
            schema: { type: "number", customId: 10010 },
          },
        ],
      });
      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "u@e.com",
        apiToken: "token",
        logger: testLogger,
      });
      const fields = await client.getFields("PROJ", "10001");
      expect(fetchFixture.calls[0].url).toBe(
        "https://mycompany.atlassian.net/rest/api/3/issue/createmeta/PROJ/issuetypes/10001",
      );
      expect(fields.map((f) => f.key)).toEqual(["labels", "customfield_10010"]);
      expect(fields[0]?.name).toBe("Labels");
    });

    it("tolerates the paginated `values` key on the granular endpoint", async () => {
      fetchFixture = setupFetchMock({
        maxResults: 50,
        startAt: 0,
        total: 1,
        isLast: true,
        values: [
          {
            fieldId: "labels",
            name: "Labels",
            required: false,
            schema: { type: "array", items: "string", system: "labels" },
          },
        ],
      });
      const client = createJiraClient({
        authMode: "cloud",
        baseUrl: "https://mycompany.atlassian.net",
        email: "u@e.com",
        apiToken: "token",
        logger: testLogger,
      });
      const fields = await client.getFields("PROJ", "10001");
      expect(fields.map((f) => f.key)).toEqual(["labels"]);
    });

    it("uses the LEGACY createmeta endpoint and object-map fields on datacenter", async () => {
      // Older on-prem Jira lacks the granular endpoint and returns fields as an
      // object keyed by field id under projects[].issuetypes[].fields.
      fetchFixture = setupFetchMock({
        projects: [
          {
            id: "1",
            key: "PROJ",
            issuetypes: [
              {
                id: "10001",
                name: "Bug",
                fields: {
                  labels: {
                    required: false,
                    name: "Labels",
                    fieldId: "labels",
                    schema: { type: "array", items: "string", system: "labels" },
                  },
                  // No `fieldId` on this entry — the map key is the field id.
                  customfield_10010: {
                    required: true,
                    name: "Story Points",
                    schema: { type: "number", customId: 10010 },
                  },
                },
              },
            ],
          },
        ],
      });
      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat",
        logger: testLogger,
      });
      const fields = await client.getFields("PROJ", "10001");
      expect(fetchFixture.calls[0].url).toBe(
        "https://jira.mycompany.com/rest/api/2/issue/createmeta?projectKeys=PROJ&issuetypeIds=10001&expand=projects.issuetypes.fields",
      );
      // Both fields surface, with the map key used as the field key fallback.
      expect(fields.map((f) => f.key)).toEqual(["labels", "customfield_10010"]);
      const labels = fields.find((f) => f.key === "labels");
      expect(labels?.schema?.items).toBe("string");
    });

    it("matches the requested issue type when several are returned (datacenter)", async () => {
      fetchFixture = setupFetchMock({
        projects: [
          {
            issuetypes: [
              { id: "10001", fields: { summary: { required: true, name: "Summary" } } },
              { id: "10002", fields: { labels: { required: false, name: "Labels" } } },
            ],
          },
        ],
      });
      const client = createJiraClient({
        authMode: "datacenter",
        baseUrl: "https://jira.mycompany.com",
        apiToken: "pat",
        logger: testLogger,
      });
      const fields = await client.getFields("PROJ", "10002");
      expect(fields.map((f) => f.key)).toEqual(["labels"]);
    });
  });
});

describe("buildSearchJql", () => {
  it("ANDs the structured clauses (and appends a deterministic order)", () => {
    const jql = buildSearchJql({
      projectKey: "PROJ",
      status: "Open",
      summaryContains: "database",
    });
    expect(jql).toBe(
      'project = "PROJ" AND status = "Open" AND summary ~ "database" ORDER BY created DESC',
    );
  });

  it("wraps raw JQL and ANDs it with structured clauses", () => {
    const jql = buildSearchJql({
      projectKey: "PROJ",
      jql: "labels = incident",
    });
    expect(jql).toBe(
      'project = "PROJ" AND (labels = incident) ORDER BY created DESC',
    );
  });

  it("escapes quotes and backslashes inside values", () => {
    const jql = buildSearchJql({ summaryContains: 'say "hi" \\o/' });
    expect(jql).toBe('summary ~ "say \\"hi\\" \\\\o/" ORDER BY created DESC');
  });

  it("returns an empty string when nothing is supplied (no ORDER BY)", () => {
    expect(buildSearchJql({})).toBe("");
  });

  it("emits one ANDed equality clause per label so all labels must match", () => {
    const jql = buildSearchJql({
      projectKey: "PROJ",
      labels: "checkstack-sys-abc, urgent",
    });
    expect(jql).toBe(
      'project = "PROJ" AND labels = "checkstack-sys-abc" AND labels = "urgent" ORDER BY created DESC',
    );
  });

  it("splits labels on whitespace as well as commas", () => {
    expect(buildSearchJql({ labels: "a  b\tc" })).toBe(
      'labels = "a" AND labels = "b" AND labels = "c" ORDER BY created DESC',
    );
  });

  it("compiles a statusCategory clause", () => {
    expect(buildSearchJql({ statusCategory: "indeterminate" })).toBe(
      'statusCategory = "indeterminate" ORDER BY created DESC',
    );
  });

  it("does not append a second ORDER BY when the raw JQL already has one", () => {
    const jql = buildSearchJql({
      projectKey: "PROJ",
      jql: "status = Open ORDER BY updated ASC",
    });
    expect(jql).toBe('project = "PROJ" AND (status = Open ORDER BY updated ASC)');
  });
});
