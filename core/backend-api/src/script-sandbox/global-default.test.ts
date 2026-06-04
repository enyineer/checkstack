import { describe, expect, it } from "bun:test";
import type { z } from "zod";
import type { ConfigService } from "../config-service";
import type { Migration } from "../config-versioning";
import {
  GLOBAL_SANDBOX_DEFAULT_CONFIG_ID,
  readGlobalSandboxDefault,
  writeGlobalSandboxDefault,
} from "./global-default";
import {
  resolveDefaultSandboxProfile,
  SANDBOX_UID_ENV,
} from "./policy";

/**
 * In-memory ConfigService over a SHARED backing store, simulating the durable
 * Postgres `plugin_configs` table. Two instances built over the SAME `store`
 * stand in for two pods reading the one durable row — the scale-correctness
 * guard (`.claude/rules/state-and-scale.md` Q2: same answer on every pod).
 */
function fakeConfigService(store: Map<string, unknown>): ConfigService {
  return {
    async set<T>(
      configId: string,
      _schema: z.ZodType<T>,
      _version: number,
      data: T,
      _migrations?: Migration<unknown, unknown>[],
    ): Promise<void> {
      store.set(configId, data);
    },
    async get<T>(
      configId: string,
      _schema: z.ZodType<T>,
      _version: number,
      _migrations?: Migration<unknown, unknown>[],
    ): Promise<T | undefined> {
      return store.has(configId) ? (store.get(configId) as T) : undefined;
    },
    async getRedacted<T>(): Promise<Partial<T> | undefined> {
      throw new Error("not used in these tests");
    },
    async delete(configId: string): Promise<void> {
      store.delete(configId);
    },
    async list(): Promise<string[]> {
      return [...store.keys()];
    },
  };
}

describe("readGlobalSandboxDefault", () => {
  it("falls back to the shipped safe default when no row exists (on-by-default holds)", async () => {
    delete process.env[SANDBOX_UID_ENV];
    const configService = fakeConfigService(new Map());
    const policy = await readGlobalSandboxDefault({ configService });
    expect(policy).toEqual(resolveDefaultSandboxProfile());
    expect(policy.enabled).toBe(true);
    expect(policy.filesystem.mode).toBe("scratch-plus-ro");
  });

  it("returns the stored durable policy when present", async () => {
    const store = new Map<string, unknown>();
    const configService = fakeConfigService(store);
    await writeGlobalSandboxDefault({
      configService,
      policy: { enabled: false },
    });
    const policy = await readGlobalSandboxDefault({ configService });
    expect(policy.enabled).toBe(false);
  });
});

describe("global default is shared, not pod-local (scale-correctness)", () => {
  it("a write on one pod is visible identically on another pod", async () => {
    // ONE shared backing store = the durable Postgres row both pods read.
    const store = new Map<string, unknown>();
    const podA = fakeConfigService(store);
    const podB = fakeConfigService(store);

    // Admin configures the global default via pod A.
    const written = await writeGlobalSandboxDefault({
      configService: podA,
      policy: { network: { mode: "deny" }, resources: { cpuSeconds: 30 } },
    });

    // Pod B reads the SAME value (not a pod-local copy / default).
    const onB = await readGlobalSandboxDefault({ configService: podB });
    expect(onB).toEqual(written);
    expect(onB.network.mode).toBe("deny");
    expect(onB.resources.cpuSeconds).toBe(30);
  });

  it("stores under the well-known, stable config id", async () => {
    const store = new Map<string, unknown>();
    const configService = fakeConfigService(store);
    await writeGlobalSandboxDefault({
      configService,
      policy: { enabled: false },
    });
    expect(store.has(GLOBAL_SANDBOX_DEFAULT_CONFIG_ID)).toBe(true);
  });
});

describe("writeGlobalSandboxDefault", () => {
  it("merges a partial input over the safe default before storing", async () => {
    const store = new Map<string, unknown>();
    const configService = fakeConfigService(store);
    const resolved = await writeGlobalSandboxDefault({
      configService,
      policy: { network: { mode: "deny" } },
    });
    expect(resolved.enabled).toBe(true);
    // An unspecified onUnavailable inherits the shipped safe default, which is
    // now fail-closed.
    expect(resolved.onUnavailable).toBe("fail");
    expect(resolved.network.mode).toBe("deny");
  });

  it("a PARTIAL global write does NOT reset the unspecified layers (MINOR fix)", async () => {
    const store = new Map<string, unknown>();
    const configService = fakeConfigService(store);
    // Admin loosens only memory; everything else must keep the safe default,
    // NOT collapse to the bare zod field defaults (filesystem off, etc.).
    const resolved = await writeGlobalSandboxDefault({
      configService,
      policy: { resources: { memoryBytes: 2 * 1024 * 1024 * 1024 } },
    });
    expect(resolved.resources.memoryBytes).toBe(2 * 1024 * 1024 * 1024);
    // Unspecified layers preserved from the safe default profile:
    expect(resolved.filesystem.mode).toBe("scratch-plus-ro");
    expect(resolved.privilege.mode).toBe("drop-to-uid");
    expect(resolved.network.denyLinkLocalAndMetadata).toBe(true);
    // Other resource caps from the default profile are preserved too.
    expect(resolved.resources.cpuSeconds).toBe(60);
  });

  it("a global { enabled: false } persists as a disable while keeping the rest", async () => {
    const store = new Map<string, unknown>();
    const configService = fakeConfigService(store);
    const resolved = await writeGlobalSandboxDefault({
      configService,
      policy: { enabled: false },
    });
    expect(resolved.enabled).toBe(false);
    // The merge keeps the safe default for the (now-inert) layers.
    expect(resolved.filesystem.mode).toBe("scratch-plus-ro");
  });

  it("rejects an invalid policy (bad bounds) instead of persisting garbage", async () => {
    const store = new Map<string, unknown>();
    const configService = fakeConfigService(store);
    await expect(
      writeGlobalSandboxDefault({
        configService,
        policy: { resources: { cpuSeconds: -1 } },
      }),
    ).rejects.toThrow();
    expect(store.size).toBe(0);
  });
});
