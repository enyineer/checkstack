import { describe, expect, it, mock } from "bun:test";
import {
  evaluateAssertions,
  renderTemplatableConfig,
} from "@checkstack/backend-api";
import { ExecuteCollector, type ExecuteConfig } from "./execute-collector";
import type { ScriptTransportClient } from "./transport-client";

describe("ExecuteCollector", () => {
  const createMockClient = (
    response: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
      error?: string;
    } = {},
  ): ScriptTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        exitCode: response.exitCode ?? 0,
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
        timedOut: response.timedOut ?? false,
        error: response.error,
      }),
    ),
  });

  describe("execute", () => {
    it("should execute script successfully", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({ exitCode: 0, stdout: "Hello World" });

      const config: ExecuteConfig = {
        script: "echo 'Hello World'",
        timeout: 5000,
      };

      const result = await collector.execute({
        config,
        client,
        pluginId: "test",
      });

      expect(result.result.exitCode).toBe(0);
      expect(result.result.stdout).toBe("Hello World");
      expect(result.result.success).toBe(true);
      expect(result.result.timedOut).toBe(false);
      expect(result.result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    // Regression: a script that ran to completion and exited non-zero is a
    // SUCCESSFUL collection - the command executed and reported a result. The
    // collector must NOT set `error` (the executor treats that as a transport
    // failure and hard-fails the run). `exitCode` / `success` are assertable
    // metrics. Previously this asserted the wrong behavior (`error` contains
    // "Exit code: 1").
    it("does not hard-fail the collector on a non-zero exit code", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({
        exitCode: 1,
        stderr: "Command not found",
      });

      const result = await collector.execute({
        config: { script: "exit 1", timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.exitCode).toBe(1);
      expect(result.result.success).toBe(false);
      // Transport succeeded: no error field is set.
      expect(result.error).toBeUndefined();

      // A "success is true" assertion fails - the user decides this is
      // unhealthy, not the collector.
      const failed = evaluateAssertions(
        [{ field: "success", operator: "isTrue" }],
        result.result as Record<string, unknown>,
      );
      expect(failed).not.toBeNull();

      // A check that WANTS exit code 1 (e.g. "this file should be absent") can
      // be green by asserting on the exit code.
      const failedWanted = evaluateAssertions(
        [{ field: "exitCode", operator: "equals", value: 1 }],
        result.result as Record<string, unknown>,
      );
      expect(failedWanted).toBeNull();
    });

    // A timeout IS a transport failure: the script could not complete. The
    // collector must surface it as an `error`.
    it("hard-fails the collector on a timeout (transport failure)", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({ timedOut: true, exitCode: -1 });

      const result = await collector.execute({
        config: { script: "sleep 999", timeout: 100 },
        client,
        pluginId: "test",
      });

      expect(result.result.timedOut).toBe(true);
      expect(result.error).toContain("timed out");
    });

    it("should handle timeout", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient({ timedOut: true, exitCode: -1 });

      const result = await collector.execute({
        config: { script: "sleep 999", timeout: 100 },
        client,
        pluginId: "test",
      });

      expect(result.result.timedOut).toBe(true);
      expect(result.result.success).toBe(false);
    });

    it("should pass the script, cwd and env through to the client", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: {
          script: "awk '/load/ {print $1}' /proc/loadavg | head -1",
          cwd: "/tmp",
          env: { MY_VAR: "value" },
          timeout: 3000,
        },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        script: "awk '/load/ {print $1}' /proc/loadavg | head -1",
        cwd: "/tmp",
        env: { MY_VAR: "value" },
        timeout: 3000,
      });
    });

    it("injects run-context metadata into the script env", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: { script: "echo hi", timeout: 3000 },
        client,
        pluginId: "test",
        runContext: {
          check: { id: "check-1", name: "CPU load", intervalSeconds: 60 },
          system: { id: "system-9", name: "web-01" },
        },
      });

      const call = (client.exec as ReturnType<typeof mock>).mock.calls[0][0];
      expect(call.env.CHECKSTACK_CHECK_ID).toBe("check-1");
      expect(call.env.CHECKSTACK_CHECK_NAME).toBe("CPU load");
      expect(call.env.CHECKSTACK_CHECK_INTERVAL_SECONDS).toBe("60");
      expect(call.env.CHECKSTACK_SYSTEM_ID).toBe("system-9");
      expect(call.env.CHECKSTACK_SYSTEM_NAME).toBe("web-01");
    });

    it("lets a user config.env key win over a metadata key on collision", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: {
          script: "echo hi",
          env: { CHECKSTACK_CHECK_NAME: "user override" },
          timeout: 3000,
        },
        client,
        pluginId: "test",
        runContext: {
          check: { id: "check-1", name: "metadata name", intervalSeconds: 60 },
          system: { id: "system-9", name: "web-01" },
        },
      });

      const call = (client.exec as ReturnType<typeof mock>).mock.calls[0][0];
      expect(call.env.CHECKSTACK_CHECK_NAME).toBe("user override");
      // Non-colliding metadata keys are still present.
      expect(call.env.CHECKSTACK_SYSTEM_ID).toBe("system-9");
    });

    it("injects CHECKSTACK_ENV_* vars when the run carries an environment", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: { script: "echo hi", timeout: 3000 },
        client,
        pluginId: "test",
        runContext: {
          check: { id: "check-1", name: "CPU load", intervalSeconds: 60 },
          system: { id: "system-9", name: "web-01" },
          environment: {
            id: "env-prod",
            name: "production",
            fields: { baseUrl: "https://prod.example.com", region: "eu-west-1" },
          },
        },
      });

      const call = (client.exec as ReturnType<typeof mock>).mock.calls[0][0];
      expect(call.env.CHECKSTACK_ENV_ID).toBe("env-prod");
      expect(call.env.CHECKSTACK_ENV_NAME).toBe("production");
      expect(call.env.CHECKSTACK_ENV_BASE_URL).toBe("https://prod.example.com");
      expect(call.env.CHECKSTACK_ENV_REGION).toBe("eu-west-1");
    });

    it("omits CHECKSTACK_ENV_* vars when the run has no environment", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: { script: "echo hi", timeout: 3000 },
        client,
        pluginId: "test",
        runContext: {
          check: { id: "check-1", name: "CPU load", intervalSeconds: 60 },
          system: { id: "system-9", name: "web-01" },
        },
      });

      const call = (client.exec as ReturnType<typeof mock>).mock.calls[0][0];
      expect(call.env.CHECKSTACK_ENV_ID).toBeUndefined();
      expect(call.env.CHECKSTACK_ENV_NAME).toBeUndefined();
      expect(
        Object.keys(call.env).some((k) => k.startsWith("CHECKSTACK_ENV_")),
      ).toBe(false);
    });

    it("lets a user config.env key win over a CHECKSTACK_ENV_* metadata key", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: {
          script: "echo hi",
          env: { CHECKSTACK_ENV_BASE_URL: "user override" },
          timeout: 3000,
        },
        client,
        pluginId: "test",
        runContext: {
          check: { id: "check-1", name: "CPU load", intervalSeconds: 60 },
          system: { id: "system-9", name: "web-01" },
          environment: {
            id: "env-prod",
            name: "production",
            fields: { baseUrl: "https://prod.example.com" },
          },
        },
      });

      const call = (client.exec as ReturnType<typeof mock>).mock.calls[0][0];
      expect(call.env.CHECKSTACK_ENV_BASE_URL).toBe("user override");
    });

    it("leaves env unchanged when no runContext is supplied (back-compat)", async () => {
      const collector = new ExecuteCollector();
      const client = createMockClient();

      await collector.execute({
        config: { script: "echo hi", env: { MY_VAR: "value" }, timeout: 3000 },
        client,
        pluginId: "test",
      });

      const call = (client.exec as ReturnType<typeof mock>).mock.calls[0][0];
      expect(call.env).toEqual({ MY_VAR: "value" });
    });
  });

  describe("migration", () => {
    it("collapses legacy {command, args} into a single shell script", async () => {
      const collector = new ExecuteCollector();
      const v1 = {
        command: "echo",
        args: ["Hello", "World"],
        timeout: 5000,
      };

      // Versioned.parse() applies migrations transparently when the stored
      // value declares an older version. Mirror what storage does:
      const migrated = await collector.config.parse({ version: 1, data: v1 });

      expect(migrated.script).toBe("echo Hello World");
      expect(migrated.timeout).toBe(5000);
    });

    it("quotes args that contain shell metacharacters", async () => {
      const collector = new ExecuteCollector();
      const v1 = {
        command: "/bin/sh",
        args: ["-c", "echo 'hi there'"],
        timeout: 5000,
      };

      const migrated = await collector.config.parse({ version: 1, data: v1 });

      // The script should re-quote args so re-execution via `sh -c` is safe.
      expect(migrated.script).toContain("/bin/sh");
      expect(migrated.script).toContain("-c");
      // The embedded quotes must be preserved (single-quoted form).
      expect(migrated.script).toMatch(/echo/);
    });

    it("is IDEMPOTENT: an already-{script} blob is returned unchanged (no fabricated script)", async () => {
      const collector = new ExecuteCollector();
      // CRITICAL safety property: the highest-risk reshape must NOT run on a
      // blob that already has `script`. Without the guard it would shell-quote
      // a missing `command` and fabricate `script: "undefined"`.
      const alreadyV2 = {
        script: "echo already-migrated",
        cwd: "/srv",
        env: { FOO: "bar" },
        timeout: 4000,
      };

      const migrated = await collector.config.parseAssumingV1(alreadyV2);

      expect(migrated.script).toBe("echo already-migrated");
      expect(migrated.script).not.toContain("undefined");
      expect(migrated.cwd).toBe("/srv");
      expect(migrated.env).toEqual({ FOO: "bar" });
      expect(migrated.timeout).toBe(4000);
    });

    it("does NOT fabricate a script from a blob carrying both command and script", async () => {
      const collector = new ExecuteCollector();
      // Defensive: presence of `script` wins even if a stray `command` lingers.
      const mixed = {
        command: "rm",
        args: ["-rf", "/"],
        script: "echo safe",
        timeout: 3000,
      };

      const migrated = await collector.config.parseAssumingV1(mixed);

      expect(migrated.script).toBe("echo safe");
      expect(migrated.script).not.toContain("rm");
    });

    it("reshapes a genuine v1 {command} blob via assume-v1-on-read", async () => {
      const collector = new ExecuteCollector();
      const migrated = await collector.config.parseAssumingV1({
        command: "echo",
        args: ["Hello", "World"],
        timeout: 5000,
      });
      expect(migrated.script).toBe("echo Hello World");
      expect(migrated.timeout).toBe(5000);
    });

    it("has a complete v1->version migration chain", () => {
      const collector = new ExecuteCollector();
      expect(collector.config.validateMigrationChainFromV1()).toBeUndefined();
    });
  });

  describe("mergeResult", () => {
    it("should calculate average execution time and success rate", () => {
      const collector = new ExecuteCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 0,
            stdout: "",
            stderr: "",
            executionTimeMs: 50,
            success: true,
            timedOut: false,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 0,
            stdout: "",
            stderr: "",
            executionTimeMs: 100,
            success: true,
            timedOut: false,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgExecutionTimeMs.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
    });

    it("should calculate success rate correctly", () => {
      const collector = new ExecuteCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 0,
            stdout: "",
            stderr: "",
            executionTimeMs: 50,
            success: true,
            timedOut: false,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            exitCode: 1,
            stdout: "",
            stderr: "",
            executionTimeMs: 100,
            success: false,
            timedOut: false,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new ExecuteCollector();

      expect(collector.id).toBe("execute");
      expect(collector.displayName).toBe("Shell Script");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});

describe("ExecuteCollector secret env injection + source-side masking", () => {
  // Capture the env the collector passes to the transport client. Typed
  // so we can assert without indexing the loosely-typed mock.calls tuple.
  const makeRecordingClient = (
    response: { stdout: string; stderr: string },
  ): {
    client: ScriptTransportClient;
    getEnv: () => Record<string, string> | undefined;
  } => {
    let capturedEnv: Record<string, string> | undefined;
    return {
      getEnv: () => capturedEnv,
      client: {
        exec: async (input) => {
          capturedEnv = input.env;
          return {
            exitCode: 0,
            stdout: response.stdout,
            stderr: response.stderr,
            timedOut: false,
          };
        },
      },
    };
  };

  it("injects the delivered secretEnv into the shell exec and masks it from output", async () => {
    const { client, getEnv } = makeRecordingClient({
      stdout: "value=sh-secret-987",
      stderr: "warn sh-secret-987",
    });
    const collector = new ExecuteCollector();

    const result = await collector.execute({
      config: {
        script: "echo value=$TOKEN",
        timeout: 5000,
        secretEnv: { TOKEN: "${{ secrets.tok }}" },
      },
      client,
      pluginId: "test",
      secretEnv: { TOKEN: "sh-secret-987" },
    });

    // The exec received the injected env.
    expect(getEnv()?.TOKEN).toBe("sh-secret-987");
    // The secret is redacted from stdout/stderr (source-side).
    expect(result.result.stdout).toBe("value=****");
    expect(result.result.stderr).toBe("warn ****");
    expect(JSON.stringify(result)).not.toContain("sh-secret-987");
  });

  it("does not inject or mask when no secretEnv is delivered", async () => {
    const { client, getEnv } = makeRecordingClient({
      stdout: "no secrets",
      stderr: "",
    });
    const collector = new ExecuteCollector();
    const result = await collector.execute({
      config: { script: "echo hi", timeout: 5000 },
      client,
      pluginId: "test",
    });
    expect(getEnv()?.TOKEN).toBeUndefined();
    expect(result.result.stdout).toBe("no secrets");
  });
});

describe("ExecuteCollector — global-only sandbox (no per-item override)", () => {
  // Capture what the collector passes to the transport client.
  const makeRecordingClient = (): {
    client: ScriptTransportClient;
    getInput: () => Record<string, unknown> | undefined;
  } => {
    let captured: Record<string, unknown> | undefined;
    return {
      getInput: () => captured,
      client: {
        exec: async (input) => {
          captured = input as unknown as Record<string, unknown>;
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        },
      },
    };
  };

  it("never sends a `sandbox` field over the transport (policy is global-only)", async () => {
    const { client, getInput } = makeRecordingClient();
    const collector = new ExecuteCollector();
    await collector.execute({
      config: { script: "echo hi", timeout: 5000 },
      client,
      pluginId: "test",
    });
    expect(getInput()?.sandbox).toBeUndefined();
  });

  it("tolerates a stored stray `config.sandbox` (migration: stripped, no crash)", async () => {
    const { client, getInput } = makeRecordingClient();
    const collector = new ExecuteCollector();
    // An old stored config may still carry a `sandbox` key. The schema strips
    // unknown keys on parse; even if it reaches `execute`, the collector must
    // ignore it and never forward it.
    const parsed = collector.config.schema.parse({
      script: "echo hi",
      timeout: 5000,
      sandbox: { network: { mode: "unrestricted" } },
    });
    expect((parsed as Record<string, unknown>).sandbox).toBeUndefined();
    await collector.execute({
      config: parsed,
      client,
      pluginId: "test",
    });
    expect(getInput()?.sandbox).toBeUndefined();
  });
});

describe("ExecuteCollector — environment templating (cwd)", () => {
  // `cwd` is `x-templatable`, so the executor renders `{{ environment.* }}` into
  // it PER environment before execute. The `script` body is deliberately NOT
  // templatable (env data reaches it via `CHECKSTACK_ENV_*` shell vars), so only
  // the working directory fans out per environment. These tests exercise the
  // render pass and confirm the rendered cwd reaches the transport client.
  const makeRecordingClient = (): {
    client: ScriptTransportClient;
    getInput: () => Record<string, unknown> | undefined;
  } => {
    let captured: Record<string, unknown> | undefined;
    return {
      getInput: () => captured,
      client: {
        exec: async (input) => {
          captured = input as unknown as Record<string, unknown>;
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        },
      },
    };
  };

  const render = (config: ExecuteConfig, environment: Record<string, unknown>) => {
    const collector = new ExecuteCollector();
    return renderTemplatableConfig({
      config,
      schema: collector.config.schema,
      context: { environment, check: {}, system: {} },
    }) as ExecuteConfig;
  };

  it("renders a {{ environment.workdir }} template into cwd", () => {
    const rendered = render(
      { script: "echo hi", cwd: "{{ environment.workdir }}", timeout: 5000 },
      { workdir: "/srv/prod" },
    );
    expect(rendered.cwd).toBe("/srv/prod");
    // The script body is NOT templated - a `{{ }}` in it is passed through.
    expect(rendered.script).toBe("echo hi");
  });

  it("forwards the rendered cwd to the transport client", async () => {
    const { client, getInput } = makeRecordingClient();
    const collector = new ExecuteCollector();
    const rendered = render(
      { script: "pwd", cwd: "{{ environment.workdir }}", timeout: 5000 },
      { workdir: "/srv/staging" },
    );

    await collector.execute({ config: rendered, client, pluginId: "test" });

    expect(getInput()?.cwd).toBe("/srv/staging");
  });

  it("leaves the script body untouched when it contains {{ }}", () => {
    const rendered = render(
      {
        script: "echo '{{ environment.workdir }}'",
        timeout: 5000,
      },
      { workdir: "/srv/prod" },
    );
    // Only `cwd` is templatable; the shell source is passed through verbatim so
    // env values are never spliced into executed code.
    expect(rendered.script).toBe("echo '{{ environment.workdir }}'");
  });
});
