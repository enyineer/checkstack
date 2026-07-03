import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";
import { configSecret, Versioned } from "@checkstack/backend-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import { internalSecretName } from "@checkstack/secrets-common";
import { backfillConfigSecrets } from "./config-secrets-backfill";
import {
  healthcheckConfigLockKey,
  isHealthcheckSecretMarker,
} from "./config-secrets";

const collectorSchema = z.object({
  url: z.string(),
  password: configSecret({ id: "password" }).optional(),
});

function fakeInternalSecrets(): InternalSecretsService & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    async set({ parts, value }) {
      store.set(internalSecretName(...parts), value);
    },
    async get({ parts }) {
      return store.get(internalSecretName(...parts));
    },
    async delete({ parts }) {
      store.delete(internalSecretName(...parts));
    },
  };
}

const noopLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
} as never;

describe("backfillConfigSecrets", () => {
  it("migrates a registered collector's inline secret even under an UNREGISTERED strategy, per config lock", async () => {
    // One legacy row: strategy plugin is gone, but the collector plugin is
    // present and its config carries an inline plaintext secret.
    let row: Record<string, unknown> = {
      id: "cfg-bf",
      strategyId: "gone.strategy",
      config: { url: "https://x", password: "strategy-plain" }, // no schema -> left as-is
      collectors: [
        {
          id: "c1",
          collectorId: "reg.collector",
          config: { url: "https://y", password: "collector-plain" },
        },
      ],
    };
    const updates: Record<string, unknown>[] = [];
    const db = {
      // Initial scan: `db.select().from(table)` awaited directly.
      // Per-row re-read: `db.select().from(table).where(eq(...))`.
      select: () => ({
        from: () =>
          Object.assign(Promise.resolve([row]), {
            where: () => Promise.resolve([row]),
          }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => {
          updates.push(set);
          row = { ...row, ...set };
          return { where: () => Promise.resolve(undefined) };
        },
      }),
    };

    const registry = { getStrategy: mock(() => undefined) };
    const collectorRegistry = {
      getCollector: mock((id: string) =>
        id === "reg.collector"
          ? { collector: { config: new Versioned({ version: 1, schema: collectorSchema }) } }
          : undefined,
      ),
    };

    const lockKeys: string[] = [];
    const advisoryLock = {
      tryAcquire: mock(async () => ({ release: mock(async () => {}) })),
      withXactLock: async ({ key, fn }: { key: string; fn: () => Promise<unknown> }) => {
        lockKeys.push(key);
        return fn();
      },
    };

    const internalSecrets = fakeInternalSecrets();

    await backfillConfigSecrets({
      db: db as never,
      registry: registry as never,
      collectorRegistry: collectorRegistry as never,
      internalSecrets,
      advisoryLock: advisoryLock as never,
      logger: noopLogger,
    });

    // Per-config lock was taken for the row.
    expect(lockKeys).toEqual([healthcheckConfigLockKey("cfg-bf")]);

    // The collector's inline secret was migrated to a marker + the store.
    const persistedCollectors = updates.at(-1)?.collectors as Array<{
      config: Record<string, unknown>;
    }>;
    expect(
      isHealthcheckSecretMarker(persistedCollectors[0].config.password as string),
    ).toBe(true);
    expect([...internalSecrets.store.values()]).toContain("collector-plain");

    // The strategy config (no schema to walk) is left untouched - never wiped,
    // and its legacy plaintext is NOT migrated (nothing else we can do).
    const persistedConfig = updates.at(-1)?.config as Record<string, unknown>;
    expect(persistedConfig.password).toBe("strategy-plain");
    expect([...internalSecrets.store.values()]).not.toContain("strategy-plain");
  });

  it("skips the scan entirely when another pod holds the backfill lock", async () => {
    const advisoryLock = {
      tryAcquire: mock(async () => undefined), // lock not acquired
      withXactLock: mock(async () => {
        throw new Error("must not run when the global lock is unavailable");
      }),
    };
    await backfillConfigSecrets({
      db: {} as never,
      registry: {} as never,
      collectorRegistry: {} as never,
      internalSecrets: fakeInternalSecrets(),
      advisoryLock: advisoryLock as never,
      logger: noopLogger,
    });
    expect(advisoryLock.withXactLock).not.toHaveBeenCalled();
  });
});
