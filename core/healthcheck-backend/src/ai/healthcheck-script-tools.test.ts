import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import {
  GetScriptContextOutputSchema,
  TestScriptOutputSchema,
} from "@checkstack/ai-common";
import {
  createHealthcheckGetScriptContextTool,
  createHealthcheckTestScriptTool,
} from "./healthcheck-script-tools";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["healthcheck.healthcheck.manage"],
};

/** A canned collector test result the stub RPC returns; the tool must map it through. */
const CANNED_RESULT = {
  result: { statusCode: 200 },
  stdout: "probe ok\n",
  stderr: "",
  exitCode: 0,
  durationMs: 42,
  timedOut: false,
  error: undefined,
};

function fakeHealthcheckRpcClient(): RpcClient {
  return {
    forPlugin: () => ({
      testCollectorScript: mock(() => Promise.resolve(CANNED_RESULT)),
    }),
  } as unknown as RpcClient;
}

describe("healthcheck.getScriptContext tool", () => {
  test("declares read effect + healthcheck manage gate, no dryRun", () => {
    const tool = createHealthcheckGetScriptContextTool();
    expect(tool.name).toBe("healthcheck.getScriptContext");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual([
      "healthcheck.healthcheck.manage",
    ]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("resolves a healthcheck-script context from the real SDK bundle", async () => {
    const tool = createHealthcheckGetScriptContextTool();
    const out = await tool.execute({
      input: { context: "healthcheck-script" },
      principal,
      rpcClient: fakeHealthcheckRpcClient(),
    });
    expect(GetScriptContextOutputSchema.safeParse(out).success).toBe(true);
    expect(out.context).toBe("healthcheck-script");
    expect(out.declarations.length).toBeGreaterThan(0);
  });
});

describe("healthcheck.testScript tool", () => {
  test("declares read effect + healthcheck manage gate, no dryRun", () => {
    const tool = createHealthcheckTestScriptTool();
    expect(tool.name).toBe("healthcheck.testScript");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual([
      "healthcheck.healthcheck.manage",
    ]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("maps the RPC result fields through to the tool output", async () => {
    const tool = createHealthcheckTestScriptTool();
    const out = await tool.execute({
      input: {
        context: "healthcheck-script",
        source: "export default async () => ({ statusCode: 200 });",
        timeoutMs: 10_000,
      },
      principal,
      rpcClient: fakeHealthcheckRpcClient(),
    });
    expect(TestScriptOutputSchema.safeParse(out).success).toBe(true);
    expect(out.result).toEqual(CANNED_RESULT.result);
    expect(out.stdout).toBe(CANNED_RESULT.stdout);
    expect(out.stderr).toBe(CANNED_RESULT.stderr);
    expect(out.exitCode).toBe(CANNED_RESULT.exitCode);
    expect(out.durationMs).toBe(CANNED_RESULT.durationMs);
    expect(out.timedOut).toBe(false);
    // sandboxDowngraded is computed from the active policy and always surfaced.
    expect(typeof out.sandboxDowngraded).toBe("boolean");
  });
});
