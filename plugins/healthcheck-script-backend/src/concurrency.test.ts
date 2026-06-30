import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InlineScriptCollector } from "./inline-script-collector";
import { ScriptHealthCheckStrategy } from "./strategy";
import type { ScriptTransportClient } from "./transport-client";

/**
 * Concurrency + cleanup guarantees.
 *
 * These tests are slower than the unit tests (each spawns 20+ subprocesses)
 * but they're the only place where we exercise the actual isolation
 * properties — that two parallel inline scripts can't read each other's
 * temp files, and that the temp-dir count returns to baseline once
 * everything completes (i.e. nothing leaks on success, failure, or timeout).
 */

const PARALLELISM = 20;
const TMP_PREFIX = "checkstack-script-";

/**
 * Create a throwaway base dir and a collector whose per-run scratch dirs are
 * created *inside* it (via `resolutionRoot`). This isolates the leak check
 * from every other test file that also spawns scripts into the shared
 * `os.tmpdir()` — the main source of cross-file flakes. Returns the base dir
 * (caller removes it) plus a `countLeaked()` that only counts dirs under it.
 */
async function isolatedScope(): Promise<{
  collector: InlineScriptCollector;
  countLeaked: () => Promise<number>;
  cleanup: () => Promise<void>;
}> {
  const base = await mkdtemp(join(tmpdir(), "cs-concurrency-test-"));
  const collector = new InlineScriptCollector(
    undefined,
    () => Promise.resolve({ mode: "ready" as const, root: base }),
  );
  return {
    collector,
    countLeaked: async () =>
      (await readdir(base)).filter((n) => n.startsWith(TMP_PREFIX)).length,
    cleanup: async () => {
      await rm(base, { recursive: true, force: true });
    },
  };
}

const mockClient: ScriptTransportClient = {
  exec: async () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
  }),
};

describe("inline-script concurrency", () => {
  it("isolates parallel runs — each sees its own `context.config`", async () => {
    // Each script reads its own config.value via `context.config.value` and
    // returns it. If isolation is broken (two scripts share a tmp dir, env,
    // or the same runner file by accident), we'd see crossed values here.
    const collector = new InlineScriptCollector();

    const runs = Array.from({ length: PARALLELISM }, (_, i) => i);

    const results = await Promise.all(
      runs.map(async (i) => {
        const res = await collector.execute({
          // The config carries the index; the script returns it via `value`.
          config: {
            // @ts-expect-error — we deliberately pass an extra prop the
            // schema doesn't know about; the runner serialises the whole
            // config object as `context.config`, so the script can read it.
            value: i,
            script: `
              // @ts-ignore — context is injected at runtime
              export default { success: true, value: context.config.value };
            `,
            timeout: 30_000,
          },
          client: mockClient,
          pluginId: "concurrency-test",
        });
        return res.result.value;
      }),
    );

    // Each run should have returned its own index — no crossed wires.
    expect(results.sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(runs);
  }, 60_000);

  it("cleans up temp dirs even when scripts throw", async () => {
    const { collector, countLeaked, cleanup } = await isolatedScope();
    const before = await countLeaked();

    await Promise.all(
      Array.from({ length: PARALLELISM }, () =>
        collector.execute({
          config: {
            // Mix of throwing and successful scripts to exercise both paths.
            script: `
              if (Math.random() > 0.5) throw new Error("boom");
              export default { success: true };
            `,
            timeout: 30_000,
          },
          client: mockClient,
          pluginId: "concurrency-test",
        }),
      ),
    );

    const after = await countLeaked();
    expect(after).toBe(before);
    await cleanup();
  }, 60_000);

  it("cleans up temp dirs when scripts time out", async () => {
    const { collector, countLeaked, cleanup } = await isolatedScope();
    const before = await countLeaked();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        collector.execute({
          config: {
            script: `await new Promise((r) => setTimeout(r, 60_000));`,
            timeout: 1000,
          },
          client: mockClient,
          pluginId: "concurrency-test",
        }),
      ),
    );

    // Give the OS a moment to actually reap the killed subprocesses before
    // we check; rm runs synchronously after each .execute() resolves, but
    // the kernel can be slow to drop fds on macOS.
    await new Promise((r) => setTimeout(r, 100));

    const after = await countLeaked();
    expect(after).toBe(before);
    await cleanup();
  }, 30_000);
});

describe("shell-script concurrency", () => {
  it("isolates parallel runs — each sees its own arguments via env", async () => {
    // No temp file involvement on the shell path, so this test just
    // exercises the spawn-per-call guarantee. Each script echoes the
    // value of its own MY_RUN env var; we check no crossed values.
    const strategy = new ScriptHealthCheckStrategy();
    const connected = await strategy.createClient({ timeout: 5000 });

    const runs = Array.from({ length: PARALLELISM }, (_, i) => i);

    const results = await Promise.all(
      runs.map((i) =>
        connected.client.exec({
          script: 'printf "%s" "$MY_RUN"',
          env: { MY_RUN: String(i) },
          timeout: 5000,
        }),
      ),
    );

    connected.close();

    const seen = results.map((r) => Number.parseInt(r.stdout, 10));
    expect(seen.sort((a, b) => a - b)).toEqual(runs);
  }, 60_000);
});
