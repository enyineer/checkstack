import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { PluginMetadata } from "@checkstack/common";
import { configString, withConfigMeta } from "@checkstack/backend-api";
import {
  createTelemetrySinkRegistry,
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  toSourceTypeDescriptor,
  type TelemetrySinkContribution,
} from "./extension-points";

const ownerMeta: PluginMetadata = { pluginId: "logstream" };
const otherMeta: PluginMetadata = { pluginId: "someplugin" };

function fakeSink(signal: "logs" | "metrics"): TelemetrySinkContribution {
  return {
    signal,
    assertBindable: () => Promise.resolve(),
    describeStream: () => Promise.resolve(null),
    write: () => Promise.resolve({ accepted: 0, rejected: 0 }),
  };
}

describe("createTelemetrySinkRegistry", () => {
  it("registers one sink per signal and lists them", () => {
    const registry = createTelemetrySinkRegistry();
    registry.register(fakeSink("logs"), ownerMeta);
    registry.register(fakeSink("metrics"), otherMeta);
    expect(registry.get("logs")?.ownerPluginId).toBe("logstream");
    expect(registry.get("traces")).toBeUndefined();
    expect(registry.list()).toHaveLength(2);
  });

  it("rejects a duplicate sink for the same signal", () => {
    const registry = createTelemetrySinkRegistry();
    registry.register(fakeSink("logs"), ownerMeta);
    expect(() => registry.register(fakeSink("logs"), otherMeta)).toThrow(
      /duplicate sink for signal "logs"/,
    );
  });
});

const validPull = defineTelemetrySourceType({
  id: "poller",
  displayName: "Poller",
  description: "Polls something",
  signals: ["metrics"],
  configSchema: z.object({ url: z.string() }),
  pull: {
    defaultIntervalSeconds: 60,
    minIntervalSeconds: 10,
    execute: async ({ config }) => {
      // Config is inferred from the schema - this line is the type assertion.
      config.url satisfies string;
    },
  },
});

describe("createTelemetrySourceRegistry", () => {
  it("qualifies ids with the owning plugin id", () => {
    const registry = createTelemetrySourceRegistry();
    registry.register(validPull, otherMeta);
    expect(registry.get("someplugin.poller")?.ownerPluginId).toBe(
      "someplugin",
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects a duplicate qualified id", () => {
    const registry = createTelemetrySourceRegistry();
    registry.register(validPull, otherMeta);
    expect(() => registry.register(validPull, otherMeta)).toThrow(
      /duplicate source type/,
    );
  });

  it("rejects a type with no signals", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register({ ...validPull, id: "empty", signals: [] }, otherMeta),
    ).toThrow(/declares no signals/);
  });

  it("rejects a type with no pull, webhook, listener, derive or push seam", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register(
        { ...validPull, id: "seamless", pull: undefined },
        otherMeta,
      ),
    ).toThrow(/none of pull, webhook, listener, derive or push/);
  });

  it("accepts a top-level x-secret string field (marker round-trips)", () => {
    const registry = createTelemetrySourceRegistry();
    registry.register(
      {
        ...validPull,
        id: "sec-ok",
        configSchema: z.object({
          url: z.string(),
          apiToken: configString({ "x-secret": true }).optional(),
        }),
      },
      otherMeta,
    );
    expect(registry.get("someplugin.sec-ok")).toBeDefined();
  });

  it("rejects a NESTED x-secret field (top-level only)", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register(
        {
          ...validPull,
          id: "sec-nested",
          configSchema: z.object({
            auth: z.object({ token: configString({ "x-secret": true }) }),
          }),
        },
        otherMeta,
      ),
    ).toThrow(/nested x-secret/i);
  });

  it("rejects an x-secret field whose schema rejects the marker string", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register(
        {
          ...validPull,
          id: "sec-refined",
          configSchema: z.object({
            // A max-length refinement rejects the (long) marker string.
            apiToken: withConfigMeta(z.string().max(5), { "x-secret": true }),
          }),
        },
        otherMeta,
      ),
    ).toThrow(/rejects the internal secret marker/i);
  });

  it("accepts a listener-only type", () => {
    const registry = createTelemetrySourceRegistry();
    registry.register(
      {
        ...validPull,
        id: "syslog",
        pull: undefined,
        listener: { start: async () => () => {} },
      },
      otherMeta,
    );
    const descriptor = toSourceTypeDescriptor(registry.get("someplugin.syslog")!);
    expect(descriptor.modes).toEqual(["listener"]);
  });

  it("rejects a default interval below the minimum", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register(
        {
          ...validPull,
          id: "fast",
          pull: { ...validPull.pull!, defaultIntervalSeconds: 5 },
        },
        otherMeta,
      ),
    ).toThrow(/invalid pull intervals/);
  });

  it("rejects supportsSatellite on a webhook-only type", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register(
        {
          ...validPull,
          id: "hooked",
          pull: undefined,
          supportsSatellite: true,
          webhook: {
            handle: async () => new Response(null, { status: 202 }),
          },
        },
        otherMeta,
      ),
    ).toThrow(/supportsSatellite without a pull seam/);
  });

  it("accepts a valid GitHub-style webhook signature descriptor", () => {
    const registry = createTelemetrySourceRegistry();
    registry.register(
      {
        ...validPull,
        id: "gh",
        pull: undefined,
        webhook: {
          handle: async () => new Response(null, { status: 202 }),
          signature: {
            algorithm: "hmac-sha256",
            header: "x-hub-signature-256",
            encoding: "hex",
            prefix: "sha256=",
            basestring: "body",
          },
        },
      },
      otherMeta,
    );
    expect(registry.get("someplugin.gh")).toBeDefined();
  });

  it("rejects a versioned signature missing timestampHeader/toleranceSeconds", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register(
        {
          ...validPull,
          id: "slack-bad",
          pull: undefined,
          webhook: {
            handle: async () => new Response(null, { status: 202 }),
            signature: {
              algorithm: "hmac-sha256",
              header: "x-slack-signature",
              encoding: "hex",
              prefix: "v0=",
              basestring: "versioned-timestamp-body",
            },
          },
        },
        otherMeta,
      ),
    ).toThrow(/invalid webhook\.signature/i);
  });

  it("rejects a versioned signature missing the prefix", () => {
    const registry = createTelemetrySourceRegistry();
    expect(() =>
      registry.register(
        {
          ...validPull,
          id: "slack-noprefix",
          pull: undefined,
          webhook: {
            handle: async () => new Response(null, { status: 202 }),
            signature: {
              algorithm: "hmac-sha256",
              header: "x-slack-signature",
              encoding: "hex",
              basestring: "versioned-timestamp-body",
              timestampHeader: "x-slack-request-timestamp",
              toleranceSeconds: 300,
            },
          },
        },
        otherMeta,
      ),
    ).toThrow(/invalid webhook\.signature/i);
  });
});

describe("toSourceTypeDescriptor", () => {
  it("derives modes, intervals and a JSON-schema config", () => {
    const registry = createTelemetrySourceRegistry();
    registry.register(validPull, otherMeta);
    const descriptor = toSourceTypeDescriptor(
      registry.get("someplugin.poller")!,
    );
    expect(descriptor.modes).toEqual(["pull"]);
    expect(descriptor.pull?.minIntervalSeconds).toBe(10);
    expect(descriptor.supportsSatellite).toBe(false);
    const properties = descriptor.configSchema.properties as Record<
      string,
      unknown
    >;
    expect(properties.url).toBeDefined();
  });
});
