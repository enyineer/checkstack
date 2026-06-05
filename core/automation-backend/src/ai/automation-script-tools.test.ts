import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import {
  GetScriptContextOutputSchema,
  TestScriptOutputSchema,
} from "@checkstack/ai-common";
import { ScriptTestResultSchema } from "@checkstack/automation-common";
import {
  createAutomationGetScriptContextTool,
  createAutomationTestScriptTool,
} from "./automation-script-tools";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["automation.automation.manage"],
};

/** A canned automation test-script RPC result the stub returns. */
const CANNED_RESULT = ScriptTestResultSchema.parse({
  result: { ok: true },
  stdout: "hello",
  stderr: "",
  exitCode: 0,
  durationMs: 42,
  timedOut: false,
});

function fakeAutomationRpcClient(): RpcClient {
  return {
    forPlugin: () => ({
      testScript: mock(() => Promise.resolve(CANNED_RESULT)),
    }),
  } as unknown as RpcClient;
}

describe("automation.getScriptContext tool", () => {
  test("declares read effect gated by the automation manage rule", () => {
    const tool = createAutomationGetScriptContextTool();
    expect(tool.name).toBe("automation.getScriptContext");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.manage"]);
    // read tools never define a dryRun
    expect(tool.dryRun).toBeUndefined();
  });

  test("resolves a real automation TS context from the SDK bundle (no network)", async () => {
    const tool = createAutomationGetScriptContextTool();
    const out = await tool.execute({
      input: { context: "automation-action-script" },
      principal,
      rpcClient: fakeAutomationRpcClient(),
    });
    expect(GetScriptContextOutputSchema.safeParse(out).success).toBe(true);
    expect(out.context).toBe("automation-action-script");
    expect(out.language).toBe("typescript");
    expect(out.sdkModule).toBe("@checkstack/sdk/integration");
    expect(out.helper).toBe("defineIntegration");
    // The declarations come from the generated editor bundle.
    expect(out.declarations.length).toBeGreaterThan(0);
    expect(out.allowsManagedPackages).toBe(true);
  });

  test("resolves the automation shell context with injected env vars", async () => {
    const tool = createAutomationGetScriptContextTool();
    const out = await tool.execute({
      input: { context: "automation-action-shell" },
      principal,
      rpcClient: fakeAutomationRpcClient(),
    });
    expect(out.language).toBe("shell");
    expect(out.shellEnv?.length ?? 0).toBeGreaterThan(0);
    expect(out.allowsManagedPackages).toBe(false);
  });
});

describe("automation.testScript tool", () => {
  test("declares read effect gated by the automation manage rule", () => {
    const tool = createAutomationTestScriptTool();
    expect(tool.name).toBe("automation.testScript");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.manage"]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("maps the RPC result to the tool output shape", async () => {
    const tool = createAutomationTestScriptTool();
    const out = await tool.execute({
      input: {
        context: "automation-action-script",
        source: "export default async () => ({ ok: true });",
        timeoutMs: 10_000,
      },
      principal,
      rpcClient: fakeAutomationRpcClient(),
    });
    expect(TestScriptOutputSchema.safeParse(out).success).toBe(true);
    expect(out.result).toEqual({ ok: true });
    expect(out.stdout).toBe("hello");
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
    expect(out.durationMs).toBe(42);
    expect(out.timedOut).toBe(false);
    // sandboxDowngraded is resolved from the global policy; it is always a
    // boolean and present in the output (fail-closed if the read throws).
    expect(typeof out.sandboxDowngraded).toBe("boolean");
  });

  test("passes the typescript kind for the action-script context", async () => {
    const testScript = mock((_input: { kind: string }) =>
      Promise.resolve(CANNED_RESULT),
    );
    const rpcClient = {
      forPlugin: () => ({ testScript }),
    } as unknown as RpcClient;
    const tool = createAutomationTestScriptTool();
    await tool.execute({
      input: {
        context: "automation-action-script",
        source: "export default async () => ({});",
        timeoutMs: 10_000,
      },
      principal,
      rpcClient,
    });
    expect(testScript).toHaveBeenCalledTimes(1);
    expect(testScript.mock.calls[0]?.[0]?.kind).toBe("typescript");
  });

  test("passes the shell kind for the action-shell context", async () => {
    const testScript = mock(
      (_input: {
        kind: string;
        secretEnv?: unknown;
        secretOverrides?: unknown;
      }) => Promise.resolve(CANNED_RESULT),
    );
    const rpcClient = {
      forPlugin: () => ({ testScript }),
    } as unknown as RpcClient;
    const tool = createAutomationTestScriptTool();
    await tool.execute({
      input: {
        context: "automation-action-shell",
        source: "echo hi",
        timeoutMs: 10_000,
      },
      principal,
      rpcClient,
    });
    const rpcInput = testScript.mock.calls[0]?.[0];
    expect(rpcInput?.kind).toBe("shell");
    // The tool NEVER forwards secret material.
    expect(rpcInput?.secretEnv).toBeUndefined();
    expect(rpcInput?.secretOverrides).toBeUndefined();
  });
});
