/**
 * Behaviour tests for the two script-plugin automation actions.
 *
 *   - `run_shell` is exercised against a fake `ShellScriptRunner`.
 *   - `run_script` is exercised against a fake `EsmScriptRunner`.
 *
 * Both factories accept a runner via DI, so the actions can be driven
 * through happy + failure paths without spawning a real subprocess.
 * Template expansion happens upstream in the dispatch engine — by the
 * time `execute` runs, `config.script` is already the rendered source.
 */
import { describe, it, expect, mock } from "bun:test";
import type {
  EsmScriptRunner,
  EsmScriptRunOptions,
  EsmScriptRunResult,
  Logger,
  ShellScriptRunner,
  ShellScriptRunOptions,
  ShellScriptRunResult,
} from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";

import {
  createScriptRunAction,
  createShellRunAction,
  scriptResultArtifactType,
  shellResultArtifactType,
  type ScriptResultArtifact,
  type ShellResultArtifact,
} from "./automations";

const logger = createMockLogger() as Logger;

const ctxBase = {
  runId: "run-1",
  automationId: "auto-1",
  contextKey: null,
  logger,
  scope: {
    trigger: {
      id: "incident_created",
      event: "incident.created",
      actor: SYSTEM_ACTOR,
      payload: {},
    },
    artifacts: {},
    vars: {},
  },
  getService: async <T,>(): Promise<T> => {
    throw new Error("not used");
  },
};

// ─── Shell action ──────────────────────────────────────────────────────────

function makeShellRunner(
  result: ShellScriptRunResult | Error,
): ShellScriptRunner & { runMock: ReturnType<typeof mock> } {
  const runMock = mock(async (_options: ShellScriptRunOptions) => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { run: runMock, runMock } as ShellScriptRunner & {
    runMock: ReturnType<typeof mock>;
  };
}

const shellBaseConfig = {
  script: "echo hi",
  timeout: 10_000,
};

describe("shellResultArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = shellResultArtifactType.schema.safeParse({
      exitCode: 0,
      stdout: "hi",
      stderr: "",
      timedOut: false,
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a negative durationMs", () => {
    const bad = shellResultArtifactType.schema.safeParse({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: -1,
      timedOut: false,
    });
    expect(bad.success).toBe(false);
  });
});

describe("integration-script.run_shell", () => {
  it("returns success and emits a shell.result artifact on exit 0", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "hello world\nline 2",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("hello world");
    const artifact = result.artifact as ShellResultArtifact;
    expect(artifact.exitCode).toBe(0);
    expect(artifact.stdout).toBe("hello world\nline 2");
    expect(artifact.timedOut).toBe(false);
  });

  it("passes script + cwd + env + timeout through to the runner", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        script: "uname -a",
        env: { FOO: "bar" },
        workingDirectory: "/tmp",
        timeout: 5_000,
      },
    });
    expect(runner.runMock).toHaveBeenCalledTimes(1);
    const call = runner.runMock.mock.calls[0]![0] as ShellScriptRunOptions;
    expect(call.script).toBe("uname -a");
    expect(call.cwd).toBe("/tmp");
    // The operator's `config.env` is merged on top of the injected
    // run-context env vars.
    expect(call.env?.FOO).toBe("bar");
    expect(call.env?.CHECKSTACK_TRIGGER_EVENT).toBe("incident.created");
    expect(call.timeoutMs).toBe(5_000);
  });

  it("injects CHECKSTACK_* run-context env vars even when config.env is omitted", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      scope: {
        trigger: {
          id: "incident_created",
          event: "incident.created",
          actor: SYSTEM_ACTOR,
          payload: { title: "Outage" },
        },
        artifacts: {},
        vars: {},
      },
      config: shellBaseConfig,
    });
    const call = runner.runMock.mock.calls[0]![0] as ShellScriptRunOptions;
    expect(call.env?.CHECKSTACK_TRIGGER_EVENT).toBe("incident.created");
    expect(call.env?.CHECKSTACK_TRIGGER_PAYLOAD_TITLE).toBe("Outage");
  });

  it("returns a non-success result with the runner's exit code", async () => {
    const runner = makeShellRunner({
      exitCode: 2,
      stdout: "",
      stderr: "boom",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/exited with code 2/);
    expect(result.error).toMatch(/boom/);
    const artifact = result.artifact as ShellResultArtifact;
    expect(artifact.exitCode).toBe(2);
    expect(artifact.timedOut).toBe(false);
  });

  it("falls back to stdout in the error message when stderr is empty", async () => {
    const runner = makeShellRunner({
      exitCode: 1,
      stdout: "useful stdout error",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/useful stdout error/);
  });

  it("truncates a long stderr snippet in the error message to 500 chars", async () => {
    const big = "x".repeat(2_000);
    const runner = makeShellRunner({
      exitCode: 1,
      stdout: "",
      stderr: big,
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/exited with code 1/);
    expect(result.error!.length).toBeLessThanOrEqual(
      "Shell script exited with code 1: ".length + 500,
    );
  });

  it("marks the result as timedOut with exitCode -1 when the runner reports a timeout", async () => {
    const runner = makeShellRunner({
      exitCode: -1,
      stdout: "",
      stderr: "Script execution timed out",
      timedOut: true,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/timed out/i);
    const artifact = result.artifact as ShellResultArtifact;
    expect(artifact.timedOut).toBe(true);
    expect(artifact.exitCode).toBe(-1);
  });

  it("returns an Execution error result when the runner throws", async () => {
    const runner = makeShellRunner(new Error("spawn failed"));
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Execution error/);
    expect(result.error).toMatch(/spawn failed/);
    expect(result.artifact).toBeUndefined();
  });

  it("omits externalId when the script produces no stdout", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBeUndefined();
  });

  it("clips externalId to the first 100 chars of the first stdout line", async () => {
    const long = "a".repeat(250);
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: `${long}\nsecond`,
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe(long.slice(0, 100));
  });
});

// ─── ESM-script action ─────────────────────────────────────────────────────

function makeEsmRunner(
  result: EsmScriptRunResult | Error,
): EsmScriptRunner & { runMock: ReturnType<typeof mock> } {
  const runMock = mock(async (_options: EsmScriptRunOptions) => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { run: runMock, runMock } as EsmScriptRunner & {
    runMock: ReturnType<typeof mock>;
  };
}

const scriptBaseConfig = {
  script: "export default async () => ({ id: 'x' });",
  timeout: 10_000,
};

describe("scriptResultArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = scriptResultArtifactType.schema.safeParse({
      result: { id: "x" },
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a negative durationMs", () => {
    const bad = scriptResultArtifactType.schema.safeParse({
      stdout: "",
      stderr: "",
      durationMs: -1,
      timedOut: false,
    });
    expect(bad.success).toBe(false);
  });
});

describe("integration-script.run_script", () => {
  it("returns success and threads the user return value through the artifact + externalId", async () => {
    const runner = makeEsmRunner({
      result: { id: "ext-42", extra: "info" },
      stdout: "log line",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("ext-42");
    const artifact = result.artifact as ScriptResultArtifact;
    expect(artifact.result).toEqual({ id: "ext-42", extra: "info" });
    expect(artifact.externalId).toBe("ext-42");
    expect(artifact.timedOut).toBe(false);
  });

  it("builds the script context from the run scope (trigger, artifacts, var)", async () => {
    const runner = makeEsmRunner({
      result: {},
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      scope: {
        trigger: {
          id: "incident_created",
          event: "incident.created",
          actor: SYSTEM_ACTOR,
          payload: { title: "Outage" },
        },
        artifacts: { "jira.issue": { key: "OPS-1" } },
        vars: { region: "eu" },
      },
      config: scriptBaseConfig,
    });
    const call = runner.runMock.mock.calls[0]![0] as EsmScriptRunOptions;
    expect(call.context).toMatchObject({
      trigger: { event: "incident.created", payload: { title: "Outage" } },
      artifacts: { "jira.issue": { key: "OPS-1" } },
      var: { region: "eu" },
    });
  });

  it("accepts a numeric id and stringifies it", async () => {
    const runner = makeEsmRunner({
      result: { id: 17 },
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("17");
  });

  it("accepts externalId as an alternative to id", async () => {
    const runner = makeEsmRunner({
      result: { externalId: "alt-1" },
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("alt-1");
  });

  it("omits externalId when the script does not return one", async () => {
    const runner = makeEsmRunner({
      result: { foo: "bar" },
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBeUndefined();
  });

  it("passes script + timeout + helper module name through to the runner", async () => {
    const runner = makeEsmRunner({
      result: undefined,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        script: "export default async () => undefined;",
        timeout: 7_500,
      },
    });
    expect(runner.runMock).toHaveBeenCalledTimes(1);
    const call = runner.runMock.mock.calls[0]![0] as EsmScriptRunOptions;
    expect(call.script).toBe("export default async () => undefined;");
    expect(call.timeoutMs).toBe(7_500);
    expect(call.helperModuleName).toBe("@checkstack/integration");
    expect(call.helperFunctionName).toBe("defineIntegration");
  });

  it("returns a Script error result and includes the captured artifact when the runner reports an error", async () => {
    const runner = makeEsmRunner({
      error: "TypeError: foo is not a function",
      stdout: "ok",
      stderr: "stack...",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Script error/);
    expect(result.error).toMatch(/TypeError/);
    const artifact = result.artifact as ScriptResultArtifact;
    expect(artifact.stdout).toBe("ok");
    expect(artifact.stderr).toBe("stack...");
  });

  it("marks the result as timedOut when the runner reports a timeout", async () => {
    const runner = makeEsmRunner({
      stdout: "",
      stderr: "",
      timedOut: true,
    });
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/timed out/i);
    const artifact = result.artifact as ScriptResultArtifact;
    expect(artifact.timedOut).toBe(true);
  });

  it("returns an Execution error result when the runner throws", async () => {
    const runner = makeEsmRunner(new Error("subprocess crashed"));
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Execution error/);
    expect(result.error).toMatch(/subprocess crashed/);
    expect(result.artifact).toBeUndefined();
  });
});
