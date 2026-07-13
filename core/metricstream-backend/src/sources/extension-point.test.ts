import { describe, it, expect } from "bun:test";
import { definePluginMetadata } from "@checkstack/common";
import {
  createMetricSourceRegistry,
  type MetricSourceType,
} from "./extension-point";

const pluginMetadata = definePluginMetadata({ pluginId: "metricstream" });

const otlp: MetricSourceType = {
  id: "otlp",
  displayName: "OTLP/HTTP",
  kind: "push",
  registerPush: () => {},
};

const prometheus: MetricSourceType = {
  id: "prometheus",
  displayName: "Prometheus scrape",
  kind: "pull",
  executePull: async () => ({ datapointCount: 0, seriesCount: 0 }),
};

describe("MetricSourceRegistry", () => {
  it("qualifies ids with the registering plugin id", () => {
    const registry = createMetricSourceRegistry();
    registry.register(otlp, pluginMetadata);
    expect(registry.get("metricstream.otlp")?.displayName).toBe("OTLP/HTTP");
    expect(registry.list()).toHaveLength(1);
  });

  it("registers push and pull sources side by side", () => {
    const registry = createMetricSourceRegistry();
    registry.register(otlp, pluginMetadata);
    registry.register(prometheus, pluginMetadata);
    expect(registry.list().map((s) => s.kind).sort()).toEqual(["pull", "push"]);
  });

  it("rejects a duplicate qualified id (a wiring bug, not a merge)", () => {
    const registry = createMetricSourceRegistry();
    registry.register(otlp, pluginMetadata);
    expect(() => registry.register(otlp, pluginMetadata)).toThrow(
      /duplicate metric source type/,
    );
  });
});
