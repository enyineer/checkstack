import { describe, expect, it } from "bun:test";
import { ScriptHealthCheckStrategy } from "./strategy";

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
