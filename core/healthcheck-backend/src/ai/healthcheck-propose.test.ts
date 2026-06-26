import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import {
  createHealthcheckProposeTool,
  extractCollectorScriptSource,
} from "./healthcheck-propose";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["healthcheck.healthcheck.manage"],
};

const httpStrategy = {
  id: "healthcheck-http.http",
  displayName: "HTTP",
  description: "HTTP probe",
  category: "network",
  configSchema: {
    type: "object",
    properties: { url: { type: "string" }, method: { type: "string" } },
    required: ["url"],
  },
};

const scriptCollector = {
  id: "script.inline",
  displayName: "Inline script",
  description: "Inline TS collector",
  configSchema: {
    type: "object",
    properties: { script: { type: "string" } },
    required: ["script"],
  },
  resultSchema: {},
  allowMultiple: true,
};

/** Default fake `validateConfiguration` that reports the draft as valid. */
const okValidate = () => mock(() => Promise.resolve({ valid: true, errors: [] }));

function fakeRpcClient({
  getStrategies,
  getCollectors,
  createConfiguration,
  createAndAssign,
  validateConfiguration,
}: {
  getStrategies: ReturnType<typeof mock>;
  getCollectors: ReturnType<typeof mock>;
  createConfiguration: ReturnType<typeof mock>;
  createAndAssign?: ReturnType<typeof mock>;
  validateConfiguration?: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({
      getStrategies,
      getCollectors,
      createConfiguration,
      createAndAssign: createAndAssign ?? mock(() => Promise.resolve({})),
      validateConfiguration: validateConfiguration ?? okValidate(),
    }),
  } as unknown as RpcClient;
}

const validInput = {
  name: "Probe foo status",
  strategyId: "healthcheck-http.http",
  config: { url: "https://foo.bar/status" },
  intervalSeconds: 60,
};

describe("extractCollectorScriptSource", () => {
  test("reads script or source string", () => {
    expect(extractCollectorScriptSource({ script: "code" })).toBe("code");
    expect(extractCollectorScriptSource({ source: "code2" })).toBe("code2");
    expect(extractCollectorScriptSource({ other: 1 })).toBeUndefined();
  });
});

describe("healthcheck.propose composite tool", () => {
  test("declares mutate effect + a SINGLE healthcheck manage rule", () => {
    const tool = createHealthcheckProposeTool();
    expect(tool.name).toBe("healthcheck.propose");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual([
      "healthcheck.healthcheck.manage",
    ]);
    // A single rule keeps the framework's AND-gate correct.
    expect(tool.requiredAccessRules).toHaveLength(1);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun deep-validates via validateConfiguration and NEVER creates", async () => {
    const validateConfiguration = okValidate();
    const getStrategies = mock(() => Promise.resolve([httpStrategy]));
    const getCollectors = mock(() => Promise.resolve([]));
    const createConfiguration = mock(() => Promise.resolve({}));
    const rpcClient = fakeRpcClient({
      getStrategies,
      getCollectors,
      createConfiguration,
      validateConfiguration,
    });
    const tool = createHealthcheckProposeTool();

    const preview = await tool.dryRun!({
      input: validInput,
      principal,
      rpcClient,
    });

    // Deep validation runs against the live registry path, not a hand-rolled
    // presence check.
    expect(validateConfiguration).toHaveBeenCalledTimes(1);
    // The AI never silently creates a health check: create is NOT called at propose.
    expect(createConfiguration).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Probe foo status");
    expect(preview.summary).toContain("HTTP");
    expect(preview.summary).toContain("60s");
    const payload = preview.payload as { name: string; yaml: string };
    expect(payload.name).toBe("Probe foo status");
    expect(payload.yaml).toContain("strategyId:");
  });

  test("dryRun describes a script collector on the confirm card", async () => {
    const getStrategies = mock(() => Promise.resolve([httpStrategy]));
    const getCollectors = mock(() => Promise.resolve([scriptCollector]));
    const rpcClient = fakeRpcClient({
      getStrategies,
      getCollectors,
      createConfiguration: mock(),
    });
    const tool = createHealthcheckProposeTool();

    const preview = await tool.dryRun!({
      input: {
        ...validInput,
        collectors: [
          {
            id: "c1",
            collectorId: "script.inline",
            config: { script: "export default defineHealthCheck(() => ({}))" },
          },
        ],
      },
      principal,
      rpcClient,
    });

    expect(getCollectors).toHaveBeenCalledTimes(1);
    expect(preview.summary).toContain("script collector");
    expect(preview.summary).toContain("1 collector");
  });

  test("dryRun surfaces an unknown-strategy error from validateConfiguration", async () => {
    const validateConfiguration = mock(() =>
      Promise.resolve({
        valid: false,
        errors: [
          {
            path: ["strategyId"],
            message: 'Unknown health-check strategy "nope.nope".',
          },
        ],
      }),
    );
    const rpcClient = fakeRpcClient({
      getStrategies: mock(() => Promise.resolve([httpStrategy])),
      getCollectors: mock(() => Promise.resolve([])),
      createConfiguration: mock(),
      validateConfiguration,
    });
    const tool = createHealthcheckProposeTool();

    await expect(
      tool.dryRun!({
        input: { ...validInput, strategyId: "nope.nope" },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  // The deep-vs-lightweight proof at the propose layer: `url` IS present
  // (the old presence check would pass), but it holds the WRONG TYPE. The deep
  // validateConfiguration path rejects it, so dryRun surfaces the error.
  test("dryRun surfaces a deep type error the old presence check would miss", async () => {
    const validateConfiguration = mock(() =>
      Promise.resolve({
        valid: false,
        errors: [{ path: ["config", "url"], message: "Expected string" }],
      }),
    );
    const rpcClient = fakeRpcClient({
      getStrategies: mock(() => Promise.resolve([httpStrategy])),
      getCollectors: mock(() => Promise.resolve([])),
      createConfiguration: mock(),
      validateConfiguration,
    });
    const tool = createHealthcheckProposeTool();

    await expect(
      tool.dryRun!({
        // `url` present but a number, not a string.
        input: { ...validInput, config: { url: 12345 } },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/invalid/i);
    expect(validateConfiguration).toHaveBeenCalledTimes(1);
  });

  test("dryRun surfaces an unknown-collector error from validateConfiguration", async () => {
    const validateConfiguration = mock(() =>
      Promise.resolve({
        valid: false,
        errors: [
          {
            path: ["collectors", 0, "collectorId"],
            message: 'Unknown collector "does.not-exist".',
          },
        ],
      }),
    );
    const rpcClient = fakeRpcClient({
      getStrategies: mock(() => Promise.resolve([httpStrategy])),
      getCollectors: mock(() => Promise.resolve([scriptCollector])),
      createConfiguration: mock(),
      validateConfiguration,
    });
    const tool = createHealthcheckProposeTool();

    await expect(
      tool.dryRun!({
        input: {
          ...validInput,
          collectors: [
            { id: "c1", collectorId: "does.not-exist", config: {} },
          ],
        },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  test("execute (apply) creates the configuration via createConfiguration", async () => {
    const created = {
      id: "hc1",
      name: "Probe foo status",
      strategyId: "healthcheck-http.http",
      config: { url: "https://foo.bar/status" },
      intervalSeconds: 60,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const createConfiguration = mock(() => Promise.resolve(created));
    const rpcClient = fakeRpcClient({
      getStrategies: mock(() => Promise.resolve([httpStrategy])),
      getCollectors: mock(() => Promise.resolve([])),
      createConfiguration,
    });
    const tool = createHealthcheckProposeTool();

    const result = await tool.execute({ input: validInput, principal, rpcClient });
    expect(createConfiguration).toHaveBeenCalledTimes(1);
    expect(result.configuration.id).toBe("hc1");
  });

  test("description steers the model to HTTP, not script", () => {
    const tool = createHealthcheckProposeTool();
    // The model picked a script for a plain URL; the description must now make
    // HTTP the default and call out the assign-in-one-step flow.
    expect(tool.description).toContain("PREFER THE HTTP STRATEGY");
    expect(tool.description).toContain("healthcheck-http.request");
    expect(tool.description).toContain("assignToSystemId");
  });

  test("dryRun without a target system warns the check will not run yet", async () => {
    const rpcClient = fakeRpcClient({
      getStrategies: mock(() => Promise.resolve([httpStrategy])),
      getCollectors: mock(() => Promise.resolve([])),
      createConfiguration: mock(),
    });
    const tool = createHealthcheckProposeTool();

    const preview = await tool.dryRun!({ input: validInput, principal, rpcClient });
    expect(preview.summary).toContain("NOT assigned");
  });

  test("dryRun with a target system says it will assign + start the check", async () => {
    const rpcClient = fakeRpcClient({
      getStrategies: mock(() => Promise.resolve([httpStrategy])),
      getCollectors: mock(() => Promise.resolve([])),
      createConfiguration: mock(),
    });
    const tool = createHealthcheckProposeTool();

    const preview = await tool.dryRun!({
      input: { ...validInput, assignToSystemId: "sys1" },
      principal,
      rpcClient,
    });
    expect(preview.summary).toMatch(/assign/i);
    expect(preview.summary).not.toContain("NOT assigned");
  });

  test("execute (apply) with assignToSystemId atomically creates AND assigns", async () => {
    const created = {
      id: "hc2",
      name: "Probe foo status",
      strategyId: "healthcheck-http.http",
      config: { url: "https://foo.bar/status" },
      intervalSeconds: 60,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let captured: {
      systemId?: string;
      configuration?: { name?: string; strategyId?: string };
    } = {};
    const createAndAssign = mock(
      (arg: {
        systemId: string;
        configuration: { name: string; strategyId: string };
      }) => {
        captured = arg;
        return Promise.resolve(created);
      },
    );
    const createConfiguration = mock(() => Promise.resolve(created));
    const rpcClient = fakeRpcClient({
      getStrategies: mock(() => Promise.resolve([httpStrategy])),
      getCollectors: mock(() => Promise.resolve([])),
      createConfiguration,
      createAndAssign,
    });
    const tool = createHealthcheckProposeTool();

    const result = await tool.execute({
      input: { ...validInput, assignToSystemId: "sys1" },
      principal,
      rpcClient,
    });

    // The atomic create+assign path is used; the create-only path is NOT.
    expect(createAndAssign).toHaveBeenCalledTimes(1);
    expect(createConfiguration).not.toHaveBeenCalled();
    expect(captured.systemId).toBe("sys1");
    expect(captured.configuration?.name).toBe("Probe foo status");
    expect(captured.configuration?.strategyId).toBe("healthcheck-http.http");
    expect(result.configuration.id).toBe("hc2");
  });
});
