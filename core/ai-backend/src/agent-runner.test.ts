import { describe, expect, it, mock } from "bun:test";
import { asSchema } from "ai";
import { z } from "zod";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { OpenAiCompatibleConnection } from "@checkstack/ai-common";
import { createAgentRunner } from "./agent-runner";
import { createAiToolRegistry } from "./tool-registry";
import { createAiToolResolver } from "./resolver";
import { deferredProjectionExecute } from "./projection";
import type { RegisteredAiTool } from "./tool-registry";

/**
 * Unit coverage for the headless agent runner. The model is injected, so this
 * exercises the real tool-resolution + filtering + execution wiring without a
 * live LLM.
 */

const connection: OpenAiCompatibleConnection = {
  baseUrl: "https://example.test/v1",
  apiKey: "sk-test",
  defaultModel: "test-model",
} as OpenAiCompatibleConnection;

const principal: AuthUser = {
  type: "application",
  id: "svc-1",
  name: "Svc",
  accessRules: ["*"],
  teamIds: [],
};

const rpcClient = { forPlugin: () => ({}) } as unknown as RpcClient;

function readTool(name: string, exec: () => Promise<unknown>): RegisteredAiTool {
  return {
    name,
    description: `read ${name}`,
    effect: "read",
    input: z.object({}),
    requiredAccessRules: [],
    execute: exec,
  } as RegisteredAiTool;
}

describe("createAgentRunner", () => {
  it("offers non-destructive, non-projected tools and runs the loop", async () => {
    const registry = createAiToolRegistry();
    const calls: string[] = [];
    registry.register(
      readTool("plugin_read", async () => {
        calls.push("plugin_read");
        return { ok: true };
      }),
    );
    // A destructive tool must NOT be offered.
    registry.register({
      name: "plugin_delete",
      description: "delete",
      effect: "destructive",
      input: z.object({}),
      requiredAccessRules: [],
      execute: async () => ({ deleted: true }),
    } as RegisteredAiTool);
    // A projected read (deferred sentinel) must NOT be offered in v1.
    registry.register({
      name: "plugin_projected",
      description: "projected",
      effect: "read",
      input: z.object({}),
      requiredAccessRules: [],
      execute: deferredProjectionExecute,
    } as RegisteredAiTool);

    const resolver = createAiToolResolver({ registry });

    let offeredToolNames: string[] = [];
    const generateText = mock(async (args: { tools?: Record<string, unknown> }) => {
      offeredToolNames = Object.keys(args.tools ?? {});
      // Simulate the model calling the read tool once.
      const t = (args.tools ?? {})["plugin_read"] as {
        execute: (i: unknown) => Promise<unknown>;
      };
      await t.execute({});
      return { text: "done", usage: {} };
    });
    const generateObject = mock(async () => ({ object: { severity: "high" }, usage: {} }));

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      modelFns: {
        generateText: generateText as never,
        generateObject: generateObject as never,
      },
    });

    const result = await runner({
      principal,
      rpcClient,
      connectionId: "conn-1",
      prompt: "go",
      outputSchema: z.object({ severity: z.string() }),
    });

    expect(offeredToolNames.sort()).toEqual(["plugin_read"]);
    expect(calls).toEqual(["plugin_read"]);
    expect(result.text).toBe("done");
    expect(result.object).toEqual({ severity: "high" });
    expect(result.toolCalls).toEqual([{ tool: "plugin_read", ok: true }]);
  });

  it("hands the model a date-safe schema for tools with Date inputs (no throw)", async () => {
    // Regression: the AI Action (headless agent runner) builds its OWN tools.
    // A `z.date()` input would make the SDK's Zod->JSON-Schema conversion throw
    // "Date cannot be represented...", crashing the action - the same bug as the
    // chat. The runner must gate date inputs through dateSafeModelSchema too.
    const registry = createAiToolRegistry();
    registry.register({
      name: "plugin_history",
      description: "history",
      effect: "read",
      input: z.object({ since: z.date() }),
      requiredAccessRules: [],
      execute: async () => ({ ok: true }),
    } as RegisteredAiTool);
    const resolver = createAiToolResolver({ registry });

    let offeredSchema: unknown;
    const generateText = mock(
      async (args: {
        tools?: Record<string, { inputSchema: unknown }>;
      }) => {
        const t = (args.tools ?? {})["plugin_history"];
        // Exactly what the SDK does internally to build the model request; this
        // threw before the fix.
        offeredSchema = await asSchema(t.inputSchema as never).jsonSchema;
        return { text: "ok", usage: {} };
      },
    );

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      modelFns: { generateText: generateText as never },
    });

    await runner({
      principal,
      rpcClient,
      connectionId: "conn-1",
      prompt: "go",
    });

    const props = (
      offeredSchema as { properties: Record<string, Record<string, unknown>> }
    ).properties;
    expect(props.since?.type).toBe("string");
    expect(props.since?.format).toBe("date-time");
  });

  it("offers a projected read tool and routes it through the principal's client", async () => {
    const registry = createAiToolRegistry();
    registry.register({
      name: "incident_list",
      description: "list incidents",
      effect: "read",
      input: z.object({}),
      requiredAccessRules: [],
      execute: deferredProjectionExecute,
    } as RegisteredAiTool);
    const resolver = createAiToolResolver({ registry });

    const procCalls: unknown[] = [];
    const routedClient = {
      forPlugin: (def: { pluginId: string }) => {
        expect(def.pluginId).toBe("incident");
        return {
          listIncidents: async (i: unknown) => {
            procCalls.push(i);
            return { incidents: [] };
          },
        };
      },
    } as unknown as RpcClient;

    let offered: string[] = [];
    const generateText = mock(async (args: { tools?: Record<string, unknown> }) => {
      offered = Object.keys(args.tools ?? {});
      const t = (args.tools ?? {})["incident_list"] as {
        execute: (i: unknown) => Promise<unknown>;
      };
      await t.execute({ status: "open" });
      return { text: "ok", usage: {} };
    });

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      getProjectionRoute: (name) =>
        name === "incident_list"
          ? { pluginId: "incident", procedureKey: "listIncidents" }
          : undefined,
      modelFns: { generateText: generateText as never },
    });

    const result = await runner({
      principal,
      rpcClient: routedClient,
      connectionId: "conn-1",
      prompt: "go",
    });

    expect(offered).toEqual(["incident_list"]);
    expect(procCalls).toEqual([{ status: "open" }]);
    expect(result.toolCalls).toEqual([{ tool: "incident_list", ok: true }]);
  });

  it("records a tool failure and surfaces it to the model instead of aborting", async () => {
    const registry = createAiToolRegistry();
    registry.register(
      readTool("plugin_boom", async () => {
        throw new Error("missing access: plugin.read");
      }),
    );
    const resolver = createAiToolResolver({ registry });

    let toolResult: unknown;
    const generateText = mock(async (args: { tools?: Record<string, unknown> }) => {
      const t = (args.tools ?? {})["plugin_boom"] as {
        execute: (i: unknown) => Promise<unknown>;
      };
      toolResult = await t.execute({});
      return { text: "handled", usage: {} };
    });

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      modelFns: { generateText: generateText as never },
    });

    const result = await runner({
      principal,
      rpcClient,
      connectionId: "conn-1",
      prompt: "go",
    });

    expect(toolResult).toEqual({ error: "missing access: plugin.read" });
    expect(result.toolCalls).toEqual([{ tool: "plugin_boom", ok: false }]);
    expect(result.object).toBeUndefined();
  });

  it("calls recordToolCall for each invocation (ok and failure)", async () => {
    const registry = createAiToolRegistry();
    registry.register(readTool("plugin_ok", async () => ({ ok: true })));
    registry.register(
      readTool("plugin_boom", async () => {
        throw new Error("nope");
      }),
    );
    const resolver = createAiToolResolver({ registry });

    const recorded: Array<{ toolName: string; ok: boolean; effect: string }> =
      [];
    const recordToolCall = async (a: {
      toolName: string;
      ok: boolean;
      effect: string;
    }) => {
      recorded.push({ toolName: a.toolName, ok: a.ok, effect: a.effect });
    };

    const generateText = mock(async (args: { tools?: Record<string, unknown> }) => {
      const tools = args.tools ?? {};
      await (tools["plugin_ok"] as { execute: (i: unknown) => Promise<unknown> }).execute({});
      await (tools["plugin_boom"] as { execute: (i: unknown) => Promise<unknown> }).execute({});
      return { text: "x", usage: {} };
    });

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      recordToolCall: recordToolCall as never,
      modelFns: { generateText: generateText as never },
    });
    await runner({ principal, rpcClient, connectionId: "c", prompt: "go" });

    expect(recorded).toContainEqual({
      toolName: "plugin_ok",
      ok: true,
      effect: "read",
    });
    expect(recorded).toContainEqual({
      toolName: "plugin_boom",
      ok: false,
      effect: "read",
    });
  });

  it("injects the headless baseline prompt (boundaries) into the loop", async () => {
    const resolver = createAiToolResolver({ registry: createAiToolRegistry() });
    let seenSystem = "";
    const generateText = mock(async (args: { system?: string }) => {
      seenSystem = args.system ?? "";
      return { text: "x", usage: {} };
    });
    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      modelFns: { generateText: generateText as never },
    });
    await runner({ principal, rpcClient, connectionId: "c", prompt: "go" });

    expect(seenSystem).toContain("UNATTENDED");
    expect(seenSystem).toContain("takes effect IMMEDIATELY");
    expect(seenSystem).toContain("do NOT guess");
  });

  it("appends an author systemPrompt override onto the baseline (never replaces it)", async () => {
    const resolver = createAiToolResolver({ registry: createAiToolRegistry() });
    let seenSystem = "";
    const generateText = mock(async (args: { system?: string }) => {
      seenSystem = args.system ?? "";
      return { text: "x", usage: {} };
    });
    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      modelFns: { generateText: generateText as never },
    });
    await runner({
      principal,
      rpcClient,
      connectionId: "c",
      prompt: "go",
      systemPrompt: "You are the triage bot.",
    });

    // Override is present AND the safety baseline survived.
    expect(seenSystem).toContain("You are the triage bot.");
    expect(seenSystem).toContain("takes effect IMMEDIATELY");
  });

  it("retries the structured-output pass on a schema miss, feeding the error back", async () => {
    const resolver = createAiToolResolver({ registry: createAiToolRegistry() });
    const generateText = mock(async () => ({ text: "analysis", usage: {} }));
    // First attempt rejects (schema miss); second succeeds.
    const systemsSeen: string[] = [];
    let attempt = 0;
    const generateObject = mock(async (args: { system?: string }) => {
      systemsSeen.push(args.system ?? "");
      attempt += 1;
      if (attempt === 1) {
        throw new Error("severity must be one of low|medium|high");
      }
      return { object: { severity: "high" }, usage: {} };
    });

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      modelFns: {
        generateText: generateText as never,
        generateObject: generateObject as never,
      },
    });

    const result = await runner({
      principal,
      rpcClient,
      connectionId: "c",
      prompt: "classify",
      outputSchema: z.object({ severity: z.string() }),
    });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result.object).toEqual({ severity: "high" });
    // The retry's system prompt carries the prior failure as repair guidance.
    expect(systemsSeen[1]).toContain("rejected");
    expect(systemsSeen[1]).toContain("severity must be one of");
  });

  it("gives up after the bounded retries and propagates the last schema error", async () => {
    const resolver = createAiToolResolver({ registry: createAiToolRegistry() });
    const generateText = mock(async () => ({ text: "analysis", usage: {} }));
    const generateObject = mock(async () => {
      throw new Error("still invalid");
    });

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      modelFns: {
        generateText: generateText as never,
        generateObject: generateObject as never,
      },
    });

    await expect(
      runner({
        principal,
        rpcClient,
        connectionId: "c",
        prompt: "classify",
        outputSchema: z.object({ severity: z.string() }),
      }),
    ).rejects.toThrow("still invalid");
    // 1 initial attempt + MAX_OUTPUT_REPAIR_ATTEMPTS (2) = 3 total.
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("throws a clear error when the connection is invalid", async () => {
    const resolver = createAiToolResolver({ registry: createAiToolRegistry() });
    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => undefined,
      modelFns: { generateText: mock(async () => ({ text: "", usage: {} })) as never },
    });
    await expect(
      runner({ principal, rpcClient, connectionId: "missing", prompt: "go" }),
    ).rejects.toThrow(/connection "missing"/i);
  });
});
