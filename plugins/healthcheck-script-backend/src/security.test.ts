import { describe, expect, it } from "bun:test";
import { ScriptHealthCheckStrategy } from "./strategy";

describe("ScriptHealthCheckStrategy Security", () => {
  it("should not leak sensitive environment variables to child process", async () => {
    process.env.TEST_SECRET_KEY = "SUPER_SECRET_KEY_DO_NOT_LEAK";

    const strategy = new ScriptHealthCheckStrategy();
    const connectedClient = await strategy.createClient({ timeout: 5000 });

    const result = await connectedClient.client.exec({
      script: "env",
      timeout: 5000,
    });

    connectedClient.close();

    delete process.env.TEST_SECRET_KEY;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("SUPER_SECRET_KEY_DO_NOT_LEAK");
    // Sanity: at least PATH/HOME should still be forwarded from the whitelist.
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("runs a real shell script with pipes, conditionals, and awk", async () => {
    // This was the original regression that motivated switching to `sh -c`:
    // previously the entire shell expression was passed to spawn() as the
    // literal argv[0] and failed with ENOENT. With `sh -c`, the shell parses
    // the whole thing — pipes and awk included.
    const strategy = new ScriptHealthCheckStrategy();
    const connectedClient = await strategy.createClient({ timeout: 5000 });

    const result = await connectedClient.client.exec({
      script:
        "printf '0.42 0.50 0.60\\n' | awk '{ print $1 }' | awk -v t=0.60 '{ if ($1+0 > t) exit 1; else print \"load_ok=\"$1 }'",
      timeout: 5000,
    });

    connectedClient.close();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("load_ok=0.42");
    expect(result.timedOut).toBe(false);
  });

  it("the starter template's load-average extraction runs on the current OS", async () => {
    // Regression guard: the previous starter used `awk '{print $1}'
    // /proc/loadavg`, which only exists on Linux. macOS satellites
    // failed with "awk: can't open file /proc/loadavg". The current
    // starter uses `uptime` instead so it runs everywhere we deploy.
    //
    // This test executes the same pipeline the starter uses and just
    // asserts a numeric float comes out. Don't compare to a specific
    // value — load on the test runner is whatever it is.
    const strategy = new ScriptHealthCheckStrategy();
    const connectedClient = await strategy.createClient({ timeout: 5000 });

    const result = await connectedClient.client.exec({
      script:
        "uptime | sed 's/.*load average[s]*: //' | awk '{ print $1 }' | tr -d ','",
      timeout: 5000,
    });

    connectedClient.close();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+(\.\d+)?$/);
    expect(result.timedOut).toBe(false);
  });

  it("propagates non-zero exit codes from the user's script", async () => {
    const strategy = new ScriptHealthCheckStrategy();
    const connectedClient = await strategy.createClient({ timeout: 5000 });

    const result = await connectedClient.client.exec({
      script: "echo 'load too high' && exit 1",
      timeout: 5000,
    });

    connectedClient.close();

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("load too high");
  });
});
