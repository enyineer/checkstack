import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  createMockSignalService,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { SECRET_CLEAR_SENTINEL } from "@checkstack/common";
import { configString } from "@checkstack/backend-api";
import type { AuthUser } from "@checkstack/backend-api";
import { createSourceTokenKit } from "@checkstack/ingest-utils";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import * as schema from "./schema";
import { telemetrySources } from "./schema";
import {
  createSourceSecretStore,
  isSecretMarkerFor,
  sourceSecretKeyParts,
} from "./secrets";
import { createTelemetryService, type SourceReconcileHooks } from "./service";
import {
  createTelemetrySinkRegistry,
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  type RegisteredTelemetrySink,
} from "./extension-points";

const MIGRATIONS = path.join(import.meta.dir, "..", "drizzle");
const user: AuthUser = { type: "user", id: "u1", accessRules: ["*"] };

function memInternalSecrets(): {
  service: InternalSecretsService;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const key = (parts: string[]) => parts.join(" ");
  return {
    service: {
      set: async ({ parts, value }) => void store.set(key(parts), value),
      get: async ({ parts }) => store.get(key(parts)),
      delete: async ({ parts }) => void store.delete(key(parts)),
    },
    store,
  };
}

const noReconcile: SourceReconcileHooks = {
  scheduleSource: async () => {},
  unscheduleSource: async () => {},
};

const sourceType = defineTelemetrySourceType({
  id: "vendor",
  displayName: "Vendor",
  description: "",
  signals: ["logs"],
  configSchema: z.object({
    url: z.string(),
    apiToken: configString({ "x-secret": true }).optional(),
  }),
  pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30, execute: async () => {} },
  webhook: { handle: async () => new Response(null) },
});

/** Captures the config a pull dry-run executes with (for runConfigTest tests). */
let capturedTestConfig: unknown;
const capturingSourceType = defineTelemetrySourceType({
  id: "capture",
  displayName: "Capture",
  description: "",
  signals: ["logs"],
  configSchema: z.object({
    url: z.string(),
    apiToken: configString({ "x-secret": true }).optional(),
  }),
  pull: {
    defaultIntervalSeconds: 60,
    minIntervalSeconds: 30,
    execute: async ({ config }) => {
      capturedTestConfig = config;
    },
  },
});

/** A webhook type that verifies vendor HMAC signatures (stores the raw secret). */
const signedWebhookType = defineTelemetrySourceType({
  id: "signedhook",
  displayName: "Signed hook",
  description: "",
  signals: ["logs"],
  configSchema: z.object({}),
  webhook: {
    handle: async () => new Response(null),
    signature: {
      algorithm: "hmac-sha256",
      header: "x-hub-signature-256",
      encoding: "hex",
      prefix: "sha256=",
      basestring: "body",
    },
  },
});

/** The reserved internal-secret store key for a source's raw webhook secret. */
function webhookSecretKey(sourceId: string): string {
  return sourceSecretKeyParts({ sourceId, field: "__webhookSecret" }).join(" ");
}

/** A satellite-capable pull type, for the binding + notify paths. */
const satelliteSourceType = defineTelemetrySourceType({
  id: "edge",
  displayName: "Edge",
  description: "",
  signals: ["logs"],
  configSchema: z.object({ url: z.string() }),
  pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30, execute: async () => {} },
  supportsSatellite: true,
});

function sinkRegistry() {
  const registry = createTelemetrySinkRegistry();
  const logsSink: RegisteredTelemetrySink = {
    signal: "logs",
    ownerPluginId: "logstream",
    assertBindable: async () => {},
    describeStream: async () => null,
    write: async () => ({ accepted: 0, rejected: 0 }),
  };
  registry.register(logsSink, { pluginId: "logstream" });
  return registry;
}

function build(
  db: TestDb<typeof schema>["db"],
  opts: { bindable?: (satelliteId: string) => Promise<void> } = {},
) {
  const { service: internalSecrets, store } = memInternalSecrets();
  const sourceRegistry = createTelemetrySourceRegistry();
  sourceRegistry.register(sourceType, { pluginId: "p" });
  sourceRegistry.register(capturingSourceType, { pluginId: "p" });
  sourceRegistry.register(satelliteSourceType, { pluginId: "p" });
  sourceRegistry.register(signedWebhookType, { pluginId: "p" });
  const bindableCalls: string[] = [];
  const notified: string[] = [];
  const service = createTelemetryService({
    db,
    sourceRegistry,
    sinkRegistry: sinkRegistry(),
    internalSecretsStore: createSourceSecretStore({ internalSecrets }),
    signalService: createMockSignalService(),
    webhookKit: createSourceTokenKit({ prefix: "ckwh_" }),
    reconcile: noReconcile,
    assertSatelliteBindable: async ({ satelliteId }) => {
      bindableCalls.push(satelliteId);
      await opts.bindable?.(satelliteId);
    },
    satellitePush: {
      notifyConfigChanged: ({ satelliteId }) => notified.push(satelliteId),
    },
    logger: createMockLogger(),
  });
  return { service, secretStore: store, bindableCalls, notified };
}

describe.skipIf(!isIntegrationEnabled())("TelemetryService (integration)", () => {
  let testDb: TestDb<typeof schema>;

  beforeAll(async () => {
    testDb = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await testDb?.dispose();
  });
  beforeEach(async () => {
    await testDb.db.delete(telemetrySources);
  });

  const createInput = {
    sourceTypeId: "p.vendor",
    name: "Prod logs",
    config: { url: "https://vendor", apiToken: "secret-value" },
    bindings: [{ signal: "logs" as const, streamId: "stream-1" }],
    enabled: true,
  };

  it("create stores a marker + plaintext, reads back omitting the secret, mints a webhook", async () => {
    const { service, secretStore } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user });

    expect(created.config).toEqual({ url: "https://vendor" });
    expect(created.storedSecretFields).toEqual(["apiToken"]);
    expect(created.webhook?.secret).toMatch(/^ckwh_/);
    expect([...secretStore.values()]).toContain("secret-value");

    const [row] = await testDb.db
      .select()
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    expect(
      isSecretMarkerFor({
        value: row!.config.apiToken,
        sourceId: created.id,
        field: "apiToken",
      }),
    ).toBe(true);
    expect(row!.webhookSecretHash).not.toBeNull();
  });

  it("does NOT store a raw webhook secret for a plain-secret webhook type", async () => {
    const { service, secretStore } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user });
    // p.vendor's webhook seam has no `signature` descriptor -> hash-only storage.
    expect(secretStore.has(webhookSecretKey(created.id))).toBe(false);
  });

  it("stores the raw webhook secret for a signature webhook type, and rotate replaces it", async () => {
    const { service, secretStore } = build(testDb.db);
    const created = await service.createSource({
      input: {
        sourceTypeId: "p.signedhook",
        name: "Signed",
        config: {},
        bindings: [{ signal: "logs" as const, streamId: "stream-1" }],
        enabled: true,
      },
      user,
    });

    // The raw secret is stored encrypted under the reserved key and equals the
    // one-time secret handed to the operator.
    const storedKey = webhookSecretKey(created.id);
    expect(secretStore.get(storedKey)).toBe(created.webhook?.secret);

    // Rotate mints a new secret and OVERWRITES the stored HMAC key, so the old
    // secret can no longer produce a valid signature.
    const rotated = await service.rotateWebhookSecret({ id: created.id });
    expect(rotated.secret).not.toBe(created.webhook?.secret);
    expect(secretStore.get(storedKey)).toBe(rotated.secret);
  });

  it("clears the raw webhook secret on delete", async () => {
    const { service, secretStore } = build(testDb.db);
    const created = await service.createSource({
      input: {
        sourceTypeId: "p.signedhook",
        name: "Signed",
        config: {},
        bindings: [{ signal: "logs" as const, streamId: "stream-1" }],
        enabled: true,
      },
      user,
    });
    expect(secretStore.has(webhookSecretKey(created.id))).toBe(true);
    await service.deleteSource({ id: created.id });
    expect(secretStore.has(webhookSecretKey(created.id))).toBe(false);
  });

  it("update keeps an omitted secret (regression) and resolveRunnableConfig round-trips it", async () => {
    const { service } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user });

    const updated = await service.updateSource({
      id: created.id,
      body: { config: { url: "https://vendor-2" } },
      user,
    });
    expect(updated.config).toEqual({ url: "https://vendor-2" });
    expect(updated.storedSecretFields).toEqual(["apiToken"]);

    const [row] = await testDb.db
      .select()
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    const resolved = await service.resolveRunnableConfig({
      sourceId: created.id,
      sourceTypeId: "p.vendor",
      config: row!.config,
    });
    expect(resolved).toEqual({ url: "https://vendor-2", apiToken: "secret-value" });
  });

  it("the SECRET_CLEAR_SENTINEL clears the stored secret", async () => {
    const { service, secretStore } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user });
    const updated = await service.updateSource({
      id: created.id,
      body: { config: { url: "https://vendor", apiToken: SECRET_CLEAR_SENTINEL } },
      user,
    });
    expect(updated.storedSecretFields).toEqual([]);
    expect([...secretStore.values()]).not.toContain("secret-value");
  });

  const captureInput = {
    sourceTypeId: "p.capture",
    name: "Cap",
    config: { url: "https://vendor", apiToken: "stored-secret" },
    bindings: [{ signal: "logs" as const, streamId: "stream-1" }],
    enabled: true,
  };

  it("runConfigTest: a cleared secret (sentinel) neither leaks nor pulls the stored secret", async () => {
    const { service } = build(testDb.db);
    const created = await service.createSource({ input: captureInput, user });

    capturedTestConfig = undefined;
    const result = await service.runConfigTest({
      sourceTypeId: "p.capture",
      sourceId: created.id,
      config: { url: "https://vendor", apiToken: SECRET_CLEAR_SENTINEL },
    });

    expect(result.ok).toBe(true);
    // The cleared field is ABSENT from the executed config: not the sentinel
    // string, and NOT refilled from the stored secret.
    expect(capturedTestConfig).toEqual({ url: "https://vendor" });
  });

  it("runConfigTest: an OMITTED secret still merges the stored value (control)", async () => {
    const { service } = build(testDb.db);
    const created = await service.createSource({ input: captureInput, user });

    capturedTestConfig = undefined;
    await service.runConfigTest({
      sourceTypeId: "p.capture",
      sourceId: created.id,
      config: { url: "https://vendor" },
    });

    expect(capturedTestConfig).toEqual({
      url: "https://vendor",
      apiToken: "stored-secret",
    });
  });

  it("clamps the interval to the type minimum", async () => {
    const { service } = build(testDb.db);
    const created = await service.createSource({
      input: { ...createInput, intervalSeconds: 5 },
      user,
    });
    expect(created.intervalSeconds).toBe(30);
  });

  it("rejects a satelliteId for a type that does not support satellites", async () => {
    const { service } = build(testDb.db);
    await expect(
      service.createSource({
        input: { ...createInput, satelliteId: "sat-1" },
        user,
      }),
    ).rejects.toThrow(/satellite/i);
  });

  const satelliteInput = {
    sourceTypeId: "p.edge",
    name: "Edge logs",
    config: { url: "https://edge" },
    bindings: [{ signal: "logs" as const, streamId: "stream-1" }],
    enabled: true,
  };

  it("authorizes the satellite binding on create and notifies that satellite", async () => {
    const { service, bindableCalls, notified } = build(testDb.db);
    const created = await service.createSource({
      input: { ...satelliteInput, satelliteId: "sat-1" },
      user,
    });
    expect(created.satelliteId).toBe("sat-1");
    expect(bindableCalls).toEqual(["sat-1"]);
    expect(notified).toEqual(["sat-1"]);
  });

  it("rejects create when the satellite-binding gate denies", async () => {
    const { service } = build(testDb.db, {
      bindable: async () => {
        throw new Error("denied");
      },
    });
    await expect(
      service.createSource({
        input: { ...satelliteInput, satelliteId: "sat-x" },
        user,
      }),
    ).rejects.toThrow(/denied/);
    // Nothing persisted when the gate rejects.
    const rows = await testDb.db.select().from(telemetrySources);
    expect(rows).toHaveLength(0);
  });

  it("notifies BOTH old and new satellite on a rebind", async () => {
    const { service, notified } = build(testDb.db);
    const created = await service.createSource({
      input: { ...satelliteInput, satelliteId: "sat-1" },
      user,
    });
    notified.length = 0;
    await service.updateSource({
      id: created.id,
      body: { satelliteId: "sat-2" },
      user,
    });
    expect(new Set(notified)).toEqual(new Set(["sat-1", "sat-2"]));
  });

  it("delete notifies the bound satellite", async () => {
    const { service, notified } = build(testDb.db);
    const created = await service.createSource({
      input: { ...satelliteInput, satelliteId: "sat-1" },
      user,
    });
    notified.length = 0;
    await service.deleteSource({ id: created.id });
    expect(notified).toEqual(["sat-1"]);
  });

  it("delete removes the row and its stored secrets", async () => {
    const { service, secretStore } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user });
    await service.deleteSource({ id: created.id });
    expect(secretStore.size).toBe(0);
    const rows = await testDb.db.select().from(telemetrySources);
    expect(rows).toHaveLength(0);
  });

  it("listSources filters by streamId and omits secrets", async () => {
    const { service } = build(testDb.db);
    await service.createSource({ input: createInput, user });
    const matched = await service.listSources({ streamId: "stream-1" });
    expect(matched.sources).toHaveLength(1);
    expect(matched.sources[0]!.config).toEqual({ url: "https://vendor" });
    const none = await service.listSources({ streamId: "other" });
    expect(none.sources).toHaveLength(0);
  });
});
