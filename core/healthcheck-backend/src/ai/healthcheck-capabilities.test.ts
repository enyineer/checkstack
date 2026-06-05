import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import {
  ListCapabilitiesOutputSchema,
  GetCapabilitySchemaOutputSchema,
} from "@checkstack/ai-common";
import {
  createHealthcheckListCapabilitiesTool,
  createHealthcheckGetCapabilitySchemaTool,
} from "./healthcheck-capabilities";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["healthcheck.healthcheck.read"],
};

/** A real-shaped collector config schema; the round-trip must preserve it byte-for-byte. */
const HTTP_COLLECTOR_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", format: "uri", description: "Endpoint to probe" },
    method: { type: "string", enum: ["GET", "HEAD", "POST"], default: "GET" },
    timeoutMs: { type: "integer", minimum: 100, maximum: 30000 },
    expectedStatus: {
      type: "array",
      items: { type: "integer" },
      default: [200],
    },
  },
  required: ["url"],
  additionalProperties: false,
};

const HTTP_STRATEGY = {
  id: "healthcheck-http",
  displayName: "HTTP",
  description: "Probe HTTP endpoints",
  category: "network",
  configSchema: { type: "object", properties: {} },
};

const HTTP_RESULT_SCHEMA = {
  type: "object",
  properties: { statusCode: { type: "number" }, body: { type: "string" } },
};

const HTTP_COLLECTOR = {
  id: "healthcheck-http.http",
  displayName: "HTTP request",
  description: "Issue an HTTP request and assert on the response",
  configSchema: HTTP_COLLECTOR_SCHEMA,
  resultSchema: HTTP_RESULT_SCHEMA,
  allowMultiple: true,
};

function fakeHealthcheckRpcClient(): RpcClient {
  return {
    forPlugin: () => ({
      getStrategies: mock(() => Promise.resolve([HTTP_STRATEGY])),
      getCollectors: mock(() => Promise.resolve([HTTP_COLLECTOR])),
    }),
  } as unknown as RpcClient;
}

describe("healthcheck.listCapabilities tool", () => {
  test("declares read effect + healthcheck config read gate, no dryRun", () => {
    const tool = createHealthcheckListCapabilitiesTool();
    expect(tool.name).toBe("healthcheck.listCapabilities");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["healthcheck.healthcheck.read"]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("maps strategies + collectors to roles with compact summaries", async () => {
    const tool = createHealthcheckListCapabilitiesTool();
    const out = await tool.execute({
      input: {},
      principal,
      rpcClient: fakeHealthcheckRpcClient(),
    });
    expect(ListCapabilitiesOutputSchema.safeParse(out).success).toBe(true);
    expect(out.context).toBe("healthcheck");
    expect(out.truncated).toBe(false);

    const strategy = out.entries.find((e) => e.id === "healthcheck-http");
    const collector = out.entries.find((e) => e.id === "healthcheck-http.http");
    expect(strategy?.role).toBe("strategy");
    expect(collector?.role).toBe("collector");
    // Compact summary only - never the full schema.
    expect(collector?.configSummary).toEqual([
      { name: "url", type: "string", required: true },
      { name: "method", type: "enum", required: false },
      { name: "timeoutMs", type: "number", required: false },
      { name: "expectedStatus", type: "array", required: false },
    ]);
    expect(
      (collector as unknown as Record<string, unknown>).configSchema,
    ).toBeUndefined();
    expect(
      (collector as unknown as Record<string, unknown>).resultSchema,
    ).toBeUndefined();
  });
});

describe("healthcheck.getCapabilitySchema tool", () => {
  test("declares read effect + healthcheck config read gate, no dryRun", () => {
    const tool = createHealthcheckGetCapabilitySchemaTool();
    expect(tool.name).toBe("healthcheck.getCapabilitySchema");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["healthcheck.healthcheck.read"]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("returns ONE collector's FULL config schema + result schema + operators", async () => {
    const tool = createHealthcheckGetCapabilitySchemaTool();
    const out = await tool.execute({
      input: { kind: "healthcheck-http.http" },
      principal,
      rpcClient: fakeHealthcheckRpcClient(),
    });
    expect(GetCapabilitySchemaOutputSchema.safeParse(out).success).toBe(true);
    expect(out.context).toBe("healthcheck");
    expect(out.id).toBe("healthcheck-http.http");
    expect(out.role).toBe("collector");
    // The crux: the FULL schema is returned unchanged - same object the UI form uses.
    expect(out.configSchema).toEqual(HTTP_COLLECTOR_SCHEMA);
    // A collector ALSO exposes the assertable result fields + operator vocabulary
    // so the model authors assertions correctly instead of guessing field/operator.
    expect(out.resultSchema).toEqual(HTTP_RESULT_SCHEMA);
    expect(out.assertionOperators?.number).toContain("equals");
    expect(out.assertionOperators?.number).toContain("greaterThanOrEqual");
    expect(out.assertionOperators?.string).toContain("contains");
  });

  test("a non-collector kind (strategy) omits resultSchema + assertionOperators", async () => {
    const tool = createHealthcheckGetCapabilitySchemaTool();
    const out = await tool.execute({
      input: { kind: "healthcheck-http" },
      principal,
      rpcClient: fakeHealthcheckRpcClient(),
    });
    expect(out.role).toBe("strategy");
    expect(out.resultSchema).toBeUndefined();
    expect(out.assertionOperators).toBeUndefined();
  });

  test("throws a clear error for an unknown kind", async () => {
    const tool = createHealthcheckGetCapabilitySchemaTool();
    await expect(
      tool.execute({
        input: { kind: "does-not-exist" },
        principal,
        rpcClient: fakeHealthcheckRpcClient(),
      }),
    ).rejects.toThrow(/unknown.*does-not-exist/i);
  });
});
