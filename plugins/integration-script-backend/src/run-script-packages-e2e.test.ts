import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  performInstall,
  createCentralResolver,
  reconcileToHash,
  createReconcileFsDeps,
  resolveResolutionRootFromStore,
  type BlobIndex,
} from "@checkstack/script-packages-backend";
import { createScriptRunAction, type ScriptRunConfig } from "./automations";

const noopLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

/** Minimal execution context for exercising the action's `execute` directly. */
function execCtx(config: ScriptRunConfig) {
  return {
    config,
    logger: noopLogger,
    runId: "run-1",
    automationId: "auto-1",
    contextKey: null,
    consumedArtifacts: {},
    getService: async () => {
      throw new Error("getService not available in test");
    },
  } as unknown as Parameters<
    ReturnType<typeof createScriptRunAction>["execute"]
  >[0];
}

/**
 * THE proof that Feature 1 actually works end-to-end through the REAL
 * action execute path (not just a runner unit test):
 *
 *   resolve+install leftpad -> publish blobs -> reconcile (materialize the
 *   tree into <store>/current) -> a `run_script` action whose
 *   getResolutionRoot points at that store -> the user script
 *   `import leftpad from "leftpad"` succeeds via `execute()`.
 *
 * Network is touched once (the central resolve), so it's opt-in:
 * `CHECKSTACK_E2E_NETWORK=1 bun test`.
 */
const E2E_ENABLED = process.env.CHECKSTACK_E2E_NETWORK === "1";

describe.skipIf(!E2E_ENABLED)("run_script + npm packages (real action path)", () => {
  let work: string;
  const blobs = new Map<string, Uint8Array>();

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-action-e2e-"));
  });
  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test(
    "an allowlisted package imports successfully through execute()",
    async () => {
      // 1. Resolve + publish (central).
      const resolver = createCentralResolver({
        scratchDir: path.join(work, "scratch"),
        cacheDir: path.join(work, "cache"),
        registry: {
          registryUrl: "https://registry.npmjs.org/",
          scopedRegistries: [],
        },
      });
      const index: BlobIndex = { record: async () => {} };
      const blobStore = {
        id: "memory",
        has: async ({ integrity }: { integrity: string }) => blobs.has(integrity),
        put: async ({ integrity, bytes }: { integrity: string; bytes: Uint8Array }) => {
          blobs.set(integrity, bytes);
        },
      };
      const install = await performInstall({
        packages: [{ name: "leftpad", version: "0.0.1", enabled: true }],
        ignoreScripts: true,
        resolver,
        blobStore,
        blobIndex: index,
      });

      // 2. Reconcile into a host store (materializes <store>/current).
      const storeRoot = path.join(work, "store");
      await reconcileToHash({
        lockfileHash: install.lockfileHash,
        manifest: install.manifest,
        deps: createReconcileFsDeps({
          storeRoot,
          fetchBlob: async ({ integrity }) => {
            const bytes = blobs.get(integrity);
            if (!bytes) throw new Error(`missing blob ${integrity}`);
            return bytes;
          },
        }),
      });

      // 3. The REAL action, wired exactly like the plugin wires it.
      const action = createScriptRunAction({
        getResolutionRoot: () => resolveResolutionRootFromStore(storeRoot),
      });

      const result = await action.execute(
        execCtx({
          script: `import leftpad from "leftpad";\nexport default { id: leftpad("7", 3) };`,
          timeout: 20_000,
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.artifact?.result).toEqual({ id: "007" });
      }
    },
    60_000,
  );
});

describe("run_script degradation (no network)", () => {
  test("fails with a clear error when packages are configured but not synced", async () => {
    const action = createScriptRunAction({
      // notReady status -> the action should refuse to run.
      getResolutionRoot: async () => ({
        mode: "notReady",
        reason: "npm packages not ready on this central backend",
      }),
    });
    const result = await action.execute(
      execCtx({ script: `export default { id: "x" };`, timeout: 5_000 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not ready");
    }
  });

  test("runs normally (no resolution root) when no packages are configured", async () => {
    const action = createScriptRunAction({
      getResolutionRoot: async () => ({ mode: "none" }),
    });
    const result = await action.execute(
      execCtx({ script: `export default { id: "plain" };`, timeout: 10_000 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.artifact?.result).toEqual({ id: "plain" });
    }
  });
});
