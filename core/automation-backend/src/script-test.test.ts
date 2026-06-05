import { describe, expect, test } from "bun:test";
import type {
  EsmScriptRunner,
  ShellScriptRunner,
} from "@checkstack/backend-api";
import {
  buildScriptContext,
  buildTestSecretEnv,
  runScriptTest,
  type ScriptTestContext,
} from "./script-test";

function fakeEsmRunner(
  impl: EsmScriptRunner["run"],
): { runner: EsmScriptRunner; calls: Parameters<EsmScriptRunner["run"]>[0][] } {
  const calls: Parameters<EsmScriptRunner["run"]>[0][] = [];
  return {
    calls,
    runner: {
      run: (options) => {
        calls.push(options);
        return impl(options);
      },
    },
  };
}

function fakeShellRunner(
  impl: ShellScriptRunner["run"],
): {
  runner: ShellScriptRunner;
  calls: Parameters<ShellScriptRunner["run"]>[0][];
} {
  const calls: Parameters<ShellScriptRunner["run"]>[0][] = [];
  return {
    calls,
    runner: {
      run: (options) => {
        calls.push(options);
        return impl(options);
      },
    },
  };
}

describe("buildScriptContext", () => {
  test("fills defaults for an empty sample", () => {
    const ctx = buildScriptContext(undefined);
    expect(ctx).toEqual({
      trigger: { event: "", payload: {} },
      artifacts: {},
      var: {},
      automation: {
        runId: "test-run",
        automationId: "test-automation",
        contextKey: null,
      },
    });
  });

  test("passes through provided trigger / artifacts / var and includes repeat only when present", () => {
    const sample: ScriptTestContext = {
      trigger: { event: "incident.created", payload: { id: "INC-1" } },
      artifacts: { jira_issue: { key: "PROJ-1" } },
      var: { count: 3 },
      repeat: { index: 2, item: { name: "a" } },
    };
    const ctx = buildScriptContext(sample);
    expect(ctx.trigger).toEqual({
      event: "incident.created",
      payload: { id: "INC-1" },
    });
    expect(ctx.artifacts).toEqual({ jira_issue: { key: "PROJ-1" } });
    expect(ctx.var).toEqual({ count: 3 });
    expect(ctx.repeat).toEqual({ index: 2, item: { name: "a" } });
  });

  test("omits repeat when not in the sample", () => {
    const ctx = buildScriptContext({ trigger: { event: "x" } });
    expect("repeat" in ctx).toBe(false);
  });
});

describe("runScriptTest — typescript", () => {
  test("invokes the ESM runner with the built context + helper module", async () => {
    const { runner, calls } = fakeEsmRunner(async () => ({
      result: { id: "ok" },
      stdout: "log line",
      stderr: "",
      timedOut: false,
    }));

    const out = await runScriptTest({
      input: {
        kind: "typescript",
        script: "export default { id: 'ok' }",
        context: { trigger: { event: "e", payload: { a: 1 } } },
        timeoutMs: 5000,
      },
      deps: { esmRunner: runner },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.helperModuleName).toBe("@checkstack/sdk/integration");
    expect(calls[0]?.helperFunctionName).toBe("defineIntegration");
    expect(calls[0]?.timeoutMs).toBe(5000);
    expect(out.result).toEqual({ id: "ok" });
    expect(out.stdout).toBe("log line");
    expect(out.error).toBeUndefined();
    expect(out.timedOut).toBe(false);
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("surfaces a thrown-script error", async () => {
    const { runner } = fakeEsmRunner(async () => ({
      error: "boom",
      stack: "Error: boom",
      stdout: "",
      stderr: "",
      timedOut: false,
    }));

    const out = await runScriptTest({
      input: { kind: "typescript", script: "throw new Error('boom')", timeoutMs: 1000 },
      deps: { esmRunner: runner },
    });
    expect(out.error).toBe("boom");
  });

  test("reports timeout as an error", async () => {
    const { runner } = fakeEsmRunner(async () => ({
      stdout: "",
      stderr: "",
      timedOut: true,
      error: "Script execution timed out",
    }));

    const out = await runScriptTest({
      input: { kind: "typescript", script: "while(true){}", timeoutMs: 100 },
      deps: { esmRunner: runner },
    });
    expect(out.timedOut).toBe(true);
    expect(out.error).toBe("Script execution timed out");
  });

  test("catches an unexpected runner rejection instead of throwing", async () => {
    const { runner } = fakeEsmRunner(async () => {
      throw new Error("spawn failed");
    });
    const out = await runScriptTest({
      input: { kind: "typescript", script: "x", timeoutMs: 1000 },
      deps: { esmRunner: runner },
    });
    expect(out.error).toBe("spawn failed");
  });
});

describe("runScriptTest — shell", () => {
  test("flattens the sample context into CHECKSTACK_* env and merges explicit env", async () => {
    const { runner, calls } = fakeShellRunner(async () => ({
      exitCode: 0,
      stdout: "hello",
      stderr: "",
      timedOut: false,
    }));

    const out = await runScriptTest({
      input: {
        kind: "shell",
        script: "echo $CHECKSTACK_TRIGGER_PAYLOAD_ID",
        context: { trigger: { event: "e", payload: { id: "INC-9" } } },
        env: { EXTRA: "1" },
        timeoutMs: 3000,
      },
      deps: { shellRunner: runner },
    });

    expect(calls).toHaveLength(1);
    const env = calls[0]?.env ?? {};
    expect(env.CHECKSTACK_TRIGGER_EVENT).toBe("e");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_ID).toBe("INC-9");
    expect(env.EXTRA).toBe("1");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("hello");
    expect(out.error).toBeUndefined();
  });

  test("explicit env wins on key collision", async () => {
    const { runner, calls } = fakeShellRunner(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    }));
    await runScriptTest({
      input: {
        kind: "shell",
        script: "true",
        context: { trigger: { event: "from-context" } },
        env: { CHECKSTACK_TRIGGER_EVENT: "from-env" },
        timeoutMs: 1000,
      },
      deps: { shellRunner: runner },
    });
    expect(calls[0]?.env?.CHECKSTACK_TRIGGER_EVENT).toBe("from-env");
  });

  test("reports a non-zero exit code as an error", async () => {
    const { runner } = fakeShellRunner(async () => ({
      exitCode: 2,
      stdout: "",
      stderr: "nope",
      timedOut: false,
    }));
    const out = await runScriptTest({
      input: { kind: "shell", script: "exit 2", timeoutMs: 1000 },
      deps: { shellRunner: runner },
    });
    expect(out.exitCode).toBe(2);
    expect(out.error).toContain("exited with code 2");
  });

  test("reports a shell timeout", async () => {
    const { runner } = fakeShellRunner(async () => ({
      exitCode: -1,
      stdout: "",
      stderr: "Script execution timed out",
      timedOut: true,
    }));
    const out = await runScriptTest({
      input: { kind: "shell", script: "sleep 100", timeoutMs: 50 },
      deps: { shellRunner: runner },
    });
    expect(out.timedOut).toBe(true);
    expect(out.error).toBe("Script execution timed out");
  });
});

describe("runScriptTest secret masking (leak guard)", () => {
  test("redacts run-scoped secret values from a TS test result/stdout/stderr", async () => {
    const { runner } = fakeEsmRunner(async () => ({
      result: { token: "gh_injectedSecret999" },
      stdout: "echoing gh_injectedSecret999 to stdout",
      stderr: "warn: gh_injectedSecret999 seen",
      timedOut: false,
    }));
    const out = await runScriptTest({
      input: { kind: "typescript", script: "export default () => {}", timeoutMs: 1000 },
      deps: { esmRunner: runner, maskValues: ["gh_injectedSecret999"] },
    });
    expect(out.stdout).toBe("echoing **** to stdout");
    expect(out.stderr).toBe("warn: **** seen");
    expect(out.result).toEqual({ token: "****" });
    expect(JSON.stringify(out)).not.toContain("gh_injectedSecret999");
  });

  test("redacts secret values from shell test stdout/stderr", async () => {
    const { runner } = fakeShellRunner(async () => ({
      exitCode: 0,
      stdout: "$ echo db-password-456",
      stderr: "",
      timedOut: false,
    }));
    const out = await runScriptTest({
      input: { kind: "shell", script: "echo $X", timeoutMs: 1000 },
      deps: { shellRunner: runner, maskValues: ["db-password-456"] },
    });
    expect(out.stdout).toBe("$ echo ****");
  });

  test("is a no-op when no mask values are provided (Phase 1 default)", async () => {
    const { runner } = fakeEsmRunner(async () => ({
      result: undefined,
      stdout: "no secrets here",
      stderr: "",
      timedOut: false,
    }));
    const out = await runScriptTest({
      input: { kind: "typescript", script: "export default () => {}", timeoutMs: 1000 },
      deps: { esmRunner: runner },
    });
    expect(out.stdout).toBe("no secrets here");
  });
});

describe("runScriptTest secret placeholders + overrides (decision 4)", () => {
  test("injects __SECRET_<NAME>__ placeholders by default (no real resolution)", async () => {
    const { runner, calls } = fakeEsmRunner(async (opts) => ({
      result: opts.env ?? null,
      stdout: "",
      stderr: "",
      timedOut: false,
    }));
    const out = await runScriptTest({
      input: {
        kind: "typescript",
        script: "export default () => {}",
        timeoutMs: 1000,
        secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
      },
      deps: { esmRunner: runner },
    });
    // The injected env is the placeholder, never a real value.
    expect(calls[0].env).toEqual({ API_TOKEN: "__SECRET_jira_token__" });
    expect(out.result).toEqual({ API_TOKEN: "__SECRET_jira_token__" });
  });

  test("injects a user override instead of the placeholder", async () => {
    const { runner, calls } = fakeShellRunner(async () => ({
      exitCode: 0,
      stdout: "ran",
      stderr: "",
      timedOut: false,
    }));
    await runScriptTest({
      input: {
        kind: "shell",
        script: "echo $DB",
        timeoutMs: 1000,
        secretEnv: { DB: "${{ secrets.db_pass }}" },
        secretOverrides: { db_pass: "my-test-override" },
      },
      deps: { shellRunner: runner },
    });
    expect(calls[0].env?.DB).toBe("my-test-override");
  });

  test("masks the user-override value out of the result", async () => {
    const { runner } = fakeEsmRunner(async () => ({
      result: { leaked: "my-test-override" },
      stdout: "echo my-test-override",
      stderr: "",
      timedOut: false,
    }));
    const out = await runScriptTest({
      input: {
        kind: "typescript",
        script: "export default () => {}",
        timeoutMs: 1000,
        secretEnv: { TOKEN: "${{ secrets.tok }}" },
        secretOverrides: { tok: "my-test-override" },
      },
      deps: { esmRunner: runner },
    });
    expect(out.stdout).toBe("echo ****");
    expect(out.result).toEqual({ leaked: "****" });
    expect(JSON.stringify(out)).not.toContain("my-test-override");
  });

  test("no secretEnv -> no secret env injected (least-privilege)", async () => {
    const { runner, calls } = fakeShellRunner(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    }));
    await runScriptTest({
      input: { kind: "shell", script: "true", timeoutMs: 1000 },
      deps: { shellRunner: runner },
    });
    // Only the $CHECKSTACK_* context env is present; no secret-derived keys.
    const envKeys = Object.keys(calls[0].env ?? {});
    expect(envKeys.some((k) => !k.startsWith("CHECKSTACK_"))).toBe(false);
  });
});

describe("buildTestSecretEnv", () => {
  test("placeholder when no override; override when given; masks overrides", () => {
    const { env, maskValues } = buildTestSecretEnv({
      secretEnv: {
        A: "${{ secrets.alpha }}",
        B: "${{ secrets.beta }}",
      },
      secretOverrides: { beta: "real-override" },
    });
    expect(env).toEqual({
      A: "__SECRET_alpha__",
      B: "real-override",
    });
    expect(maskValues).toEqual(["real-override"]);
  });

  test("empty when no secretEnv declared", () => {
    expect(buildTestSecretEnv({})).toEqual({ env: {}, maskValues: [] });
  });
});
