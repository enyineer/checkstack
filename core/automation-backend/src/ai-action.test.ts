import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { coreServices, type Logger, type RpcClient } from "@checkstack/backend-api";
import { aiAgentRunnerRef, type AgentTaskInput } from "@checkstack/ai-backend";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  aiAnalyzeAction,
  buildAgentPrompt,
  buildOutputSchema,
} from "./ai-action";

const logger = createMockLogger() as Logger;

// ─── buildOutputSchema ──────────────────────────────────────────────────

describe("buildOutputSchema", () => {
  it("maps each field type and applies descriptions", () => {
    const schema = buildOutputSchema([
      { key: "summary", type: "string", description: "a summary" },
      { key: "count", type: "number", description: "a count" },
      { key: "urgent", type: "boolean", description: "is urgent" },
      {
        key: "severity",
        type: "enum",
        description: "severity",
        options: ["low", "high"],
      },
    ]);
    const ok = schema.safeParse({
      summary: "x",
      count: 2,
      urgent: true,
      severity: "high",
    });
    expect(ok.success).toBe(true);
    const badEnum = schema.safeParse({
      summary: "x",
      count: 2,
      urgent: true,
      severity: "nope",
    });
    expect(badEnum.success).toBe(false);
  });

  it("degrades an enum with no options to a free string (never throws)", () => {
    const schema = buildOutputSchema([
      { key: "k", type: "enum", description: "d" },
    ]);
    expect(schema.safeParse({ k: "anything" }).success).toBe(true);
  });
});

// ─── buildAgentPrompt ──────────────────────────────────────────────────

describe("buildAgentPrompt", () => {
  it("appends the run context (trigger + artifacts + vars)", () => {
    const prompt = buildAgentPrompt("Analyze the failure", {
      trigger: {
        id: "t1",
        event: "healthcheck.system_degraded",
        actor: { type: "system", id: "system" },
        payload: { systemId: "sys-1", newStatus: "unhealthy" },
      },
      artifacts: {},
      vars: {},
    });
    expect(prompt).toContain("Analyze the failure");
    expect(prompt).toContain("sys-1");
    expect(prompt).toContain("Automation context");
  });
});

// ─── aiAnalyzeAction.execute ────────────────────────────────────────────

const baseCtx = {
  runId: "run-1",
  automationId: "auto-1",
  contextKey: null,
  consumedArtifacts: {},
  logger,
  rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
  scope: undefined,
};

const baseConfig = {
  connectionId: "conn-1",
  prompt: "Analyze and act",
  outputFields: [],
};

/** A getService that returns a fake auth client + a spy runner. */
function makeGetService(opts: {
  enriched: { id: string; name: string; roles: string[]; accessRules: string[]; teamIds: string[] } | null;
  runner: (input: AgentTaskInput) => Promise<{ text: string; object?: unknown; toolCalls: { tool: string; ok: boolean }[] }>;
}) {
  const enrichMock = mock(async () => opts.enriched);
  const getService = (async <T>(ref: { id: string }): Promise<T> => {
    if (ref.id === coreServices.rpcClient.id) {
      return {
        forPlugin: () => ({ enrichApplicationPrincipal: enrichMock }),
      } as unknown as T;
    }
    if (ref.id === aiAgentRunnerRef.id) {
      return opts.runner as unknown as T;
    }
    throw new Error(`unexpected service ref ${ref.id}`);
  }) as <T>(ref: { id: string; T: T; toString(): string }) => Promise<T>;
  return { getService, enrichMock };
}

describe("aiAnalyzeAction", () => {
  it("is an AI-category action that produces the analysis artifact", () => {
    expect(aiAnalyzeAction.id).toBe("ai_analyze");
    expect(aiAnalyzeAction.produces).toBe("automation.analysis");
  });

  it("fails clearly when the automation has no service account", async () => {
    const { getService } = makeGetService({
      enriched: { id: "a", name: "A", roles: [], accessRules: [], teamIds: [] },
      runner: async () => ({ text: "", toolCalls: [] }),
    });
    const result = await aiAnalyzeAction.execute({
      ...baseCtx,
      getService,
      runAs: null,
      config: baseConfig as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/service account|runAs/i);
  });

  it("runs the agent as the enriched runAs principal and returns the artifact", async () => {
    let received: AgentTaskInput | undefined;
    const runner = mock(async (input: AgentTaskInput) => {
      received = input;
      return {
        text: "Root cause: bad deploy.",
        object: { severity: "high" },
        toolCalls: [{ tool: "incident.create", ok: true }],
      };
    });
    const { getService } = makeGetService({
      enriched: {
        id: "svc-1",
        name: "Incident Bot",
        roles: ["incident-responder"],
        accessRules: ["incident.incident.manage"],
        teamIds: ["team-9"],
      },
      runner,
    });

    const result = await aiAnalyzeAction.execute({
      ...baseCtx,
      getService,
      runAs: "svc-1",
      config: {
        connectionId: "conn-1",
        prompt: "Analyze the failure and open an incident",
        outputFields: [
          { key: "severity", type: "enum", description: "sev", options: ["low", "high"] },
        ],
      } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.artifact as {
      summary: string;
      data: unknown;
      toolCalls: { tool: string; ok: boolean }[];
    };
    expect(artifact.summary).toContain("Root cause");
    expect(artifact.data).toEqual({ severity: "high" });
    expect(artifact.toolCalls).toEqual([{ tool: "incident.create", ok: true }]);

    // The runner ran as the enriched runAs principal, with the run's client,
    // and an output schema built from the author's fields.
    expect(received?.principal).toEqual({
      type: "application",
      id: "svc-1",
      name: "Incident Bot",
      roles: ["incident-responder"],
      accessRules: ["incident.incident.manage"],
      teamIds: ["team-9"],
    });
    expect(received?.rpcClient).toBe(baseCtx.rpcClient);
    expect(received?.connectionId).toBe("conn-1");
    expect(received?.outputSchema).toBeInstanceOf(z.ZodType);
  });

  it("fails clearly when the service account cannot be resolved", async () => {
    const { getService } = makeGetService({
      enriched: null,
      runner: async () => ({ text: "", toolCalls: [] }),
    });
    const result = await aiAnalyzeAction.execute({
      ...baseCtx,
      getService,
      runAs: "ghost",
      config: baseConfig as never,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/could not be resolved|ghost/i);
  });
});
