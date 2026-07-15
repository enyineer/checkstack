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
import type { AuthUser, EventBus, RpcClient } from "@checkstack/backend-api";
import { createSourceTokenKit } from "@checkstack/ingest-utils";
import { telemetryResourceTypes } from "@checkstack/telemetry-common";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import * as schema from "./schema";
import { telemetrySources } from "./schema";
import {
  telemetryPushTokenInvalidatedHook,
  type TelemetryPushTokenInvalidatedPayload,
} from "./events";
import {
  createSourceSecretStore,
  isSecretMarkerFor,
  sourceSecretKeyParts,
} from "./secrets";
import { createTelemetryService } from "./service";
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

/** A push type, for token minting / rotation / enable-flip invalidation. */
const pushSourceType = defineTelemetrySourceType({
  id: "otlp",
  displayName: "OTLP",
  description: "",
  signals: ["logs"],
  configSchema: z.object({}),
  push: {
    tokenPrefix: "ckpush_",
    endpoints: [{ kind: "otlp", path: "/api/x/v1/logs", label: "OTLP logs" }],
  },
});

/** A multi-signal push type, for the stream-deletion cascade (keeps a binding). */
const pushMultiType = defineTelemetrySourceType({
  id: "otlp-multi",
  displayName: "OTLP multi",
  description: "",
  signals: ["logs", "metrics"],
  configSchema: z.object({}),
  push: {
    tokenPrefix: "ckpush_",
    endpoints: [{ kind: "otlp", path: "/api/x/v1/all", label: "OTLP" }],
  },
});

/**
 * Fake event bus capturing ONLY push-token invalidation emissions (identified by
 * hook identity), so tests can assert reason + order. Other hooks are ignored.
 */
function capturingBus(): {
  bus: EventBus;
  pushEmissions: TelemetryPushTokenInvalidatedPayload[];
} {
  const pushEmissions: TelemetryPushTokenInvalidatedPayload[] = [];
  const bus = {
    emit: async (hook: unknown, payload: unknown) => {
      if (hook === telemetryPushTokenInvalidatedHook) {
        pushEmissions.push(payload as TelemetryPushTokenInvalidatedPayload);
      }
    },
    emitLocal: async () => {},
    subscribe: async () => async () => {},
  } as unknown as EventBus;
  return { bus, pushEmissions };
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
  const metricsSink: RegisteredTelemetrySink = {
    signal: "metrics",
    ownerPluginId: "metricstream",
    assertBindable: async () => {},
    describeStream: async () => null,
    write: async () => ({ accepted: 0, rejected: 0 }),
  };
  registry.register(logsSink, { pluginId: "logstream" });
  registry.register(metricsSink, { pluginId: "metricstream" });
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
  sourceRegistry.register(pushSourceType, { pluginId: "p" });
  sourceRegistry.register(pushMultiType, { pluginId: "p" });
  const bindableCalls: string[] = [];
  const notified: string[] = [];
  const scheduled: string[] = [];
  const unscheduled: string[] = [];
  const deletedGrants: { objectType: string; objectId: string }[] = [];
  const { bus, pushEmissions } = capturingBus();
  // Structural test fake: RpcClient.forPlugin(AuthApi) yields a client that only
  // records deleteObjectRelations (the sole auth call the service makes).
  const rpcClient = {
    forPlugin: () => ({
      deleteObjectRelations: async (input: {
        objectType: string;
        objectId: string;
      }) => void deletedGrants.push(input),
    }),
  } as unknown as RpcClient;
  const service = createTelemetryService({
    db,
    sourceRegistry,
    sinkRegistry: sinkRegistry(),
    internalSecretsStore: createSourceSecretStore({ internalSecrets }),
    signalService: createMockSignalService(),
    eventBus: bus,
    rpcClient,
    webhookKit: createSourceTokenKit({ prefix: "ckwh_" }),
    reconcile: {
      scheduleSource: async ({ sourceId }) => void scheduled.push(sourceId),
      unscheduleSource: async ({ sourceId }) => void unscheduled.push(sourceId),
    },
    assertSatelliteBindable: async ({ satelliteId }) => {
      bindableCalls.push(satelliteId);
      await opts.bindable?.(satelliteId);
    },
    satellitePush: {
      notifyConfigChanged: ({ satelliteId }) => notified.push(satelliteId),
    },
    logger: createMockLogger(),
  });
  return {
    service,
    secretStore: store,
    bindableCalls,
    notified,
    pushEmissions,
    scheduled,
    unscheduled,
    deletedGrants,
  };
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

  // ==========================================================================
  // PUSH mode
  // ==========================================================================

  const pushInput = {
    sourceTypeId: "p.otlp",
    name: "OTLP ingest",
    config: {},
    bindings: [{ signal: "logs" as const, streamId: "stream-1" }],
    enabled: true,
  };

  it("create mints a push token shown once, stores only the hash, emits minted", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });

    // Token + endpoints returned once.
    expect(created.push?.token).toMatch(/^ckpush_/);
    expect(created.push?.endpoints).toEqual([
      { kind: "otlp", path: "/api/x/v1/logs", label: "OTLP logs" },
    ]);
    // The hash/prefix NEVER leak into the read DTO.
    expect((created as Record<string, unknown>).pushTokenHash).toBeUndefined();
    expect((created as Record<string, unknown>).pushTokenPrefix).toBeUndefined();

    // Only the hash + display prefix are persisted.
    const [row] = await testDb.db
      .select()
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    expect(row!.pushTokenHash).not.toBeNull();
    expect(row!.pushTokenPrefix).toMatch(/^ckpush_/);

    // A single "minted" emission for the new hash.
    expect(pushEmissions).toEqual([
      {
        sourceTypeId: "p.otlp",
        sourceId: created.id,
        tokenHash: row!.pushTokenHash!,
        reason: "minted",
      },
    ]);
  });

  it("rotatePushToken replaces the hash and emits revoked(old) then minted(new)", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });
    const [before] = await testDb.db
      .select({ hash: telemetrySources.pushTokenHash })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    pushEmissions.length = 0;

    const rotated = await service.rotatePushToken({ id: created.id });
    expect(rotated.token).not.toBe(created.push?.token);
    expect(rotated.token).toMatch(/^ckpush_/);

    const [after] = await testDb.db
      .select({ hash: telemetrySources.pushTokenHash })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    expect(after!.hash).not.toBe(before!.hash);

    // Two emissions IN ORDER: revoke the old hash, then mint the new.
    expect(pushEmissions).toEqual([
      {
        sourceTypeId: "p.otlp",
        sourceId: created.id,
        tokenHash: before!.hash!,
        reason: "revoked",
      },
      {
        sourceTypeId: "p.otlp",
        sourceId: created.id,
        tokenHash: after!.hash!,
        reason: "minted",
      },
    ]);
  });

  it("rotatePushToken rejects a non-push type", async () => {
    const { service } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user });
    await expect(service.rotatePushToken({ id: created.id })).rejects.toThrow(
      /no push endpoint/i,
    );
  });

  it("disabling then re-enabling a push instance emits revoked then minted", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });
    const [row] = await testDb.db
      .select({ hash: telemetrySources.pushTokenHash })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    const hash = row!.hash!;
    pushEmissions.length = 0;

    await service.updateSource({ id: created.id, body: { enabled: false }, user });
    await service.updateSource({ id: created.id, body: { enabled: true }, user });

    expect(pushEmissions).toEqual([
      { sourceTypeId: "p.otlp", sourceId: created.id, tokenHash: hash, reason: "revoked" },
      { sourceTypeId: "p.otlp", sourceId: created.id, tokenHash: hash, reason: "minted" },
    ]);
  });

  it("an update that does NOT change enabled emits no push invalidation", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });
    pushEmissions.length = 0;
    await service.updateSource({
      id: created.id,
      body: { name: "Renamed" },
      user,
    });
    expect(pushEmissions).toEqual([]);
  });

  it("deleting a push instance revokes its current hash", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });
    const [row] = await testDb.db
      .select({ hash: telemetrySources.pushTokenHash })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    pushEmissions.length = 0;

    await service.deleteSource({ id: created.id });
    expect(pushEmissions).toEqual([
      {
        sourceTypeId: "p.otlp",
        sourceId: created.id,
        tokenHash: row!.hash!,
        reason: "revoked",
      },
    ]);
  });

  it("a binding change emits exactly one revoked for the current hash", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });
    const [row] = await testDb.db
      .select({ hash: telemetrySources.pushTokenHash })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    pushEmissions.length = 0;

    // Re-bind the logs signal from stream-1 to stream-2 (enabled unchanged).
    await service.updateSource({
      id: created.id,
      body: { bindings: [{ signal: "logs", streamId: "stream-2" }] },
      user,
    });
    expect(pushEmissions).toEqual([
      {
        sourceTypeId: "p.otlp",
        sourceId: created.id,
        tokenHash: row!.hash!,
        reason: "revoked",
      },
    ]);
  });

  it("re-passing the SAME bindings emits no push invalidation", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });
    pushEmissions.length = 0;
    await service.updateSource({
      id: created.id,
      body: { bindings: [{ signal: "logs", streamId: "stream-1" }] },
      user,
    });
    expect(pushEmissions).toEqual([]);
  });

  it("a binding change on a NON-push type emits nothing", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user }); // p.vendor
    pushEmissions.length = 0;
    await service.updateSource({
      id: created.id,
      body: { bindings: [{ signal: "logs", streamId: "stream-2" }] },
      user,
    });
    expect(pushEmissions).toEqual([]);
  });

  // ==========================================================================
  // STREAM-DELETION CASCADE (handleStreamDeleted)
  // ==========================================================================

  it("handleStreamDeleted fully deletes a source whose only binding was that stream", async () => {
    const { service, secretStore, unscheduled, deletedGrants } = build(testDb.db);
    // p.vendor carries a secret (apiToken) + a webhook, bound to stream-del.
    const created = await service.createSource({
      input: {
        ...createInput,
        bindings: [{ signal: "logs" as const, streamId: "stream-del" }],
      },
      user,
    });
    expect(secretStore.size).toBeGreaterThan(0);

    await service.handleStreamDeleted({ signal: "logs", streamId: "stream-del" });

    // Row gone, secrets cleared, unschedule ran, team grants deleted.
    const rows = await testDb.db.select().from(telemetrySources);
    expect(rows).toHaveLength(0);
    expect(secretStore.size).toBe(0);
    expect(unscheduled).toContain(created.id);
    expect(deletedGrants).toEqual([
      { objectType: telemetryResourceTypes.source, objectId: created.id },
    ]);
  });

  it("deleteSource deletes the source's team grants", async () => {
    const { service, deletedGrants } = build(testDb.db);
    const created = await service.createSource({ input: createInput, user });
    await service.deleteSource({ id: created.id });
    expect(deletedGrants).toEqual([
      { objectType: telemetryResourceTypes.source, objectId: created.id },
    ]);
  });

  it("handleStreamDeleted emits a push revoked when the orphaned source had a token", async () => {
    const { service, pushEmissions } = build(testDb.db);
    const created = await service.createSource({
      input: {
        ...pushInput,
        bindings: [{ signal: "logs" as const, streamId: "stream-del" }],
      },
      user,
    });
    const [row] = await testDb.db
      .select({ hash: telemetrySources.pushTokenHash })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    pushEmissions.length = 0;

    await service.handleStreamDeleted({ signal: "logs", streamId: "stream-del" });

    expect(await testDb.db.select().from(telemetrySources)).toHaveLength(0);
    expect(pushEmissions).toEqual([
      {
        sourceTypeId: "p.otlp",
        sourceId: created.id,
        tokenHash: row!.hash!,
        reason: "revoked",
      },
    ]);
  });

  it("handleStreamDeleted keeps other bindings and evicts the push verdict", async () => {
    const { service, pushEmissions, scheduled, deletedGrants } = build(testDb.db);
    const created = await service.createSource({
      input: {
        sourceTypeId: "p.otlp-multi",
        name: "Multi",
        config: {},
        bindings: [
          { signal: "logs" as const, streamId: "stream-del" },
          { signal: "metrics" as const, streamId: "stream-keep" },
        ],
        enabled: true,
      },
      user,
    });
    const [row] = await testDb.db
      .select({ hash: telemetrySources.pushTokenHash })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    pushEmissions.length = 0;
    scheduled.length = 0;

    await service.handleStreamDeleted({ signal: "logs", streamId: "stream-del" });

    // Row survives with only the metrics binding; verdict evicted; re-scheduled.
    const [after] = await testDb.db
      .select()
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    expect(after!.bindings).toEqual([
      { signal: "metrics", streamId: "stream-keep" },
    ]);
    expect(pushEmissions).toEqual([
      {
        sourceTypeId: "p.otlp-multi",
        sourceId: created.id,
        tokenHash: row!.hash!,
        reason: "revoked",
      },
    ]);
    expect(scheduled).toContain(created.id);
    // The source survives, so its grants must NOT be deleted.
    expect(deletedGrants).toEqual([]);
  });

  it("handleStreamDeleted with a non-matching stream is a no-op", async () => {
    const { service, pushEmissions, unscheduled, scheduled } = build(testDb.db);
    const created = await service.createSource({ input: pushInput, user });
    pushEmissions.length = 0;
    unscheduled.length = 0;
    scheduled.length = 0;

    await service.handleStreamDeleted({ signal: "logs", streamId: "nope" });

    // Nothing touched.
    const [after] = await testDb.db
      .select()
      .from(telemetrySources)
      .where(eq(telemetrySources.id, created.id));
    expect(after!.bindings).toEqual([{ signal: "logs", streamId: "stream-1" }]);
    expect(pushEmissions).toEqual([]);
    expect(unscheduled).toEqual([]);
    expect(scheduled).toEqual([]);
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
