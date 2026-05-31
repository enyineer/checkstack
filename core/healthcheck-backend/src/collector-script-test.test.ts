import { describe, expect, test } from "bun:test";
import type {
  EsmScriptRunner,
  ShellScriptRunner,
} from "@checkstack/backend-api";
import {
  buildCollectorContext,
  buildShellRunContextEnv,
  runCollectorScriptTest,
} from "./collector-script-test";

function fakeEsm(impl: EsmScriptRunner["run"]): {
  runner: EsmScriptRunner;
  calls: Parameters<EsmScriptRunner["run"]>[0][];
} {
  const calls: Parameters<EsmScriptRunner["run"]>[0][] = [];
  return { calls, runner: { run: (o) => (calls.push(o), impl(o)) } };
}

function fakeShell(impl: ShellScriptRunner["run"]): {
  runner: ShellScriptRunner;
  calls: Parameters<ShellScriptRunner["run"]>[0][];
} {
  const calls: Parameters<ShellScriptRunner["run"]>[0][] = [];
  return { calls, runner: { run: (o) => (calls.push(o), impl(o)) } };
}

describe("buildShellRunContextEnv", () => {
  test("emits check + system vars when present", () => {
    const env = buildShellRunContextEnv({
      check: { id: "c1", name: "CPU", intervalSeconds: 60 },
      system: { id: "s1", name: "web-1" },
    });
    expect(env).toEqual({
      CHECKSTACK_CHECK_ID: "c1",
      CHECKSTACK_CHECK_NAME: "CPU",
      CHECKSTACK_CHECK_INTERVAL_SECONDS: "60",
      CHECKSTACK_SYSTEM_ID: "s1",
      CHECKSTACK_SYSTEM_NAME: "web-1",
    });
  });

  test("emits nothing for an empty run context", () => {
    expect(buildShellRunContextEnv(undefined)).toEqual({});
  });

  test("emits only the provided half", () => {
    const env = buildShellRunContextEnv({
      system: { id: "s1", name: "web-1" },
    });
    expect(env).toEqual({
      CHECKSTACK_SYSTEM_ID: "s1",
      CHECKSTACK_SYSTEM_NAME: "web-1",
    });
  });
});

describe("buildCollectorContext", () => {
  test("always includes config, includes check/system only when present", () => {
    expect(buildCollectorContext({ config: { threshold: 1 } })).toEqual({
      config: { threshold: 1 },
    });
    expect(
      buildCollectorContext({
        config: {},
        runContext: { check: { id: "c", name: "n", intervalSeconds: 30 } },
      }),
    ).toEqual({
      config: {},
      check: { id: "c", name: "n", intervalSeconds: 30 },
    });
  });

  test("defaults config to an empty object", () => {
    expect(buildCollectorContext({})).toEqual({ config: {} });
  });
});

describe("runCollectorScriptTest — typescript", () => {
  test("runs with the healthcheck helper + built context", async () => {
    const { runner, calls } = fakeEsm(async () => ({
      result: { success: true, value: 0.4 },
      stdout: "",
      stderr: "",
      timedOut: false,
    }));
    const out = await runCollectorScriptTest({
      input: {
        kind: "typescript",
        script: "export default { success: true }",
        config: { threshold: 0.6 },
        runContext: { check: { id: "c", name: "Load", intervalSeconds: 60 } },
        timeoutMs: 5000,
      },
      deps: { esmRunner: runner },
    });
    expect(calls[0]?.helperModuleName).toBe("@checkstack/healthcheck");
    expect(calls[0]?.helperFunctionName).toBe("defineHealthCheck");
    expect(calls[0]?.context).toEqual({
      config: { threshold: 0.6 },
      check: { id: "c", name: "Load", intervalSeconds: 60 },
    });
    expect(out.result).toEqual({ success: true, value: 0.4 });
    expect(out.error).toBeUndefined();
  });

  test("surfaces a thrown error and a timeout", async () => {
    const thrown = await runCollectorScriptTest({
      input: { kind: "typescript", script: "throw 1", timeoutMs: 1000 },
      deps: { esmRunner: fakeEsm(async () => ({ error: "boom", stdout: "", stderr: "", timedOut: false })).runner },
    });
    expect(thrown.error).toBe("boom");

    const timedOut = await runCollectorScriptTest({
      input: { kind: "typescript", script: "while(1){}", timeoutMs: 50 },
      deps: { esmRunner: fakeEsm(async () => ({ stdout: "", stderr: "", timedOut: true })).runner },
    });
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.error).toBe("Script execution timed out");
  });

  test("catches an unexpected runner rejection", async () => {
    const out = await runCollectorScriptTest({
      input: { kind: "typescript", script: "x", timeoutMs: 1000 },
      deps: {
        esmRunner: fakeEsm(async () => {
          throw new Error("spawn failed");
        }).runner,
      },
    });
    expect(out.error).toBe("spawn failed");
  });
});

describe("runCollectorScriptTest — shell", () => {
  test("injects CHECKSTACK_* run-context env + merges explicit env", async () => {
    const { runner, calls } = fakeShell(async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    }));
    const out = await runCollectorScriptTest({
      input: {
        kind: "shell",
        script: "echo $CHECKSTACK_CHECK_NAME",
        runContext: { check: { id: "c", name: "Disk", intervalSeconds: 30 } },
        env: { EXTRA: "1" },
        timeoutMs: 3000,
      },
      deps: { shellRunner: runner },
    });
    const env = calls[0]?.env ?? {};
    expect(env.CHECKSTACK_CHECK_NAME).toBe("Disk");
    expect(env.EXTRA).toBe("1");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("ok");
  });

  test("reports a non-zero exit as an error", async () => {
    const out = await runCollectorScriptTest({
      input: { kind: "shell", script: "exit 5", timeoutMs: 1000 },
      deps: {
        shellRunner: fakeShell(async () => ({
          exitCode: 5,
          stdout: "",
          stderr: "bad",
          timedOut: false,
        })).runner,
      },
    });
    expect(out.exitCode).toBe(5);
    expect(out.error).toContain("exited with code 5");
  });
});

describe("runCollectorScriptTest secret placeholders + overrides (decision 4)", () => {
  test("injects __SECRET_<NAME>__ placeholders into the collector env by default", async () => {
    const { runner, calls } = fakeEsm(async (opts) => ({
      result: opts.env ?? null,
      stdout: "",
      stderr: "",
      timedOut: false,
    }));
    await runCollectorScriptTest({
      input: {
        kind: "typescript",
        script: "export default () => ({ success: true })",
        timeoutMs: 1000,
        secretEnv: { TOKEN: "${{ secrets.api }}" },
      },
      deps: { esmRunner: runner },
    });
    expect(calls[0]?.env).toEqual({ TOKEN: "__SECRET_api__" });
  });

  test("injects + masks a user override (no real resolution)", async () => {
    const { runner, calls } = fakeShell(async () => ({
      exitCode: 0,
      stdout: "value=override-secret",
      stderr: "",
      timedOut: false,
    }));
    const out = await runCollectorScriptTest({
      input: {
        kind: "shell",
        script: "echo value=$TOKEN",
        timeoutMs: 1000,
        secretEnv: { TOKEN: "${{ secrets.api }}" },
        secretOverrides: { api: "override-secret" },
      },
      deps: { shellRunner: runner },
    });
    expect(calls[0]?.env?.TOKEN).toBe("override-secret");
    expect(out.stdout).toBe("value=****");
    expect(JSON.stringify(out)).not.toContain("override-secret");
  });

  test("no secretEnv -> no secret env injected (least-privilege)", async () => {
    const { runner, calls } = fakeEsm(async (opts) => ({
      result: opts.env ?? null,
      stdout: "",
      stderr: "",
      timedOut: false,
    }));
    await runCollectorScriptTest({
      input: {
        kind: "typescript",
        script: "export default () => ({ success: true })",
        timeoutMs: 1000,
      },
      deps: { esmRunner: runner },
    });
    expect(calls[0]?.env).toBeUndefined();
  });
});
