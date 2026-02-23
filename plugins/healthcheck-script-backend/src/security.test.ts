import { describe, expect, it } from "bun:test";
import { ScriptHealthCheckStrategy } from "./strategy";
import { InlineScriptCollector } from "./inline-script-collector";
import type { ScriptTransportClient } from "./transport-client";

describe("ScriptHealthCheckStrategy Security", () => {
  it("should not leak sensitive environment variables to child process", async () => {
    // Set a secret in the current process
    process.env.TEST_SECRET_KEY = "SUPER_SECRET_KEY_DO_NOT_LEAK";

    // Use the default strategy which uses the real Bun.spawn
    const strategy = new ScriptHealthCheckStrategy();
    const connectedClient = await strategy.createClient({ timeout: 5000 });

    const result = await connectedClient.client.exec({
      command: "env",
      args: [],
      timeout: 5000,
    });

    connectedClient.close();

    // Cleanup before assertions to be safe
    delete process.env.TEST_SECRET_KEY;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("SUPER_SECRET_KEY_DO_NOT_LEAK");
    // Ensure we still have some environment variables
    // PATH is usually present, but let's check for something else generic or just ensure output is not empty
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});

describe("InlineScriptCollector Security", () => {
  const mockClient: ScriptTransportClient = {
    exec: async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    }),
  };
  const collector = new InlineScriptCollector();

  it("should not leak sensitive environment variables from parent process", async () => {
    // We set a sensitive variable in the current process
    process.env.TEST_SECRET_KEY = "SUPER_SECRET_KEY";

    const config = {
      script: `
        try {
          if (process.env.TEST_SECRET_KEY) {
             return { success: false, message: "LEAKED: " + process.env.TEST_SECRET_KEY };
          }
          return { success: true, message: "SECURE" };
        } catch (e) {
          return { success: false, message: e.message };
        }
      `,
      timeout: 5000,
    };

    const result = await collector.execute({
      config,
      client: mockClient,
      pluginId: "script",
    });

    // Cleanup
    delete process.env.TEST_SECRET_KEY;

    expect(result.result.message).toBe("SECURE");
  });

  it("should run in a separate process (check pid)", async () => {
    const currentPid = process.pid;

    const config = {
      script: `
        return { success: true, value: process.pid };
      `,
      timeout: 5000,
    };

    const result = await collector.execute({
      config,
      client: mockClient,
      pluginId: "script",
    });

    const childPid = result.result.value;
    expect(childPid).not.toBe(currentPid);
    expect(childPid).toBeGreaterThan(0);
  });
});
