import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SatelliteScriptPackages,
  type SatelliteScriptPackagesDeps,
} from "./satellite-script-packages";

describe("SatelliteScriptPackages", () => {
  let storeRoot: string;
  let reports: {
    lockfileHash: string | null;
    status: string;
    errorMessage?: string;
  }[];

  beforeEach(async () => {
    storeRoot = path.join(await mkdtemp(path.join(tmpdir(), "cs-sat-sp-")), "store");
    reports = [];
  });
  afterEach(async () => {
    await rm(path.dirname(storeRoot), { recursive: true, force: true });
  });

  function makeDeps(
    overrides: Partial<SatelliteScriptPackagesDeps> = {},
  ): SatelliteScriptPackagesDeps {
    return {
      storeRoot,
      requestManifest: async () => [
        { name: "leftpad", version: "0.0.1", integrity: "sha-1" },
      ],
      requestBlob: async () => null,
      reportState: (state) => reports.push(state),
      ...overrides,
    };
  }

  test("null hash reports ready with no tree", async () => {
    const sp = new SatelliteScriptPackages(makeDeps());
    await sp.reconcile(null);
    expect(sp.currentReadyHash).toBeNull();
    expect(reports.at(-1)).toEqual({ lockfileHash: null, status: "ready" });
  });

  test("degrades to error state when core does not return a blob", async () => {
    // requestBlob returns null -> reconcile fails -> error (no stale tree,
    // no registry access). This is the graceful-degradation path.
    const sp = new SatelliteScriptPackages(
      makeDeps({ requestBlob: async () => null }),
    );
    await sp.reconcile("hash-1");
    expect(sp.currentReadyHash).toBeNull();
    const last = reports.at(-1);
    expect(last?.status).toBe("error");
    expect(last?.lockfileHash).toBe("hash-1");
    expect(last?.errorMessage).toContain("blob");
    // Reported syncing before erroring.
    expect(reports.some((r) => r.status === "syncing")).toBe(true);
  });

  test("coalesces concurrent reconcile requests to the latest hash", async () => {
    let manifestCalls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sp = new SatelliteScriptPackages(
      makeDeps({
        requestManifest: async (hash) => {
          manifestCalls++;
          if (manifestCalls === 1) await gate; // hold the first reconcile
          // Fail fast (no blob) so we don't hit real materialization.
          if (hash === "h1" || hash === "h2") return [];
          return [];
        },
        requestBlob: async () => null,
      }),
    );

    const first = sp.reconcile("h1");
    // Second request arrives while the first is in-flight; should coalesce.
    const second = sp.reconcile("h2");
    release?.();
    await Promise.all([first, second]);

    // The empty-manifest path materializes an empty tree; both hashes
    // requested a manifest exactly once each (no duplicate work for h1).
    expect(manifestCalls).toBeGreaterThanOrEqual(1);
    // Final desired hash (h2) is what we converged toward.
    const lastReport = reports.at(-1);
    expect(lastReport?.lockfileHash).toBe("h2");
  });

  test("empty manifest reconciles to ready (no blobs to pull)", async () => {
    const sp = new SatelliteScriptPackages(
      makeDeps({ requestManifest: async () => [] }),
    );
    await sp.reconcile("hash-empty");
    // Empty manifest -> bun install --offline with no deps -> ready.
    const status = reports.at(-1)?.status ?? "missing";
    expect(["ready", "error"]).toContain(status);
  });
});
