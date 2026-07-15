import { describe, it, expect } from "bun:test";
import type {
  SourceTypeDescriptor,
  TelemetrySource,
} from "@checkstack/telemetry-common";
import { shouldHideSourcesSection, indexSourceTypes } from "./sources-section.logic";

const descriptor = (id: string): SourceTypeDescriptor => ({
  id,
  ownerPluginId: "demo",
  displayName: id,
  description: "",
  signals: ["logs"],
  modes: ["webhook"],
  configSchema: { type: "object", properties: {} },
  supportsSatellite: false,
});

const source = (id: string): TelemetrySource => ({
  id,
  sourceTypeId: "demo.thing",
  name: id,
  description: null,
  config: {},
  storedSecretFields: [],
  bindings: [{ signal: "logs", streamId: "stream-1" }],
  bindingStreamNames: {},
  enabled: true,
  intervalSeconds: null,
  satelliteId: null,
  lastRunAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("shouldHideSourcesSection", () => {
  it("hides only when there are no types AND no bound sources", () => {
    expect(
      shouldHideSourcesSection({ sourceTypes: [], sources: [] }),
    ).toBe(true);
  });

  it("shows when a type exists even with no bound sources yet", () => {
    expect(
      shouldHideSourcesSection({
        sourceTypes: [descriptor("demo.thing")],
        sources: [],
      }),
    ).toBe(false);
  });

  it("shows when a bound source exists even if its type is gone", () => {
    expect(
      shouldHideSourcesSection({ sourceTypes: [], sources: [source("s1")] }),
    ).toBe(false);
  });
});

describe("indexSourceTypes", () => {
  it("keys descriptors by their qualified id", () => {
    const index = indexSourceTypes([
      descriptor("demo.a"),
      descriptor("demo.b"),
    ]);
    expect(index.size).toBe(2);
    expect(index.get("demo.a")?.id).toBe("demo.a");
    expect(index.get("demo.missing")).toBeUndefined();
  });
});
