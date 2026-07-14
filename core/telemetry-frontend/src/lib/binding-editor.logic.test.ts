import { describe, it, expect } from "bun:test";
import type {
  SourceTypeDescriptor,
  TelemetrySource,
} from "@checkstack/telemetry-common";
import {
  bindingsToArray,
  buildStreamOptions,
  fromStreamValue,
  hasAtLeastOneBinding,
  initialBindingSelection,
  NOT_ROUTED_VALUE,
  signalLabel,
  toStreamValue,
} from "./binding-editor.logic";

const multiSignal: SourceTypeDescriptor = {
  id: "demo.otlp",
  ownerPluginId: "demo",
  displayName: "OTLP",
  description: "",
  signals: ["logs", "metrics"],
  modes: ["webhook"],
  configSchema: { type: "object", properties: {} },
  supportsSatellite: false,
};

const singleSignal: SourceTypeDescriptor = {
  ...multiSignal,
  id: "demo.metrics-only",
  signals: ["metrics"],
};

const source: TelemetrySource = {
  id: "src-1",
  sourceTypeId: "demo.otlp",
  name: "prod",
  description: null,
  config: {},
  storedSecretFields: [],
  bindings: [
    { signal: "logs", streamId: "log-stream" },
    { signal: "metrics", streamId: "metric-stream" },
  ],
  bindingStreamNames: {},
  enabled: true,
  intervalSeconds: null,
  satelliteId: null,
  lastRunAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("signalLabel", () => {
  it("titles each signal", () => {
    expect(signalLabel("logs")).toBe("Logs");
    expect(signalLabel("metrics")).toBe("Metrics");
    expect(signalLabel("traces")).toBe("Traces");
  });
});

describe("stream value round-trip", () => {
  it("maps null to the not-routed sentinel and back", () => {
    expect(toStreamValue(null)).toBe(NOT_ROUTED_VALUE);
    expect(toStreamValue(undefined)).toBe(NOT_ROUTED_VALUE);
    expect(toStreamValue("s1")).toBe("s1");
    expect(fromStreamValue(NOT_ROUTED_VALUE)).toBeNull();
    expect(fromStreamValue("s1")).toBe("s1");
  });
});

describe("initialBindingSelection", () => {
  it("starts every emitted signal unbound with no preset or source", () => {
    expect(initialBindingSelection({ descriptor: multiSignal })).toEqual({
      logs: null,
      metrics: null,
    });
  });

  it("presets only the embedding signal for a create from a stream section", () => {
    expect(
      initialBindingSelection({
        descriptor: multiSignal,
        presetSignal: "metrics",
        presetStreamId: "metric-stream",
      }),
    ).toEqual({ logs: null, metrics: "metric-stream" });
  });

  it("ignores a preset for a signal the type does not emit", () => {
    expect(
      initialBindingSelection({
        descriptor: singleSignal,
        presetSignal: "logs",
        presetStreamId: "log-stream",
      }),
    ).toEqual({ metrics: null });
  });

  it("pre-fills every stored binding for an edit", () => {
    expect(initialBindingSelection({ descriptor: multiSignal, source })).toEqual(
      { logs: "log-stream", metrics: "metric-stream" },
    );
  });
});

describe("bindingsToArray", () => {
  it("drops unbound signals and follows declared signal order", () => {
    expect(
      bindingsToArray({
        descriptor: multiSignal,
        selection: { metrics: "metric-stream", logs: null },
      }),
    ).toEqual([{ signal: "metrics", streamId: "metric-stream" }]);
  });

  it("emits one binding per bound signal in signal order", () => {
    expect(
      bindingsToArray({
        descriptor: multiSignal,
        selection: { logs: "l", metrics: "m" },
      }),
    ).toEqual([
      { signal: "logs", streamId: "l" },
      { signal: "metrics", streamId: "m" },
    ]);
  });
});

describe("hasAtLeastOneBinding", () => {
  it("is false when nothing is routed and true once one signal binds", () => {
    expect(
      hasAtLeastOneBinding({
        descriptor: multiSignal,
        selection: { logs: null, metrics: null },
      }),
    ).toBe(false);
    expect(
      hasAtLeastOneBinding({
        descriptor: multiSignal,
        selection: { logs: null, metrics: "m" },
      }),
    ).toBe(true);
  });
});

describe("buildStreamOptions", () => {
  const bindable = [
    { id: "s1", name: "Payments" },
    { id: "s2", name: "Checkout" },
  ];

  it("lists bindable streams with resolved names", () => {
    expect(buildStreamOptions({ bindable, selectedId: null })).toEqual([
      { value: "s1", label: "Payments", synthetic: false },
      { value: "s2", label: "Checkout", synthetic: false },
    ]);
  });

  it("keeps a selected-but-unlistable stream visible as a synthetic option", () => {
    const options = buildStreamOptions({ bindable, selectedId: "gone" });
    expect(options).toContainEqual({
      value: "gone",
      label: "Currently bound stream",
      synthetic: true,
    });
    expect(options).toHaveLength(3);
  });

  it("labels the synthetic option with the resolved name when known", () => {
    const options = buildStreamOptions({
      bindable,
      selectedId: "gone",
      selectedName: "Archived logs",
    });
    expect(options).toContainEqual({
      value: "gone",
      label: "Archived logs",
      synthetic: true,
    });
  });

  it("does not duplicate a selected stream already in the list", () => {
    expect(buildStreamOptions({ bindable, selectedId: "s1" })).toHaveLength(2);
  });

  it("adds no synthetic option when nothing is selected", () => {
    expect(
      buildStreamOptions({ bindable, selectedId: null }).some((o) => o.synthetic),
    ).toBe(false);
  });
});
