/**
 * The "telemetry-pull" capability handler (integration): drives the REAL handler
 * against real `telemetry_sources` rows.
 *
 * Covers the behaviours the design hinges on:
 * - `buildCapabilityConfig` returns only the ENABLED, satellite-capable pull
 *   instances BOUND to the satellite, strips secret markers out of `config` and
 *   advertises them in `secretFields`, and skips a non-satellite-capable type.
 * - `resolveSecret` authorizes by BINDING: a mismatched / unknown / disabled
 *   instance (or a non-secret field) returns an error WITHOUT touching the store.
 * - `handleTelemetryBatch` authorizes by BINDING: a mismatched / unknown /
 *   disabled instance is rejected (counted) and never fed to the sink; a bound
 *   instance's records flow through the per-instance bound sink.
 * - `handleCapabilityStatus` mirrors per-instance pull health and ignores a
 *   status for an instance bound to a different satellite.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { configString } from "@checkstack/backend-api";
import {
  createSecretResolverService,
  type InternalSecretsService,
} from "@checkstack/secrets-backend";
import type {
  TelemetryPullConfig,
  WireLogRecord,
} from "@checkstack/telemetry-common";
import * as schema from "../schema";
import { telemetrySources } from "../schema";
import { createSourceSecretStore, secretMarker } from "../secrets";
import {
  createTelemetrySinkRegistry,
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  type RegisteredTelemetrySink,
  type TelemetrySinkRegistry,
} from "../extension-points";
import { createTelemetryPullCapabilityHandler } from "./pull-capability";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const SAT_A = "satellite-a";
const SAT_B = "satellite-b";
const NOW = new Date("2026-06-01T12:00:00.000Z");
const CREATED = new Date("2026-01-01T00:00:00.000Z");

/** A satellite-capable pull type with a secret config field. */
const edgeType = defineTelemetrySourceType({
  id: "edge",
  displayName: "Edge",
  description: "",
  signals: ["logs"],
  configSchema: z.object({
    url: z.string(),
    apiToken: configString({ "x-secret": true }).optional(),
  }),
  pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30, execute: async () => {} },
  supportsSatellite: true,
});

/** A pull type that does NOT support satellite execution (must be skipped). */
const coreOnlyType = defineTelemetrySourceType({
  id: "coreonly",
  displayName: "Core only",
  description: "",
  signals: ["logs"],
  configSchema: z.object({ url: z.string() }),
  pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30, execute: async () => {} },
});

function sourceRegistry() {
  const registry = createTelemetrySourceRegistry();
  registry.register(edgeType, { pluginId: "p" });
  registry.register(coreOnlyType, { pluginId: "p" });
  return registry;
}

interface HookCalls {
  failure: { consecutiveFailures: number; sourceName: string }[];
  recovery: { sourceName: string }[];
}

/** A registry whose edge type records its pull health-hook invocations. */
function hookedSourceRegistry(hookCalls: HookCalls) {
  const registry = createTelemetrySourceRegistry();
  registry.register(
    defineTelemetrySourceType({
      id: "edge",
      displayName: "Edge",
      description: "",
      signals: ["logs"],
      configSchema: z.object({
        url: z.string(),
        apiToken: configString({ "x-secret": true }).optional(),
      }),
      supportsSatellite: true,
      pull: {
        defaultIntervalSeconds: 60,
        minIntervalSeconds: 30,
        execute: async () => {},
        onRunFailure: async ({ consecutiveFailures, sourceName }) => {
          hookCalls.failure.push({ consecutiveFailures, sourceName });
        },
        onRunRecovery: async ({ sourceName }) => {
          hookCalls.recovery.push({ sourceName });
        },
      },
    }),
    { pluginId: "p" },
  );
  return registry;
}

/** A sink registry whose logs sink records each write and accepts everything. */
function recordingSinks(): {
  registry: TelemetrySinkRegistry;
  calls: { streamId: string; count: number }[];
} {
  const registry = createTelemetrySinkRegistry();
  const calls: { streamId: string; count: number }[] = [];
  const logsSink: RegisteredTelemetrySink = {
    signal: "logs",
    ownerPluginId: "logstream",
    assertBindable: async () => {},
    describeStream: async () => null,
    write: async ({ streamId, records }) => {
      calls.push({ streamId, count: records.length });
      return { accepted: records.length, rejected: 0 };
    },
  };
  registry.register(logsSink, { pluginId: "logstream" });
  return { registry, calls };
}

/** In-memory internal secrets store; `getCalls` proves the store is untouched. */
function memInternalSecrets(): {
  service: InternalSecretsService;
  getCalls: unknown[];
} {
  const store = new Map<string, string>();
  const getCalls: unknown[] = [];
  const key = (parts: string[]) => parts.join(" ");
  return {
    service: {
      set: async ({ parts, value }) => void store.set(key(parts), value),
      get: async (args) => {
        getCalls.push(args);
        return store.get(key(args.parts));
      },
      delete: async ({ parts }) => void store.delete(key(parts)),
    },
    getCalls,
  };
}

function logRecord(body: string): WireLogRecord {
  return { ts: NOW.toISOString(), body };
}

describe.skipIf(!isIntegrationEnabled())(
  "telemetry-pull capability handler (integration)",
  () => {
    let test: TestDb<typeof schema>;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    });
    afterAll(async () => {
      await test.dispose();
    });
    beforeEach(async () => {
      await test.db.delete(telemetrySources);
    });

    async function insertSource(input: {
      id: string;
      sourceTypeId?: string;
      satelliteId: string | null;
      enabled?: boolean;
      config?: Record<string, unknown>;
      bindings?: { signal: "logs" | "metrics" | "traces"; streamId: string }[];
      consecutiveFailures?: number;
    }): Promise<void> {
      await test.db.insert(telemetrySources).values({
        id: input.id,
        sourceTypeId: input.sourceTypeId ?? "p.edge",
        name: input.id,
        config: input.config ?? { url: `https://example.com/${input.id}` },
        bindings: input.bindings ?? [{ signal: "logs", streamId: "stream-1" }],
        enabled: input.enabled ?? true,
        intervalSeconds: null,
        satelliteId: input.satelliteId,
        consecutiveFailures: input.consecutiveFailures ?? 0,
        createdAt: CREATED,
        updatedAt: CREATED,
      });
    }

    function buildHandler() {
      const secrets = memInternalSecrets();
      const sinks = recordingSinks();
      const secretStore = createSourceSecretStore({
        internalSecrets: secrets.service,
      });
      const handler = createTelemetryPullCapabilityHandler({
        db: test.db,
        sourceRegistry: sourceRegistry(),
        sinkRegistry: sinks.registry,
        secretStore,
        secretResolver: createSecretResolverService({
          secretStore: { resolve: async (name: string) => `resolved:${name}` },
        }),
        logger: createMockLogger(),
        now: () => NOW,
      });
      return { handler, secretStore, calls: sinks.calls, getCalls: secrets.getCalls };
    }

    /** A handler whose edge type records its pull health-hook invocations. */
    function buildHookedHandler(hookCalls: HookCalls) {
      const secrets = memInternalSecrets();
      const sinks = recordingSinks();
      const handler = createTelemetryPullCapabilityHandler({
        db: test.db,
        sourceRegistry: hookedSourceRegistry(hookCalls),
        sinkRegistry: sinks.registry,
        secretStore: createSourceSecretStore({ internalSecrets: secrets.service }),
        secretResolver: createSecretResolverService({
          secretStore: { resolve: async (name: string) => `resolved:${name}` },
        }),
        logger: createMockLogger(),
        now: () => NOW,
      });
      return { handler };
    }

    // ─── buildCapabilityConfig ────────────────────────────────────────────

    it("builds only the satellite's enabled, satellite-capable instances, secrets stripped", async () => {
      await insertSource({
        id: "a-secret",
        satelliteId: SAT_A,
        config: {
          url: "https://a",
          apiToken: secretMarker({ sourceId: "a-secret", field: "apiToken" }),
        },
      });
      await insertSource({ id: "a-plain", satelliteId: SAT_A });
      await insertSource({ id: "a-disabled", satelliteId: SAT_A, enabled: false });
      await insertSource({ id: "b-bound", satelliteId: SAT_B });
      await insertSource({ id: "core", satelliteId: null });
      await insertSource({
        id: "a-coreonly",
        sourceTypeId: "p.coreonly",
        satelliteId: SAT_A,
      });

      const { handler } = buildHandler();
      const config = (await handler.buildCapabilityConfig!({
        satelliteId: SAT_A,
      })) as TelemetryPullConfig;
      const byId = new Map(config.instances.map((i) => [i.id, i]));

      // Only SAT_A's enabled, satellite-capable instances.
      expect([...byId.keys()].toSorted()).toEqual(["a-plain", "a-secret"]);

      // The secret marker is stripped from config and advertised in secretFields.
      expect(byId.get("a-secret")).toEqual({
        id: "a-secret",
        sourceTypeId: "p.edge",
        name: "a-secret",
        intervalSeconds: 60,
        timeoutMs: 30_000,
        config: { url: "https://a" },
        secretFields: ["apiToken"],
        boundSignals: ["logs"],
      });
      expect(byId.get("a-plain")!.secretFields).toEqual([]);
    });

    it("returns null for a satellite with no bound instances", async () => {
      await insertSource({ id: "core", satelliteId: null });
      const { handler } = buildHandler();
      const config = await handler.buildCapabilityConfig!({ satelliteId: SAT_A });
      expect(config).toBeNull();
    });

    // ─── resolveSecret: JIT, binding-authorized ───────────────────────────

    it("resolves a bound instance's secret JIT; a non-secret field errors without a store read", async () => {
      const { handler, secretStore, getCalls } = buildHandler();
      await insertSource({
        id: "a-secret",
        satelliteId: SAT_A,
        config: {
          url: "https://a",
          apiToken: secretMarker({ sourceId: "a-secret", field: "apiToken" }),
        },
      });
      await secretStore.apply({
        sourceId: "a-secret",
        toStore: [{ field: "apiToken", value: "s3cr3t" }],
        toClear: [],
      });

      // The advertised secret field resolves to its plaintext.
      const resolved = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { instanceId: "a-secret", field: "apiToken" },
      });
      expect(resolved).toEqual({ payload: { value: "s3cr3t" } });
      expect(getCalls).toHaveLength(1);

      // A field that is not a stored secret -> error, store not read again.
      const notSecret = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { instanceId: "a-secret", field: "url" },
      });
      expect(notSecret.error).toBeTruthy();
      expect(getCalls).toHaveLength(1);
    });

    it("resolves a ${{ secrets.NAME }} REFERENCE on an x-secret field JIT (never ships the template)", async () => {
      const { handler } = buildHandler();
      await insertSource({
        id: "a-ref",
        satelliteId: SAT_A,
        config: {
          url: "https://a",
          // A reference, not a stored marker: the platform resolver must
          // resolve it core-side - the agent must never see the template.
          apiToken: "${{ secrets.SCRAPE_BEARER }}",
        },
      });

      // buildCapabilityConfig treats the reference as a secret: omitted from
      // the pushed config, listed as a JIT field.
      // The registry interface types the payload opaquely; narrow to the wire
      // shape this handler emits (same pattern as the build test above).
      const config = (await handler.buildCapabilityConfig!({
        satelliteId: SAT_A,
      })) as TelemetryPullConfig;
      const instance = config.instances.find((entry) => entry.id === "a-ref");
      expect(instance?.config["apiToken"]).toBeUndefined();
      expect(instance?.secretFields).toContain("apiToken");

      // resolveSecret resolves the reference via the platform resolver.
      const resolved = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { instanceId: "a-ref", field: "apiToken" },
      });
      expect(resolved).toEqual({
        payload: { value: "resolved:SCRAPE_BEARER" },
      });

      // A reference on a NON-secret field never resolves (x-secret only).
      await insertSource({
        id: "a-ref-nonsecret",
        satelliteId: SAT_A,
        config: { url: "${{ secrets.NOT_A_SECRET_FIELD }}" },
      });
      const refused = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { instanceId: "a-ref-nonsecret", field: "url" },
      });
      expect(refused.error).toBeTruthy();
    });

    it("refuses to resolve for an instance bound to a different satellite (store untouched)", async () => {
      await insertSource({
        id: "b-secret",
        satelliteId: SAT_B,
        config: {
          url: "https://b",
          apiToken: secretMarker({ sourceId: "b-secret", field: "apiToken" }),
        },
      });
      const { handler, getCalls } = buildHandler();

      const mismatched = await handler.resolveSecret!({
        satelliteId: SAT_A, // not the bound satellite
        payload: { instanceId: "b-secret", field: "apiToken" },
      });
      expect(mismatched.payload).toBeUndefined();
      expect(mismatched.error).toBeTruthy();

      const unknown = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { instanceId: "ghost", field: "apiToken" },
      });
      expect(unknown.error).toBeTruthy();

      // Binding is the authorization: the store was never read.
      expect(getCalls).toHaveLength(0);
    });

    it("refuses to resolve for a disabled instance", async () => {
      await insertSource({
        id: "a-off",
        satelliteId: SAT_A,
        enabled: false,
        config: {
          url: "https://a",
          apiToken: secretMarker({ sourceId: "a-off", field: "apiToken" }),
        },
      });
      const { handler, getCalls } = buildHandler();
      const result = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { instanceId: "a-off", field: "apiToken" },
      });
      expect(result.error).toBeTruthy();
      expect(getCalls).toHaveLength(0);
    });

    it("returns an error for a malformed secret request", async () => {
      const { handler } = buildHandler();
      const result = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { nope: true },
      });
      expect(result.payload).toBeUndefined();
      expect(result.error).toBeTruthy();
    });

    // ─── handleTelemetryBatch: binding is the authorization ───────────────

    it("feeds records for a bound instance and rejects mismatched / unknown / disabled", async () => {
      await insertSource({ id: "a-bound", satelliteId: SAT_A });
      await insertSource({ id: "b-bound", satelliteId: SAT_B });
      await insertSource({ id: "a-off", satelliteId: SAT_A, enabled: false });

      const { handler, calls } = buildHandler();
      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SAT_A,
        payload: [
          { instanceId: "a-bound", records: { logs: [logRecord("x"), logRecord("y")] } },
          // Bound to SAT_B -> SAT_A may not report for it.
          { instanceId: "b-bound", records: { logs: [logRecord("z")] } },
          // Unknown instance.
          { instanceId: "ghost", records: { logs: [logRecord("q")] } },
          // Disabled instance.
          { instanceId: "a-off", records: { logs: [logRecord("d")] } },
        ],
      });

      // 2 accepted (a-bound), 3 rejected (b-bound + ghost + a-off).
      expect(outcome).toEqual({ accepted: 2, rejected: 3 });
      expect(calls).toEqual([{ streamId: "stream-1", count: 2 }]);
    });

    it("drops a malformed batch non-retryably", async () => {
      const { handler, calls } = buildHandler();
      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SAT_A,
        payload: { not: "an array" },
      });
      expect(outcome).toEqual({ accepted: 0, rejected: 0, retryable: false });
      expect(calls).toEqual([]);
    });

    // ─── handleCapabilityStatus ───────────────────────────────────────────

    it("mirrors per-instance pull health for a bound instance", async () => {
      await insertSource({ id: "a-bound", satelliteId: SAT_A });
      const { handler } = buildHandler();

      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          {
            instanceId: "a-bound",
            lastRunAt: NOW.toISOString(),
            lastError: "connection refused",
            consecutiveFailures: 3,
          },
        ],
      });

      const [row] = await test.db
        .select()
        .from(telemetrySources)
        .where(eq(telemetrySources.id, "a-bound"));
      expect(row!.lastError).toBe("connection refused");
      expect(row!.consecutiveFailures).toBe(3);
      expect(row!.lastRunAt?.toISOString()).toBe(NOW.toISOString());
    });

    it("ignores a status update for an instance bound to a different satellite", async () => {
      await insertSource({ id: "b-bound", satelliteId: SAT_B });
      const { handler } = buildHandler();
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A, // not the bound satellite
        payload: [
          {
            instanceId: "b-bound",
            lastRunAt: NOW.toISOString(),
            lastError: "spoofed",
            consecutiveFailures: 9,
          },
        ],
      });
      const [row] = await test.db
        .select()
        .from(telemetrySources)
        .where(eq(telemetrySources.id, "b-bound"));
      expect(row!.lastError).toBeNull();
      expect(row!.consecutiveFailures).toBe(0);
    });

    it("ignores a status update for a DISABLED instance (regression)", async () => {
      // A just-disabled instance still bound to SAT_A must not have its health
      // fields overwritten - consistent with the batch + secret paths, which
      // both reject a disabled instance.
      await insertSource({ id: "a-off", satelliteId: SAT_A, enabled: false });
      const { handler } = buildHandler();
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          {
            instanceId: "a-off",
            lastRunAt: NOW.toISOString(),
            lastError: "should be ignored",
            consecutiveFailures: 7,
          },
        ],
      });
      const [row] = await test.db
        .select()
        .from(telemetrySources)
        .where(eq(telemetrySources.id, "a-off"));
      expect(row!.lastError).toBeNull();
      expect(row!.consecutiveFailures).toBe(0);
    });

    it("fires onRunFailure with the just-stored count when a status raises failures", async () => {
      await insertSource({ id: "a-bound", satelliteId: SAT_A, consecutiveFailures: 2 });
      const hookCalls: HookCalls = { failure: [], recovery: [] };
      const { handler } = buildHookedHandler(hookCalls);
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          { instanceId: "a-bound", lastError: "connection refused", consecutiveFailures: 3 },
        ],
      });
      expect(hookCalls.failure).toEqual([
        { consecutiveFailures: 3, sourceName: "a-bound" },
      ]);
      expect(hookCalls.recovery).toEqual([]);
    });

    it("fires onRunRecovery once when a status clears failures back to zero", async () => {
      await insertSource({ id: "a-bound", satelliteId: SAT_A, consecutiveFailures: 5 });
      const hookCalls: HookCalls = { failure: [], recovery: [] };
      const { handler } = buildHookedHandler(hookCalls);
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          { instanceId: "a-bound", lastRunAt: NOW.toISOString(), consecutiveFailures: 0 },
        ],
      });
      expect(hookCalls.recovery).toEqual([{ sourceName: "a-bound" }]);
      expect(hookCalls.failure).toEqual([]);
    });

    it("mirrors health for every bound entry in a multi-entry payload", async () => {
      // The validation reads are batched into ONE query (mirrors
      // handleTelemetryBatch); assert the resulting per-row UPDATEs land. The
      // real Postgres harness has no query counter, so this asserts behavior
      // rather than the single-SELECT directly.
      await insertSource({ id: "a-one", satelliteId: SAT_A });
      await insertSource({ id: "a-two", satelliteId: SAT_A });
      const { handler } = buildHandler();
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          { instanceId: "a-one", lastError: "e1", consecutiveFailures: 1 },
          { instanceId: "a-two", lastError: "e2", consecutiveFailures: 2 },
        ],
      });
      const rows = await test.db
        .select()
        .from(telemetrySources)
        .where(
          inArray(telemetrySources.id, ["a-one", "a-two"]),
        );
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get("a-one")!.consecutiveFailures).toBe(1);
      expect(byId.get("a-one")!.lastError).toBe("e1");
      expect(byId.get("a-two")!.consecutiveFailures).toBe(2);
      expect(byId.get("a-two")!.lastError).toBe("e2");
    });
  },
);
