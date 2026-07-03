import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";
import { call } from "@orpc/server";
import {
  createMockRpcContext,
  configSecret,
  Versioned,
} from "@checkstack/backend-api";
import { internalSecretName } from "@checkstack/secrets-common";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import { createHealthCheckRouter } from "./router";
import {
  healthcheckSecretMarker,
  isHealthcheckSecretMarker,
} from "./config-secrets";
import type { HealthCheckCache } from "./cache";

/**
 * Guards the SEC-1 fix: `createAndAssign` (the first-check wizard / AI propose
 * creation path) MUST extract inline `x-secret` values into the internal store
 * and return a REDACTED config - never persist or echo a plaintext credential.
 */

const passthroughCache: HealthCheckCache = {
  wrapSystemHealthStatus: (_systemId, loader) => loader(),
  invalidateSystem: async () => {},
  invalidateAllSystems: async () => 0,
  scope: {} as HealthCheckCache["scope"],
};

const mockUser = {
  type: "user" as const,
  id: "test-user",
  accessRules: ["*"],
  roles: ["admin"],
};

// A strategy config with one plain field and one x-secret field.
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

interface CapturedInsert {
  values: Record<string, unknown>;
}

function createCapturingDb(captured: CapturedInsert[]) {
  const insert = () => ({
    values: (values: Record<string, unknown>) => {
      captured.push({ values });
      return Object.assign(Promise.resolve(undefined), {
        returning: () =>
          Promise.resolve([
            {
              paused: false,
              createdAt: new Date(),
              updatedAt: new Date(),
              collectors: null,
              ...values,
            },
          ]),
      });
    },
  });
  const emptyWhere = Object.assign(Promise.resolve([]), {
    where: () => Promise.resolve([]),
  });
  return {
    insert,
    select: () => ({ from: () => emptyWhere }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert }),
  };
}

function buildRouter(captured: CapturedInsert[]) {
  const internalSecrets = fakeInternalSecrets();
  const strategy = { config: new Versioned({ version: 1, schema: strategySchema }) };
  const router = createHealthCheckRouter({
    database: createCapturingDb(captured) as never,
    registry: { getStrategy: mock(() => strategy) } as never,
    collectorRegistry: { getCollector: mock(() => undefined) } as never,
    gitOpsClient: { getProvenance: mock(() => Promise.resolve(null)) } as never,
    getEmitHook: () => undefined,
    cache: passthroughCache,
    configService: { get: mock(async () => undefined), set: mock(async () => {}) } as never,
    catalogClient: { getSystem: mock(async () => null) } as never,
    maintenanceClient: {
      hasActiveMaintenance: mock(async () => ({ active: false })),
    } as never,
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    } as never,
    configSecrets: { internalSecrets, secretResolver: fakeResolver },
  });
  return { router, internalSecrets };
}

describe("createAndAssign secret extraction (SEC-1 regression)", () => {
  it("extracts an inline secret into the internal store and never persists or returns it", async () => {
    const captured: CapturedInsert[] = [];
    const { router, internalSecrets } = buildRouter(captured);
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.createAndAssign,
      {
        systemId: "sys-1",
        configuration: {
          name: "DB check",
          strategyId: "healthcheck-http.http",
          config: { url: "https://x", password: "super-secret" },
          intervalSeconds: 60,
        },
        enabled: false,
        includeLocal: true,
        environmentIds: null,
      },
      { context },
    );

    // The persisted config row holds a MARKER, never the plaintext.
    const configInsert = captured.find((c) => c.values.name === "DB check");
    expect(configInsert).toBeDefined();
    const storedConfig = configInsert?.values.config as Record<string, unknown>;
    expect(isHealthcheckSecretMarker(storedConfig.password as string)).toBe(true);
    expect(JSON.stringify(captured)).not.toContain("super-secret");

    // The plaintext lives ONLY in the internal (encrypted) store.
    expect([...internalSecrets.store.values()]).toContain("super-secret");

    // The response is redacted - the secret field is absent.
    expect(result.config.password).toBeUndefined();
    expect(result.config.url).toBe("https://x");
  });
});
