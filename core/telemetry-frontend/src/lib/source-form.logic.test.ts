import { describe, it, expect } from "bun:test";
import { SECRET_CLEAR_SENTINEL } from "@checkstack/common";
import type {
  SourceTypeDescriptor,
  TelemetrySource,
} from "@checkstack/telemetry-common";
import {
  buildCreatePayload,
  buildUpdatePayload,
  clampInterval,
  deriveInitialInterval,
  isPullType,
  isWebhookType,
  supportsSatellitePicker,
  type SourceEditorValues,
} from "./source-form.logic";

const pullDescriptor: SourceTypeDescriptor = {
  id: "demo.poller",
  ownerPluginId: "demo",
  displayName: "Poller",
  description: "",
  signals: ["metrics"],
  modes: ["pull"],
  configSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      token: { type: "string", "x-secret": true },
    },
  },
  pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30 },
  supportsSatellite: false,
};

const webhookDescriptor: SourceTypeDescriptor = {
  id: "demo.hook",
  ownerPluginId: "demo",
  displayName: "Hook",
  description: "",
  signals: ["logs"],
  modes: ["webhook"],
  configSchema: { type: "object", properties: {} },
  supportsSatellite: false,
};

const pullSatelliteDescriptor: SourceTypeDescriptor = {
  ...pullDescriptor,
  id: "demo.edge-poller",
  supportsSatellite: true,
};

const existingSource: TelemetrySource = {
  id: "src-1",
  sourceTypeId: "demo.poller",
  name: "prod",
  description: "old",
  config: { url: "https://x" },
  storedSecretFields: ["token"],
  bindings: [{ signal: "metrics", streamId: "stream-1" }],
  bindingStreamNames: { metrics: "Payments metrics" },
  enabled: true,
  intervalSeconds: 120,
  satelliteId: null,
  lastRunAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const values = (over: Partial<SourceEditorValues>): SourceEditorValues => ({
  name: "prod",
  description: "",
  config: {},
  intervalSeconds: null,
  satelliteId: null,
  bindings: {},
  ...over,
});

describe("mode predicates", () => {
  it("classifies pull vs webhook", () => {
    expect(isPullType(pullDescriptor)).toBe(true);
    expect(isWebhookType(pullDescriptor)).toBe(false);
    expect(isWebhookType(webhookDescriptor)).toBe(true);
    expect(isPullType(webhookDescriptor)).toBe(false);
  });
});

describe("deriveInitialInterval", () => {
  it("seeds the type default for a pull type with no instance", () => {
    expect(deriveInitialInterval({ descriptor: pullDescriptor })).toBe(60);
  });

  it("prefers an instance's own override", () => {
    expect(
      deriveInitialInterval({
        descriptor: pullDescriptor,
        source: existingSource,
      }),
    ).toBe(120);
  });

  it("falls back to the default when the instance override is null", () => {
    expect(
      deriveInitialInterval({
        descriptor: pullDescriptor,
        source: { ...existingSource, intervalSeconds: null },
      }),
    ).toBe(60);
  });

  it("is null for non-pull types", () => {
    expect(deriveInitialInterval({ descriptor: webhookDescriptor })).toBeNull();
  });
});

describe("clampInterval", () => {
  it("raises a below-minimum value to the minimum", () => {
    expect(clampInterval({ value: 5, descriptor: pullDescriptor })).toBe(30);
  });

  it("keeps an at-or-above value (truncated to an integer)", () => {
    expect(clampInterval({ value: 90.7, descriptor: pullDescriptor })).toBe(90);
  });
});

describe("buildCreatePayload", () => {
  it("emits bindings from the editor selection and clamps the pull interval", () => {
    const payload = buildCreatePayload({
      descriptor: pullDescriptor,
      values: values({
        name: "  prod  ",
        intervalSeconds: 10,
        config: { url: "u" },
        bindings: { metrics: "stream-1" },
      }),
      teamId: "team-9",
    });
    expect(payload.sourceTypeId).toBe("demo.poller");
    expect(payload.name).toBe("prod");
    expect(payload.bindings).toEqual([{ signal: "metrics", streamId: "stream-1" }]);
    expect(payload.intervalSeconds).toBe(30);
    expect(payload.teamId).toBe("team-9");
    expect(payload.enabled).toBe(true);
  });

  it("emits one binding per routed signal for a multi-signal type", () => {
    const multi: SourceTypeDescriptor = {
      ...webhookDescriptor,
      id: "demo.otlp",
      signals: ["logs", "metrics"],
    };
    const payload = buildCreatePayload({
      descriptor: multi,
      values: values({ bindings: { logs: "log-1", metrics: "metric-1" } }),
    });
    expect(payload.bindings).toEqual([
      { signal: "logs", streamId: "log-1" },
      { signal: "metrics", streamId: "metric-1" },
    ]);
  });

  it("omits interval and blank description for webhook types, and null team", () => {
    const payload = buildCreatePayload({
      descriptor: webhookDescriptor,
      values: values({ description: "   ", bindings: { logs: "stream-2" } }),
      teamId: null,
    });
    expect(payload.intervalSeconds).toBeUndefined();
    expect(payload.description).toBeUndefined();
    expect(payload.teamId).toBeUndefined();
  });
});

describe("buildUpdatePayload secret handling", () => {
  it("omits a blank keep-existing secret so the stored value is kept", () => {
    const payload = buildUpdatePayload({
      descriptor: pullDescriptor,
      values: values({ config: { url: "https://x", token: "" } }),
      source: existingSource,
    });
    expect(payload.config).toEqual({ url: "https://x" });
  });

  it("keeps a newly typed secret value", () => {
    const payload = buildUpdatePayload({
      descriptor: pullDescriptor,
      values: values({ config: { url: "https://x", token: "fresh" } }),
      source: existingSource,
    });
    expect(payload.config).toEqual({ url: "https://x", token: "fresh" });
  });

  it("preserves an explicit clear sentinel (positive removal)", () => {
    const payload = buildUpdatePayload({
      descriptor: pullDescriptor,
      values: values({
        config: { url: "https://x", token: SECRET_CLEAR_SENTINEL },
      }),
      source: existingSource,
    });
    expect(payload.config).toEqual({
      url: "https://x",
      token: SECRET_CLEAR_SENTINEL,
    });
  });

  it("clears the description when blank and clamps the pull interval", () => {
    const payload = buildUpdatePayload({
      descriptor: pullDescriptor,
      values: values({ description: "", intervalSeconds: 1 }),
      source: existingSource,
    });
    expect(payload.description).toBeNull();
    expect(payload.intervalSeconds).toBe(30);
  });

  it("leaves the interval untouched for non-pull types", () => {
    const payload = buildUpdatePayload({
      descriptor: webhookDescriptor,
      values: values({ intervalSeconds: 99, bindings: { logs: "s" } }),
      source: { ...existingSource, sourceTypeId: "demo.hook" },
    });
    expect(payload.intervalSeconds).toBeUndefined();
  });

  it("emits the edited bindings array", () => {
    const payload = buildUpdatePayload({
      descriptor: pullDescriptor,
      values: values({ config: { url: "https://x" }, bindings: { metrics: "stream-2" } }),
      source: existingSource,
    });
    expect(payload.bindings).toEqual([
      { signal: "metrics", streamId: "stream-2" },
    ]);
  });
});

describe("supportsSatellitePicker", () => {
  it("is true only for a pull type that opted into satellite execution", () => {
    expect(supportsSatellitePicker(pullSatelliteDescriptor)).toBe(true);
    expect(supportsSatellitePicker(pullDescriptor)).toBe(false); // supportsSatellite false
    expect(supportsSatellitePicker(webhookDescriptor)).toBe(false); // not pull
  });
});

describe("satelliteId in payloads", () => {
  it("create: sends the chosen satellite for a satellite-capable pull type", () => {
    const payload = buildCreatePayload({
      descriptor: pullSatelliteDescriptor,
      values: values({ satelliteId: "sat-7", bindings: { metrics: "stream-1" } }),
    });
    expect(payload.satelliteId).toBe("sat-7");
  });

  it("create: omits satelliteId when core is chosen (null) or type lacks support", () => {
    expect(
      buildCreatePayload({
        descriptor: pullSatelliteDescriptor,
        values: values({ satelliteId: null, bindings: { metrics: "stream-1" } }),
      }).satelliteId,
    ).toBeUndefined();
    expect(
      buildCreatePayload({
        descriptor: pullDescriptor,
        values: values({ satelliteId: "sat-7", bindings: { metrics: "stream-1" } }),
      }).satelliteId,
    ).toBeUndefined();
  });

  it("update: passes through core (null clears) for a satellite-capable pull type", () => {
    expect(
      buildUpdatePayload({
        descriptor: pullSatelliteDescriptor,
        values: values({ satelliteId: null }),
        source: existingSource,
      }).satelliteId,
    ).toBeNull();
    expect(
      buildUpdatePayload({
        descriptor: pullSatelliteDescriptor,
        values: values({ satelliteId: "sat-9" }),
        source: existingSource,
      }).satelliteId,
    ).toBe("sat-9");
  });

  it("update: leaves satelliteId untouched for a type without satellite support", () => {
    expect(
      buildUpdatePayload({
        descriptor: pullDescriptor,
        values: values({ satelliteId: "sat-9" }),
        source: existingSource,
      }).satelliteId,
    ).toBeUndefined();
  });
});
