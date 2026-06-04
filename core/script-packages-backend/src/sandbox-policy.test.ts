import { describe, expect, it, beforeEach } from "bun:test";
import type { z } from "zod";
import {
  type ConfigService,
  type Migration,
  resolveActiveSandboxPolicy,
  resetSandboxPolicyProvider,
  FAIL_CLOSED_SANDBOX_PROFILE,
  resolveDefaultSandboxProfile,
} from "@checkstack/backend-api";
import {
  createSandboxPolicyService,
  registerScriptPackagesSandboxProvider,
} from "./sandbox-policy";

/**
 * In-memory ConfigService over a SHARED backing store, simulating the durable
 * Postgres `plugin_configs` row owned by the `script-packages` plugin. This is
 * the SINGLE source of truth: the settings-page write and every runner's read
 * go through this one row.
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

describe("createSandboxPolicyService", () => {
  it("read falls back to the shipped safe default when nothing is stored", async () => {
    const service = createSandboxPolicyService({
      configService: fakeConfigService(new Map()),
    });
    const policy = await service.read();
    expect(policy).toEqual(resolveDefaultSandboxProfile());
  });

  it("write persists a partial over the safe default and read returns it", async () => {
    const store = new Map<string, unknown>();
    const service = createSandboxPolicyService({
      configService: fakeConfigService(store),
    });
    const written = await service.write({ network: { mode: "deny" } });
    expect(written.network.mode).toBe("deny");
    // Unspecified layers preserved from the safe default (not re-widened).
    expect(written.filesystem.mode).toBe("scratch-plus-ro");

    const readBack = await service.read();
    expect(readBack).toEqual(written);
  });
});

describe("single source of truth across both script plugins", () => {
  beforeEach(() => {
    resetSandboxPolicyProvider();
  });

  it("both runners resolve the SAME stored row via the one registered provider", async () => {
    // ONE shared store = the single durable row owned by script-packages.
    const store = new Map<string, unknown>();
    const service = createSandboxPolicyService({
      configService: fakeConfigService(store),
    });

    // Admin sets a distinctive policy through the (single) write path.
    await service.write({ resources: { cpuSeconds: 17 } });

    // script-packages registers the ONE process-wide provider.
    registerScriptPackagesSandboxProvider({ service });

    // Whichever script plugin's runner resolves the active policy gets the
    // identical row - there is no second, divergent source.
    const a = await resolveActiveSandboxPolicy();
    const b = await resolveActiveSandboxPolicy();
    expect(a.failedClosed).toBe(false);
    expect(a.policy.resources.cpuSeconds).toBe(17);
    expect(b.policy).toEqual(a.policy);
  });

  it("a provider read error fails closed (does not widen the sandbox)", async () => {
    resetSandboxPolicyProvider();
    const service = {
      read: async () => {
        throw new Error("transient db error");
      },
      write: async () => {
        throw new Error("unused");
      },
    };
    registerScriptPackagesSandboxProvider({ service });
    const resolved = await resolveActiveSandboxPolicy();
    expect(resolved.failedClosed).toBe(true);
    expect(resolved.policy).toEqual(FAIL_CLOSED_SANDBOX_PROFILE);
  });
});
