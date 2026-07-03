import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";
import { configSecret, Versioned } from "@checkstack/backend-api";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import { internalSecretName } from "@checkstack/secrets-common";
import { SECRET_CLEAR_SENTINEL } from "@checkstack/common";
import { HealthCheckService } from "./service";
import {
  healthcheckSecretMarker,
  healthcheckSecretParts,
  healthcheckConfigLockKey,
  isHealthcheckSecretMarker,
} from "./config-secrets";
import type { HealthCheckConfiguration } from "@checkstack/healthcheck-common";

/**
 * Guards the REG-5 fix: an UNREGISTERED strategy/collector plugin reads back
 * REDACTED to `{}` (fail-closed - no schema to know its secret fields). If the
 * editor round-trips that empty object into `updateConfiguration`, the service
 * MUST preserve the STORED config verbatim instead of wiping it to `{}`.
 */

const strategySchema = z.object({
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

const fakeResolver = {
  resolveForRun: mock(async () => ({ env: {}, masking: undefined })),
} as unknown as SecretResolverService;

interface CapturedUpdate {
  set: Record<string, unknown>;
}

/** DB that serves ONE stored config row and captures the update `.set(...)`. */
function createDb({
  stored,
  updates,
}: {
  stored: Record<string, unknown>;
  updates: CapturedUpdate[];
}) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([stored]),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ set });
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...stored, ...set }]),
          }),
        };
      },
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  };
}

function buildService({
  stored,
  updates,
  strategyRegistered,
  registeredCollectorIds,
  internalSecrets = fakeInternalSecrets(),
  advisoryLock,
  db,
}: {
  stored: Record<string, unknown>;
  updates: CapturedUpdate[];
  strategyRegistered: boolean;
  registeredCollectorIds: string[];
  internalSecrets?: ReturnType<typeof fakeInternalSecrets>;
  advisoryLock?: { withXactLock: (args: { key: string; fn: () => Promise<unknown> }) => Promise<unknown> };
  db?: unknown;
}) {
  const strategy = {
    config: new Versioned({ version: 1, schema: strategySchema }),
  };
  const registry = {
    getStrategy: mock(() => (strategyRegistered ? strategy : undefined)),
  };
  const collectorRegistry = {
    getCollector: mock((collectorId: string) =>
      registeredCollectorIds.includes(collectorId)
        ? { collector: { config: new Versioned({ version: 1, schema: strategySchema }) } }
        : undefined,
    ),
  };
  const service = new HealthCheckService(
    (db ?? createDb({ stored, updates })) as never,
    registry as never,
    collectorRegistry as never,
    undefined,
    undefined,
    { internalSecrets, secretResolver: fakeResolver, advisoryLock: advisoryLock as never },
  );
  return { service, internalSecrets };
}

describe("updateConfiguration unregistered-plugin guard (REG-5)", () => {
  it("preserves the stored strategy config when the strategy plugin is unregistered", async () => {
    const storedConfig = {
      url: "https://x",
      password: healthcheckSecretMarker("password"),
    };
    const stored = {
      id: "cfg-1",
      name: "old",
      strategyId: "gone.strategy",
      config: storedConfig,
      collectors: null,
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updates: CapturedUpdate[] = [];
    const { service } = buildService({
      stored,
      updates,
      strategyRegistered: false,
      registeredCollectorIds: [],
    });

    // The editor round-trips the redacted `{}` config.
    await service.updateConfiguration("cfg-1", { config: {} });

    const persisted = updates.at(-1)?.set.config;
    // The stored config (with its secret marker) is preserved, NOT wiped to {}.
    expect(persisted).toEqual(storedConfig);
  });

  it("preserves an unregistered collector entry's stored config", async () => {
    const goneConfig = { secret: healthcheckSecretMarker("secret") };
    const stored = {
      id: "cfg-2",
      name: "old",
      strategyId: "reg.strategy",
      config: { url: "https://x" },
      collectors: [{ id: "c2", collectorId: "gone.collector", config: goneConfig }],
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updates: CapturedUpdate[] = [];
    const { service } = buildService({
      stored,
      updates,
      strategyRegistered: true,
      registeredCollectorIds: [],
    });

    // Editor round-trips the unregistered collector redacted to `{}`.
    await service.updateConfiguration("cfg-2", {
      collectors: [{ id: "c2", collectorId: "gone.collector", config: {} }],
    });

    const persisted = updates.at(-1)?.set.collectors as
      | Array<{ id: string; config: Record<string, unknown> }>
      | undefined;
    expect(persisted?.[0]?.config).toEqual(goneConfig);
  });
});

describe("updateConfiguration mergeSecrets flag (GITOPS-9)", () => {
  it("keeps a stored secret when a blank field is round-tripped (UI, mergeSecrets=true)", async () => {
    const stored = {
      id: "cfg-3",
      name: "old",
      strategyId: "reg.strategy",
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: null,
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updates: CapturedUpdate[] = [];
    const { service } = buildService({
      stored,
      updates,
      strategyRegistered: true,
      registeredCollectorIds: [],
    });

    // UI editor omits the redacted secret -> keep existing.
    await service.updateConfiguration("cfg-3", { config: { url: "https://y" } });

    const persisted = updates.at(-1)?.set.config as Record<string, unknown>;
    expect(persisted.url).toBe("https://y");
    expect(persisted.password).toBe(healthcheckSecretMarker("password"));
  });

  it("removes an omitted secret declaratively (GitOps, mergeSecrets=false)", async () => {
    const stored = {
      id: "cfg-4",
      name: "old",
      strategyId: "reg.strategy",
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: null,
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updates: CapturedUpdate[] = [];
    const { service } = buildService({
      stored,
      updates,
      strategyRegistered: true,
      registeredCollectorIds: [],
    });

    // GitOps applies the authored config wholesale; the omitted secret is gone.
    await service.updateConfiguration(
      "cfg-4",
      { config: { url: "https://y" } },
      { mergeSecrets: false },
    );

    const persisted = updates.at(-1)?.set.config as Record<string, unknown>;
    expect(persisted.url).toBe("https://y");
    expect(persisted.password).toBeUndefined();
  });
});

describe("updateConfiguration orphan-secret cleanup", () => {
  it("deletes the internal secret when a stored secret is CLEARED", async () => {
    const stored = {
      id: "cfg-5",
      name: "old",
      strategyId: "reg.strategy",
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: null,
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const internalSecrets = fakeInternalSecrets();
    const passwordParts = healthcheckSecretParts({
      configurationId: "cfg-5",
      scope: { kind: "strategy" },
      secretId: "password",
    });
    await internalSecrets.set({ parts: passwordParts, value: "old-pw" });

    const updates: CapturedUpdate[] = [];
    const { service } = buildService({
      stored,
      updates,
      strategyRegistered: true,
      registeredCollectorIds: [],
      internalSecrets,
    });

    // Editor clears the optional secret via the sentinel.
    await service.updateConfiguration("cfg-5", {
      config: { url: "https://x", password: SECRET_CLEAR_SENTINEL },
    });

    // Field dropped from the persisted config AND its internal secret removed.
    const persisted = updates.at(-1)?.set.config as Record<string, unknown>;
    expect(persisted.password).toBeUndefined();
    expect(await internalSecrets.get({ parts: passwordParts })).toBeUndefined();
  });
});

describe("updateConfiguration registered collector under UNREGISTERED strategy", () => {
  it("extracts a registered collector's inline secret (never plaintext at rest)", async () => {
    const stored = {
      id: "cfg-6",
      name: "old",
      strategyId: "gone.strategy", // strategy plugin uninstalled
      config: { url: "https://x" },
      collectors: [
        {
          id: "c1",
          collectorId: "reg.collector",
          config: { url: "https://x", password: healthcheckSecretMarker("password") },
        },
      ],
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updates: CapturedUpdate[] = [];
    const { service, internalSecrets } = buildService({
      stored,
      updates,
      strategyRegistered: false, // unregistered strategy
      registeredCollectorIds: ["reg.collector"], // but a REGISTERED collector
    });

    // A direct (non-UI) client types a NEW inline collector secret.
    await service.updateConfiguration("cfg-6", {
      collectors: [
        {
          id: "c1",
          collectorId: "reg.collector",
          config: { url: "https://y", password: "newpw" },
        },
      ],
    });

    const persisted = updates.at(-1)?.set.collectors as Array<{
      config: Record<string, unknown>;
    }>;
    // Persisted as a MARKER, never the plaintext; plaintext lives only in the store.
    expect(isHealthcheckSecretMarker(persisted[0].config.password as string)).toBe(true);
    expect(JSON.stringify(updates)).not.toContain("newpw");
    expect([...internalSecrets.store.values()]).toContain("newpw");
  });
});

describe("redacted read reports configuredSecrets (finding 4)", () => {
  it("lists only secret fields that actually have a stored value", async () => {
    const stored = {
      id: "cfg-9",
      name: "n",
      strategyId: "reg.strategy",
      // `password` is stored (marker); the schema's other optional secret is
      // never set, so it must NOT be reported as configured.
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: [
        {
          id: "c1",
          collectorId: "reg.collector",
          config: { url: "https://y" }, // no stored secret
        },
      ],
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service } = buildService({
      stored,
      updates: [],
      strategyRegistered: true,
      registeredCollectorIds: ["reg.collector"],
    });

    const redacted = await service.getConfigurationRedacted("cfg-9");

    expect(redacted?.configuredSecrets?.strategy).toEqual(["password"]);
    expect(redacted?.configuredSecrets?.collectors.c1).toEqual([]);
    // And the value itself never leaves the backend.
    expect(redacted?.config.password).toBeUndefined();
  });
});

describe("updateConfiguration concurrency serialization (advisory lock)", () => {
  it("runs the secret path under a per-config advisory lock", async () => {
    const stored = {
      id: "cfg-7",
      name: "old",
      strategyId: "reg.strategy",
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: null,
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const keys: string[] = [];
    const advisoryLock = {
      withXactLock: async ({ key, fn }: { key: string; fn: () => Promise<unknown> }) => {
        keys.push(key);
        return fn();
      },
    };
    const updates: CapturedUpdate[] = [];
    const { service } = buildService({
      stored,
      updates,
      strategyRegistered: true,
      registeredCollectorIds: [],
      advisoryLock,
    });

    await service.updateConfiguration("cfg-7", { config: { url: "https://y" } });

    expect(keys).toEqual([healthcheckConfigLockKey("cfg-7")]);
  });

  it("serialized concurrent clear + set leaves NO dangling marker (row and store agree)", async () => {
    // Stateful db: the update mutates the served row so a serialized second
    // writer reads the first writer's committed state.
    let row: Record<string, unknown> = {
      id: "cfg-8",
      name: "old",
      strategyId: "reg.strategy",
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: null,
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([row]) }) }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              row = { ...row, ...set };
              return Promise.resolve([row]);
            },
          }),
        }),
      }),
    };
    // A real per-key mutex, so overlapping calls serialize.
    const chains = new Map<string, Promise<unknown>>();
    const advisoryLock = {
      withXactLock: async ({ key, fn }: { key: string; fn: () => Promise<unknown> }) => {
        const prev = chains.get(key) ?? Promise.resolve();
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => (release = r));
        chains.set(key, prev.then(() => gate));
        await prev;
        try {
          return await fn();
        } finally {
          release();
        }
      },
    };
    const internalSecrets = fakeInternalSecrets();
    const passwordParts = healthcheckSecretParts({
      configurationId: "cfg-8",
      scope: { kind: "strategy" },
      secretId: "password",
    });
    await internalSecrets.set({ parts: passwordParts, value: "v0" });

    const { service } = buildService({
      stored: row,
      updates: [],
      strategyRegistered: true,
      registeredCollectorIds: [],
      internalSecrets,
      advisoryLock,
      db,
    });

    // Concurrent: A clears the secret; B sets a new one. The lock serializes.
    await Promise.all([
      service.updateConfiguration("cfg-8", {
        config: { url: "https://x", password: SECRET_CLEAR_SENTINEL },
      }),
      service.updateConfiguration("cfg-8", {
        config: { url: "https://x", password: "newpw" },
      }),
    ]);

    // Invariant: the final row's marker presence and the store must AGREE - a
    // marker in the row iff its internal secret exists. Never a dangling marker.
    const finalConfig = row.config as Record<string, unknown>;
    const rowHasMarker = isHealthcheckSecretMarker(
      (finalConfig.password ?? "") as string,
    );
    const storeHasValue =
      (await internalSecrets.get({ parts: passwordParts })) !== undefined;
    expect(rowHasMarker).toBe(storeHasValue);
  });
});

/** DB that captures inserted rows and can be told to fail the insert. */
function createInsertDb({
  inserted,
  throwOnInsert = false,
}: {
  inserted: Record<string, unknown>[];
  throwOnInsert?: boolean;
}) {
  return {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          if (throwOnInsert) return Promise.reject(new Error("insert failed"));
          inserted.push(values);
          return Promise.resolve([
            { paused: false, createdAt: new Date(), updatedAt: new Date(), ...values },
          ]);
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  };
}

describe("createConfiguration secret extraction (finding A / plaintext-at-rest)", () => {
  it("extracts a registered collector's inline secret even when the STRATEGY is unregistered", async () => {
    const inserted: Record<string, unknown>[] = [];
    const { service, internalSecrets } = buildService({
      stored: {},
      updates: [],
      strategyRegistered: false, // strategy plugin uninstalled on this pod
      registeredCollectorIds: ["reg.collector"], // but the collector IS registered
      db: createInsertDb({ inserted }),
    });

    await service.createConfiguration({
      name: "n",
      strategyId: "gone.strategy",
      config: { url: "https://x" },
      collectors: [
        {
          id: "c1",
          collectorId: "reg.collector",
          config: { url: "https://y", password: "plainpw" },
        },
      ],
      intervalSeconds: 60,
    });

    const collectors = inserted.at(-1)?.collectors as Array<{
      config: Record<string, unknown>;
    }>;
    // Persisted as a MARKER, never the plaintext; plaintext lives only in the store.
    expect(isHealthcheckSecretMarker(collectors[0].config.password as string)).toBe(
      true,
    );
    expect(JSON.stringify(inserted)).not.toContain("plainpw");
    expect([...internalSecrets.store.values()]).toContain("plainpw");
  });

  it("deletes the extracted secrets when the insert rolls back (finding H / no orphan)", async () => {
    const internalSecrets = fakeInternalSecrets();
    const { service } = buildService({
      stored: {},
      updates: [],
      strategyRegistered: true,
      registeredCollectorIds: [],
      internalSecrets,
      db: createInsertDb({ inserted: [], throwOnInsert: true }),
    });

    await expect(
      service.createConfiguration({
        name: "n",
        strategyId: "reg.strategy",
        config: { url: "https://x", password: "pw" },
        collectors: undefined,
        intervalSeconds: 60,
      }),
    ).rejects.toThrow("insert failed");

    // The secret was extracted before the (failed) insert; cleanup removed it.
    expect(internalSecrets.store.size).toBe(0);
  });
});

describe("deleteConfiguration concurrency serialization (finding G)", () => {
  it("runs delete under the per-config advisory lock", async () => {
    const stored = {
      id: "cfg-del",
      name: "n",
      strategyId: "reg.strategy",
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: null,
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const keys: string[] = [];
    const advisoryLock = {
      withXactLock: async ({ key, fn }: { key: string; fn: () => Promise<unknown> }) => {
        keys.push(key);
        return fn();
      },
    };
    const { service } = buildService({
      stored,
      updates: [],
      strategyRegistered: true,
      registeredCollectorIds: [],
      advisoryLock,
    });

    await service.deleteConfiguration("cfg-del");

    expect(keys).toEqual([healthcheckConfigLockKey("cfg-del")]);
  });
});

describe("deleteConfiguration cleans up secrets (never orphans)", () => {
  it("deletes the config's internal secrets even when the strategy plugin is UNINSTALLED", async () => {
    const stored = {
      id: "cfg-10",
      name: "n",
      strategyId: "gone.strategy", // plugin uninstalled -> no schema
      config: { url: "https://x", password: healthcheckSecretMarker("password") },
      collectors: [
        {
          id: "c1",
          collectorId: "gone.collector",
          config: { apiKey: healthcheckSecretMarker("apiKey") },
        },
      ],
      intervalSeconds: 60,
      isTemplate: false,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const internalSecrets = fakeInternalSecrets();
    await internalSecrets.set({
      parts: healthcheckSecretParts({
        configurationId: "cfg-10",
        scope: { kind: "strategy" },
        secretId: "password",
      }),
      value: "pw",
    });
    await internalSecrets.set({
      parts: healthcheckSecretParts({
        configurationId: "cfg-10",
        scope: { kind: "collector", entryId: "c1" },
        secretId: "apiKey",
      }),
      value: "key",
    });

    const { service } = buildService({
      stored,
      updates: [],
      strategyRegistered: false, // strategy AND collector unregistered
      registeredCollectorIds: [],
      internalSecrets,
    });

    await service.deleteConfiguration("cfg-10");

    // Schema-free cleanup removed BOTH secrets despite the missing plugins.
    expect(internalSecrets.store.size).toBe(0);
  });
});
