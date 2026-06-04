import { describe, expect, it, mock } from "bun:test";
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
      readTool("plugin.read", async () => {
        calls.push("plugin.read");
        return { ok: true };
      }),
    );
    // A destructive tool must NOT be offered.
    registry.register({
      name: "plugin.delete",
      description: "delete",
      effect: "destructive",
      input: z.object({}),
      requiredAccessRules: [],
      execute: async () => ({ deleted: true }),
    } as RegisteredAiTool);
    // A projected read (deferred sentinel) must NOT be offered in v1.
    registry.register({
      name: "plugin.projected",
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
      const t = (args.tools ?? {})["plugin.read"] as {
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

    expect(offeredToolNames.sort()).toEqual(["plugin.read"]);
    expect(calls).toEqual(["plugin.read"]);
    expect(result.text).toBe("done");
    expect(result.object).toEqual({ severity: "high" });
    expect(result.toolCalls).toEqual([{ tool: "plugin.read", ok: true }]);
  });

  it("offers a projected read tool and routes it through the principal's client", async () => {
    const registry = createAiToolRegistry();
    registry.register({
      name: "incident.list",
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
      const t = (args.tools ?? {})["incident.list"] as {
        execute: (i: unknown) => Promise<unknown>;
      };
      await t.execute({ status: "open" });
      return { text: "ok", usage: {} };
    });

    const runner = createAgentRunner({
      resolver,
      resolveConnection: async () => connection,
      getProjectionRoute: (name) =>
        name === "incident.list"
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

    expect(offered).toEqual(["incident.list"]);
    expect(procCalls).toEqual([{ status: "open" }]);
    expect(result.toolCalls).toEqual([{ tool: "incident.list", ok: true }]);
  });

  it("records a tool failure and surfaces it to the model instead of aborting", async () => {
    const registry = createAiToolRegistry();
    registry.register(
      readTool("plugin.boom", async () => {
        throw new Error("missing access: plugin.read");
      }),
    );
    const resolver = createAiToolResolver({ registry });

    let toolResult: unknown;
    const generateText = mock(async (args: { tools?: Record<string, unknown> }) => {
      const t = (args.tools ?? {})["plugin.boom"] as {
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
    expect(result.toolCalls).toEqual([{ tool: "plugin.boom", ok: false }]);
    expect(result.object).toBeUndefined();
  });

  it("calls recordToolCall for each invocation (ok and failure)", async () => {
    const registry = createAiToolRegistry();
    registry.register(readTool("plugin.ok", async () => ({ ok: true })));
    registry.register(
      readTool("plugin.boom", async () => {
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
      await (tools["plugin.ok"] as { execute: (i: unknown) => Promise<unknown> }).execute({});
      await (tools["plugin.boom"] as { execute: (i: unknown) => Promise<unknown> }).execute({});
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
      toolName: "plugin.ok",
      ok: true,
      effect: "read",
    });
    expect(recorded).toContainEqual({
      toolName: "plugin.boom",
      ok: false,
      effect: "read",
    });
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
