import { describe, expect, it, afterEach } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import { createJiraProvider, JIRA_RESOLVERS } from "./provider";

/** A logger that records what was emitted per level, for assertions. */
function recordingLogger() {
  const logs = { debug: [] as string[], info: [] as string[], warn: [] as string[], error: [] as string[] };
  const logger: Logger = {
    debug: (m: string) => logs.debug.push(m),
    info: (m: string) => logs.info.push(m),
    warn: (m: string) => logs.warn.push(m),
    error: (m: string) => logs.error.push(m),
  };
  return { logger, logs };
}

/** Stub global fetch with a single staged response. */
function stubFetch(body: unknown, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    _init?: RequestInit,
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const connectionWithCredentials = async () => ({
  id: "conn-1",
  config: {
    authMode: "datacenter" as const,
    baseUrl: "https://jira.mycompany.com",
    apiToken: "pat",
  },
});

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

describe("jiraProvider.getConnectionOptions — loud failures", () => {
  it("rethrows (does not swallow) when the Jira API errors, logging context", async () => {
    restoreFetch = stubFetch({ errorMessages: ["boom"] }, 500);
    const { logger, logs } = recordingLogger();
    const provider = createJiraProvider();

    const promise = provider.getConnectionOptions!({
      connectionId: "conn-1",
      resolverName: JIRA_RESOLVERS.FIELD_OPTIONS,
      context: { projectKey: "PROJ", issueTypeId: "10001" },
      getConnectionWithCredentials: connectionWithCredentials,
      logger,
    });

    await expect(promise).rejects.toThrow();
    expect(logs.error.some((m) => m.includes("fieldOptions"))).toBe(true);
    expect(logs.error.some((m) => m.includes("conn-1"))).toBe(true);
  });

  it("warns when deps are present but no selectable fields come back", async () => {
    // Legacy createmeta with an issue type that only exposes excluded fields.
    restoreFetch = stubFetch({
      projects: [
        {
          issuetypes: [
            { id: "10001", fields: { summary: { required: true, name: "Summary" } } },
          ],
        },
      ],
    });
    const { logger, logs } = recordingLogger();
    const provider = createJiraProvider();

    const options = await provider.getConnectionOptions!({
      connectionId: "conn-1",
      resolverName: JIRA_RESOLVERS.FIELD_OPTIONS,
      context: { projectKey: "PROJ", issueTypeId: "10001" },
      getConnectionWithCredentials: connectionWithCredentials,
      logger,
    });

    expect(options).toEqual([]);
    expect(logs.warn.some((m) => m.includes("0 selectable fields"))).toBe(true);
  });

  it("stays quiet (debug) when a dependency is not selected yet", async () => {
    const { logger, logs } = recordingLogger();
    const provider = createJiraProvider();

    const options = await provider.getConnectionOptions!({
      connectionId: "conn-1",
      resolverName: JIRA_RESOLVERS.FIELD_OPTIONS,
      context: { projectKey: "PROJ" }, // issueTypeId missing
      getConnectionWithCredentials: connectionWithCredentials,
      logger,
    });

    expect(options).toEqual([]);
    expect(logs.warn).toHaveLength(0);
    expect(logs.error).toHaveLength(0);
    expect(logs.debug.some((m) => m.includes("issueTypeId"))).toBe(true);
  });

  it("throws on an unknown resolver name", async () => {
    const { logger } = recordingLogger();
    const provider = createJiraProvider();
    await expect(
      provider.getConnectionOptions!({
        connectionId: "conn-1",
        resolverName: "bogusResolver",
        context: {},
        getConnectionWithCredentials: connectionWithCredentials,
        logger,
      }),
    ).rejects.toThrow(/unknown jira options resolver/i);
  });
});
