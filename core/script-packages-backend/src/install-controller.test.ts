import { describe, expect, test } from "bun:test";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { runInstallNow, type InstallControllerDeps } from "./install-controller";
import type {
  InstallStateStore,
  InstallerLock,
} from "./install-state-store";

const entry: ManifestEntry = { name: "a", version: "1.0.0", integrity: "sha-a" };

function fakeState(): {
  store: InstallStateStore;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    store: {
      load: async () => ({
        status: "idle",
        lockfileHash: null,
        manifest: [],
        totalSizeBytes: 0,
        lastInstalledAt: null,
        errorMessage: null,
      }),
      setInstalling: async () => void calls.push("installing"),
      setReady: async () => void calls.push("ready"),
      setError: async (m) => void calls.push(`error:${m}`),
    },
  };
}

/**
 * SHARED single-token installer-election lock — a faithful in-memory model
 * of the Postgres advisory lock guarding installer election across pods.
 * ONE boolean (`heldBy`) is shared across every caller wired to the same
 * instance, mirroring `advisory-lock.test.ts`'s `heldBy` model:
 *
 *   - `tryInstallerLock` grants ONLY if the token is free; it then binds the
 *     token to the acquiring handle and returns a `release()` that frees it.
 *   - A concurrent caller against the SAME instance gets `null` while held.
 *
 * `calls?.push("released")` records releases so the always-frees invariant
 * stays observable for the single-caller suite.
 */
function makeSharedInstallerLock(calls?: string[]): InstallerLock {
  // `null` = free; otherwise the id of the holding handle.
  const state: { heldBy: number | null } = { heldBy: null };
  let nextHandleId = 0;
  return {
    tryInstallerLock: async () => {
      if (state.heldBy !== null) return null;
      const handleId = nextHandleId++;
      state.heldBy = handleId;
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          // Only the holder frees the shared token (no-op otherwise).
          if (state.heldBy === handleId) state.heldBy = null;
          calls?.push("released");
        },
      };
    },
  };
}

function baseDeps(
  overrides: Partial<InstallControllerDeps> = {},
): { deps: InstallControllerDeps; emitted: string[]; stateCalls: string[] } {
  const emitted: string[] = [];
  const { store, calls } = fakeState();
  const deps: InstallControllerDeps = {
    installState: store,
    installerLock: makeSharedInstallerLock(calls),
    resolver: { resolve: async () => [{ entry, blob: new Uint8Array(10) }] },
    blobStore: {
      id: "postgres",
      has: async () => false,
      put: async () => {},
    },
    blobIndex: { record: async () => {} },
    loadInstallInputs: async () => ({
      packages: [{ name: "a", version: "1.0.0", enabled: true }],
      ignoreScripts: true,
    }),
    sizeCap: async () => ({
      warnBytes: 150 * 1024 * 1024,
      blockBytes: 300 * 1024 * 1024,
    }),
    isMigrationInFlight: async () => false,
    emitChanged: async ({ lockfileHash }) => void emitted.push(lockfileHash),
    ...overrides,
  };
  return { deps, emitted, stateCalls: calls };
}

describe("runInstallNow", () => {
  test("installs, records ready, and emits changed", async () => {
    const { deps, emitted, stateCalls } = baseDeps();
    const out = await runInstallNow(deps);
    expect(out.started).toBe(true);
    expect(stateCalls).toContain("installing");
    expect(stateCalls).toContain("ready");
    expect(stateCalls).toContain("released");
    expect(emitted).toHaveLength(1);
  });

  test("refuses while a storage migration is in flight", async () => {
    const { deps } = baseDeps({ isMigrationInFlight: async () => true });
    const out = await runInstallNow(deps);
    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/migration/i);
  });

  test("refuses when the installer lock is held by another instance", async () => {
    const emitted: string[] = [];
    // Model "another instance holds it": pre-acquire the shared token so the
    // controller's own attempt is refused.
    const sharedLock = makeSharedInstallerLock();
    const held = await sharedLock.tryInstallerLock();
    expect(held).not.toBeNull();
    const { deps } = baseDeps({ installerLock: sharedLock });
    deps.emitChanged = async ({ lockfileHash }) =>
      void emitted.push(lockfileHash);
    const out = await runInstallNow(deps);
    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/another instance/i);
    expect(emitted).toHaveLength(0);
  });

  test("two concurrent installers against the SAME shared lock: exactly one wins", async () => {
    // ── Multi-instance election contention ──
    // One shared single-token lock across BOTH callers (two pods racing
    // `installNow`). Each pod gets its own deps/state, but they contend on
    // the SAME advisory lock — exactly one may proceed.
    const sharedLock = makeSharedInstallerLock();

    // Widen the acquire→install→release window with a real async gap so the
    // loser genuinely attempts acquire while the winner still holds the
    // token (the interleaving that would double-install without a shared
    // lock).
    const slowResolver = {
      resolve: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return [{ entry, blob: new Uint8Array(10) }];
      },
    };

    const a = baseDeps({ installerLock: sharedLock, resolver: slowResolver });
    const b = baseDeps({ installerLock: sharedLock, resolver: slowResolver });

    const [outA, outB] = await Promise.all([
      runInstallNow(a.deps),
      runInstallNow(b.deps),
    ]);

    const started = [outA, outB].filter((o) => o.started);
    const refused = [outA, outB].filter((o) => !o.started);
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toMatch(/another instance/i);

    // The winner recorded installing → ready exactly once; the loser never
    // touched its install state (no installing/ready) and never emitted.
    const winner = outA.started ? a : b;
    const loser = outA.started ? b : a;
    expect(winner.stateCalls.filter((c) => c === "installing")).toHaveLength(1);
    expect(winner.stateCalls.filter((c) => c === "ready")).toHaveLength(1);
    expect(winner.emitted).toHaveLength(1);
    expect(loser.stateCalls).not.toContain("installing");
    expect(loser.stateCalls).not.toContain("ready");
    expect(loser.emitted).toHaveLength(0);
  });

  test("blocks + records error when over the size cap", async () => {
    const { deps, emitted, stateCalls } = baseDeps({
      resolver: {
        resolve: async () => [
          { entry, blob: new Uint8Array(400 * 1024 * 1024) },
        ],
      },
    });
    const out = await runInstallNow(deps);
    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/exceeds/i);
    expect(stateCalls.some((c) => c.startsWith("error:"))).toBe(true);
    expect(stateCalls).toContain("released");
    expect(emitted).toHaveLength(0);
  });

  test("on a thrown install error, persists the message but logs the full stack", async () => {
    const logged: string[] = [];
    const boom = new Error("kaboom");
    const { deps, stateCalls } = baseDeps({
      resolver: {
        resolve: async () => {
          throw boom;
        },
      },
      logger: { debug: () => {}, error: (m) => void logged.push(m) },
    });
    const out = await runInstallNow(deps);

    expect(out.started).toBe(false);
    // The persisted, user-facing install-state message is just the message.
    expect(stateCalls).toContain("error:kaboom");
    // The log carries the full stack so a non-reproducible failure is
    // pinpointable to its throw site (not merely the message).
    expect(logged).toHaveLength(1);
    expect(logged[0]).toBe(`Script package install failed: ${boom.stack}`);
    expect(logged[0]).toContain("install-controller.test");
    expect(stateCalls).toContain("released");
  });

  test("records lockfile history on a successful install", async () => {
    const recorded: string[] = [];
    const { deps } = baseDeps({
      recordHistory: async ({ lockfileHash }) =>
        void recorded.push(lockfileHash),
    });
    const out = await runInstallNow(deps);
    expect(out.started).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  test("a history-record failure does NOT fail an otherwise-successful install", async () => {
    const { deps, emitted } = baseDeps({
      recordHistory: async () => {
        throw new Error("history table missing");
      },
    });
    const out = await runInstallNow(deps);
    expect(out.started).toBe(true);
    // The change hook still fires; the install succeeded.
    expect(emitted).toHaveLength(1);
  });

  test("records error + releases lock on a resolve failure", async () => {
    const { deps, stateCalls } = baseDeps({
      resolver: {
        resolve: async () => {
          throw new Error("registry unreachable");
        },
      },
    });
    const out = await runInstallNow(deps);
    expect(out.started).toBe(false);
    expect(out.reason).toBe("registry unreachable");
    expect(stateCalls.some((c) => c.includes("registry unreachable"))).toBe(
      true,
    );
    expect(stateCalls).toContain("released");
  });
});
