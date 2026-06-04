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
  RpcClient,
  ShellScriptRunner,
  ShellScriptRunOptions,
  ShellScriptRunResult,
} from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";

import {
  createSecretResolverService,
  secretResolverRef,
  type SecretStore,
} from "@checkstack/secrets-backend";
import {
  coreServices,
  type ConfigService,
  type ServiceRef,
} from "@checkstack/backend-api";

import {
  createScriptRunAction,
  createShellRunAction,
  scriptResultArtifactType,
  scriptRunAction,
  shellResultArtifactType,
  shellRunAction,
  type ScriptResultArtifact,
  type ShellResultArtifact,
} from "./automations";

/**
 * Build a `getService` that returns a real resolver service over a fake
 * SecretStore, so the action's resolve + inject + mask path is exercised
 * end-to-end. `getService` for any other ref throws (none are used here).
 */
function makeGetService(secrets: Record<string, string>) {
  const store: SecretStore = {
    resolve: async (name) => {
      if (!(name in secrets)) throw new Error(`Secret not found: ${name}`);
      return secrets[name];
    },
  };
  const resolver = createSecretResolverService({ secretStore: store });
  return <T,>(ref: ServiceRef<T>): Promise<T> => {
    if (ref.id === secretResolverRef.id) {
      return Promise.resolve(resolver as unknown as T);
    }
    throw new Error(`Unexpected service: ${ref.id}`);
  };
}

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
  rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
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
    expect(call.helperModuleName).toBe("@checkstack/sdk/integration");
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

describe("script-action secret env injection + masking (leak guard)", () => {
  it("injects only declared secrets into run_script env and masks them out of output", async () => {
    const runner = makeEsmRunner({
      result: { token: "gh_injectedSecret999" },
      stdout: "echo gh_injectedSecret999",
      stderr: "warn gh_injectedSecret999",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      getService: makeGetService({ jira_token: "gh_injectedSecret999" }),
      consumedArtifacts: {},
      config: {
        ...scriptBaseConfig,
        secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Only the declared secret was injected into the runner env.
    expect(runner.runMock).toHaveBeenCalledTimes(1);
    const runArgs = runner.runMock.mock.calls[0][0] as EsmScriptRunOptions;
    expect(runArgs.env).toEqual({ API_TOKEN: "gh_injectedSecret999" });
    // Its value is redacted from the captured output + return value.
    const artifact = result.artifact as ScriptResultArtifact;
    expect(artifact.stdout).toBe("echo ****");
    expect(artifact.stderr).toBe("warn ****");
    expect(artifact.result).toEqual({ token: "****" });
    expect(JSON.stringify(artifact)).not.toContain("gh_injectedSecret999");
  });

  it("injects declared secrets into run_shell env and masks them out", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "printing db-password-456",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      getService: makeGetService({ db_pass: "db-password-456" }),
      consumedArtifacts: {},
      config: {
        ...shellBaseConfig,
        secretEnv: { DB_PASSWORD: "${{ secrets.db_pass }}" },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const runArgs = runner.runMock.mock.calls[0][0] as ShellScriptRunOptions;
    expect(runArgs.env?.DB_PASSWORD).toBe("db-password-456");
    const artifact = result.artifact as ShellResultArtifact;
    expect(artifact.stdout).toBe("printing ****");
    expect(JSON.stringify(artifact)).not.toContain("db-password-456");
  });

  it("does NOT resolve or inject any secret when none is declared (least-privilege)", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "no secrets here",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      // A resolver IS available, but with no secretEnv it must never be
      // called — an undeclared secret is not reachable by the run.
      getService: makeGetService({ db_pass: "db-password-456" }),
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const runArgs = runner.runMock.mock.calls[0][0] as ShellScriptRunOptions;
    expect(runArgs.env?.DB_PASSWORD).toBeUndefined();
    const artifact = result.artifact as ShellResultArtifact;
    expect(artifact.stdout).toBe("no secrets here");
  });

  it("fails the run clearly when a declared secret cannot be resolved", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "should not run",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    const result = await action.execute({
      ...ctxBase,
      getService: makeGetService({}), // store has no secrets
      consumedArtifacts: {},
      config: {
        ...shellBaseConfig,
        secretEnv: { DB_PASSWORD: "${{ secrets.missing }}" },
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Secret error/);
    expect(runner.runMock).not.toHaveBeenCalled();
  });
});

// ─── Sandbox global default + downgrade surfacing (Phase 4) ─────────────────

/**
 * `getService` that serves BOTH the secret resolver and a fake (in-memory,
 * shared-Postgres-shaped) ConfigService, so the action's global-default read +
 * merge path is exercised end-to-end.
 */
function makeGetServiceWithConfig({
  secrets = {},
  store = new Map<string, unknown>(),
}: {
  secrets?: Record<string, string>;
  store?: Map<string, unknown>;
}) {
  const secretStore: SecretStore = {
    resolve: async (name) => {
      if (!(name in secrets)) throw new Error(`Secret not found: ${name}`);
      return secrets[name];
    },
  };
  const resolver = createSecretResolverService({ secretStore });
  const configService: ConfigService = {
    set: async (configId, _schema, _version, data) => {
      store.set(configId, data);
    },
    get: async (configId) =>
      store.has(configId) ? store.get(configId) : undefined,
    getRedacted: async () => undefined,
    delete: async (configId) => {
      store.delete(configId);
    },
    list: async () => [...store.keys()],
  } as ConfigService;
  return <T,>(ref: ServiceRef<T>): Promise<T> => {
    if (ref.id === secretResolverRef.id) {
      return Promise.resolve(resolver as unknown as T);
    }
    if (ref.id === coreServices.config.id) {
      return Promise.resolve(configService as unknown as T);
    }
    throw new Error(`Unexpected service: ${ref.id}`);
  };
}

describe("run_shell — global-only sandbox (no per-item override)", () => {
  it("never passes a `sandbox` option to the runner (policy is global-only)", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    await action.execute({
      ...ctxBase,
      getService: makeGetServiceWithConfig({ store: new Map() }),
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    // Read the raw call arg untyped: the runner type no longer HAS a `sandbox`
    // field (compile-time guarantee), so assert it is absent at runtime too.
    const passed: Record<string, unknown> = runner.runMock.mock.calls[0]?.[0];
    // The runner resolves the GLOBAL policy itself; the action must not pass one.
    expect("sandbox" in passed).toBe(false);
  });

  it("tolerates a stored stray `config.sandbox` (migration: stripped, no crash)", async () => {
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    });
    const action = createShellRunAction({ runner });
    // Parse an old stored config that still carries a `sandbox` key. The schema
    // strips unknown keys, so the parsed config has no `sandbox`.
    const parsed = await action.config.parse({
      version: 1,
      data: {
        ...shellBaseConfig,
        sandbox: { network: { mode: "unrestricted" } },
      },
    });
    expect(Object.keys(parsed)).not.toContain("sandbox");
    await action.execute({
      ...ctxBase,
      getService: makeGetServiceWithConfig({ store: new Map() }),
      consumedArtifacts: {},
      config: parsed,
    });
    const passed: Record<string, unknown> = runner.runMock.mock.calls[0]?.[0];
    expect("sandbox" in passed).toBe(false);
  });

  it("surfaces a per-run downgrade through the logger (degrade-surfaces-never-hides)", async () => {
    const warnLogger = createMockLogger() as Logger;
    const runner = makeShellRunner({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      sandbox: {
        requested: {
          enabled: true,
          onUnavailable: "degrade",
          resources: {},
          filesystem: { mode: "scratch-plus-ro" },
          network: { mode: "unrestricted", allow: [], denyLinkLocalAndMetadata: true },
          privilege: { mode: "inherit" },
        },
        enforced: {
          resources: true,
          filesystem: false,
          network: false,
          privilege: true,
        },
        downgrades: [
          { layer: "filesystem", reason: "no wrapper on this host" },
        ],
        notes: [],
        platform: "darwin",
      },
    });
    const action = createShellRunAction({ runner });
    await action.execute({
      ...ctxBase,
      logger: warnLogger,
      getService: makeGetServiceWithConfig({ store: new Map() }),
      consumedArtifacts: {},
      config: shellBaseConfig,
    });
    const warnMock = warnLogger.warn as unknown as ReturnType<typeof mock>;
    const warned = warnMock.mock.calls.some((c) =>
      String(c[0]).includes("script sandbox degraded"),
    );
    expect(warned).toBe(true);
  });
});

describe("run_script — global-only sandbox (no per-item override)", () => {
  it("never passes a `sandbox` option to the runner (policy is global-only)", async () => {
    const runner = makeEsmRunner({
      result: { id: "x" },
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    await action.execute({
      ...ctxBase,
      getService: makeGetServiceWithConfig({ store: new Map() }),
      consumedArtifacts: {},
      config: scriptBaseConfig,
    });
    const passed: Record<string, unknown> = runner.runMock.mock.calls[0]?.[0];
    expect("sandbox" in passed).toBe(false);
  });

  it("tolerates a stored stray `config.sandbox` (migration: stripped, no crash)", async () => {
    const runner = makeEsmRunner({
      result: { id: "x" },
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const action = createScriptRunAction({ runner });
    const parsed = await action.config.parse({
      version: 1,
      data: {
        ...scriptBaseConfig,
        sandbox: { enabled: false },
      },
    });
    expect(Object.keys(parsed)).not.toContain("sandbox");
    await action.execute({
      ...ctxBase,
      getService: makeGetServiceWithConfig({ store: new Map() }),
      consumedArtifacts: {},
      config: parsed,
    });
    const passed: Record<string, unknown> = runner.runMock.mock.calls[0]?.[0];
    expect("sandbox" in passed).toBe(false);
  });
});

// ─── Editor-path migrate-then-validate (the reported bug) ──────────────────

describe("script-action config migrate-then-validate (editor path)", () => {
  it("run_script: a stored config with a removed `sandbox` key validates clean (no Unrecognized key)", async () => {
    // `parseStrictAssumingV1` is exactly what the automation editor's
    // deep validator runs per action. Before the v1->v2 drop migration this
    // surfaced "config: Unrecognized key: sandbox" in the editor.
    const stored = { ...scriptBaseConfig, sandbox: { enabled: false } };
    const result = await scriptRunAction.config.parseStrictAssumingV1(stored);
    expect(Object.keys(result)).not.toContain("sandbox");
    expect(result.script).toBe(scriptBaseConfig.script);
  });

  it("run_shell: a stored config with a removed `sandbox` key validates clean", async () => {
    const stored = { ...shellBaseConfig, sandbox: { enabled: false } };
    const result = await shellRunAction.config.parseStrictAssumingV1(stored);
    expect(Object.keys(result)).not.toContain("sandbox");
    expect(result.script).toBe(shellBaseConfig.script);
  });

  it("run_script: a fresh config without `sandbox` is unchanged (idempotent)", async () => {
    const result = await scriptRunAction.config.parseStrictAssumingV1(
      scriptBaseConfig,
    );
    expect(result.script).toBe(scriptBaseConfig.script);
  });

  it("run_script: a genuine typo the migration does NOT account for still rejects (strict)", async () => {
    await expect(
      scriptRunAction.config.parseStrictAssumingV1({
        ...scriptBaseConfig,
        timoeut: 5_000,
      }),
    ).rejects.toThrow();
  });
});

// ─── Migration-chain contract (zero-upkeep guardrail) ──────────────────────

describe("script-action config migration-chain contract", () => {
  it("run_script + run_shell configs have a complete v1->version chain", () => {
    for (const action of [scriptRunAction, shellRunAction]) {
      const problem = action.config.validateMigrationChainFromV1();
      expect(
        problem,
        `Action "${action.id}" config (version ${action.config.version}) has a broken migration chain: ${problem}`,
      ).toBeUndefined();
    }
  });
});
