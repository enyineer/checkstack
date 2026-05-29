/**
 * Behaviour tests for the Jira automation actions.
 *
 * The ConnectionStore is faked; fetch is stubbed in-process so we can
 * exercise the full action.execute flow including upstream artifact
 * resolution + the success/error mapping.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  createJiraActions,
  jiraIssueArtifactType,
} from "./automations";
import {
  connectionStoreRef,
  type ConnectionStore,
} from "@checkstack/integration-backend";
import type { ServiceRef } from "@checkstack/backend-api";

const logger = createMockLogger() as Logger;

interface CapturedFetchCall {
  url: string;
  init: RequestInit;
}

interface StagedResponse {
  body?: unknown;
  status?: number;
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

/**
 * Tiny ConnectionStore stub backed by a single canned connection so the
 * action factory doesn't reach into the real DB.
 */
function makeConnectionStore(): ConnectionStore {
  return {
    listConnections: mock(async () => []),
    getConnection: mock(async () => undefined),
    getConnectionWithCredentials: mock(async (id: string) =>
      id === "conn-1"
        ? {
            id: "conn-1",
            providerId: "jira",
            name: "Cloud",
            config: {
              authMode: "cloud",
              baseUrl: "https://mycompany.atlassian.net",
              email: "user@example.com",
              apiToken: "token",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : undefined,
    ),
    createConnection: mock(async () => {
      throw new Error("not implemented in stub");
    }),
    updateConnection: mock(async () => {
      throw new Error("not implemented in stub");
    }),
    deleteConnection: mock(async () => false),
    findConnectionProvider: mock(async () => undefined),
  } as unknown as ConnectionStore;
}

let fetchFixture: ReturnType<typeof setupFetchSequence> | undefined;

beforeEach(() => {
  fetchFixture?.restore();
  fetchFixture = undefined;
});

/**
 * Build a base execution context whose `getService(connectionStoreRef)`
 * returns the supplied store. Lets each test compose its own fake
 * store while the action keeps using the standard `getService` API at
 * execute time.
 */
function makeCtx(store: ConnectionStore) {
  return {
    runId: "run-1",
    automationId: "auto-1",
    contextKey: null,
    logger,
    getService: async <T,>(ref: ServiceRef<T>): Promise<T> => {
      if (ref.id === connectionStoreRef.id) {
        return store as unknown as T;
      }
      throw new Error(`Unstubbed service requested: ${ref.id}`);
    },
  };
}

const ctxBase = makeCtx(makeConnectionStore());

describe("jiraIssueArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = jiraIssueArtifactType.schema.safeParse({
      issueKey: "PROJ-1",
      projectKey: "PROJ",
      issueUrl: "https://mycompany.atlassian.net/browse/PROJ-1",
      id: "10001",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a non-URL issueUrl", () => {
    const bad = jiraIssueArtifactType.schema.safeParse({
      issueKey: "PROJ-1",
      projectKey: "PROJ",
      issueUrl: "not-a-url",
      id: "10001",
    });
    expect(bad.success).toBe(false);
  });
});

describe("jira automation actions", () => {
  describe("jira.create_issue", () => {
    it("creates an issue and emits a jira.issue artifact", async () => {
      fetchFixture = setupFetchSequence([
        {
          body: {
            id: "10001",
            key: "PROJ-1",
            self: "https://mycompany.atlassian.net/rest/api/3/issue/10001",
          },
        },
      ]);
      const actions = createJiraActions();
      const create = actions[0];
      const result = await create.execute({
        ...ctxBase,
        consumedArtifacts: {},
        config: {
          connectionId: "conn-1",
          projectKey: "PROJ",
          issueTypeId: "10001",
          summary: "Auto-filed issue",
        } as never,
      });
      expect(result.success).toBe(true);
      expect((result.artifact as { issueKey: string }).issueKey).toBe("PROJ-1");
      expect((result.artifact as { issueUrl: string }).issueUrl).toBe(
        "https://mycompany.atlassian.net/browse/PROJ-1",
      );
    });

    it("returns failure when the connection is missing", async () => {
      const actions = createJiraActions();
      const create = actions[0];
      const result = await create.execute({
        ...ctxBase,
        consumedArtifacts: {},
        config: {
          connectionId: "missing",
          projectKey: "PROJ",
          issueTypeId: "10001",
          summary: "x",
        } as never,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/connection not found/i);
    });
  });

  describe("jira.transition_issue", () => {
    it("resolves the issueKey from the upstream jira.issue artifact", async () => {
      // getTransitions, getIssueStatus (current), POST, getIssueStatus (post-transition)
      fetchFixture = setupFetchSequence([
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
              status: { id: "3", name: "In Progress" },
            },
          },
        },
        { empty: true, status: 204 },
        {
          body: {
            fields: {
              status: { id: "10001", name: "Done", statusCategory: { key: "done" } },
            },
          },
        },
      ]);
      const actions = createJiraActions();
      const transition = actions[1];
      const result = await transition.execute({
        ...ctxBase,
        consumedArtifacts: {
          // Keyed by the local consume id (`issue`), as the engine keys it.
          issue: {
            issueKey: "PROJ-1",
            projectKey: "PROJ",
            issueUrl: "https://mycompany.atlassian.net/browse/PROJ-1",
            id: "10001",
          },
        },
        config: {
          connectionId: "conn-1",
          transitionId: "31",
        } as never,
      });
      expect(result.success).toBe(true);
      expect((result.artifact as { issueKey: string }).issueKey).toBe("PROJ-1");
      expect((result.artifact as { status?: string }).status).toBe("Done");
    });

    it("returns failure when neither config.issueKey nor upstream artifact is present", async () => {
      const actions = createJiraActions();
      const transition = actions[1];
      const result = await transition.execute({
        ...ctxBase,
        consumedArtifacts: {},
        config: {
          connectionId: "conn-1",
          transitionId: "31",
        } as never,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/issueKey/i);
    });
  });

  describe("jira.add_comment", () => {
    it("posts the comment and returns its id", async () => {
      fetchFixture = setupFetchSequence([{ body: { id: "5001" } }]);
      const actions = createJiraActions();
      const comment = actions[2];
      const result = await comment.execute({
        ...ctxBase,
        consumedArtifacts: {
          // Keyed by the local consume id (`issue`), as the engine keys it.
          issue: {
            issueKey: "PROJ-1",
            projectKey: "PROJ",
            issueUrl: "https://mycompany.atlassian.net/browse/PROJ-1",
            id: "10001",
          },
        },
        config: { connectionId: "conn-1", body: "Resolved" } as never,
      });
      expect(result.success).toBe(true);
      expect((result.artifact as { commentId: string }).commentId).toBe("5001");
    });
  });
});
