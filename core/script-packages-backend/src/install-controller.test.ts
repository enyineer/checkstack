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
 * Installer-election lock fake. When `lockAcquired` it hands back a handle
 * whose `release()` records "released" into `calls` (so tests can assert the
 * lock is always freed); otherwise `tryInstallerLock` returns null.
 */
function fakeInstallerLock(
  calls: string[],
  lockAcquired = true,
): InstallerLock {
  return {
    tryInstallerLock: async () =>
      lockAcquired
        ? { release: async () => void calls.push("released") }
        : null,
  };
}

function baseDeps(
  overrides: Partial<InstallControllerDeps> = {},
): { deps: InstallControllerDeps; emitted: string[]; stateCalls: string[] } {
  const emitted: string[] = [];
  const { store, calls } = fakeState();
  const deps: InstallControllerDeps = {
    installState: store,
    installerLock: fakeInstallerLock(calls),
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
    const { deps } = baseDeps({
      installerLock: fakeInstallerLock([], false),
    });
    deps.emitChanged = async ({ lockfileHash }) =>
      void emitted.push(lockfileHash);
    const out = await runInstallNow(deps);
    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/another instance/i);
    expect(emitted).toHaveLength(0);
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
