import { describe, it, expect } from "bun:test";
import type { PushEndpointDescriptor } from "@checkstack/telemetry-common";
import {
  buildPushSnippets,
  PUSH_TOKEN_PLACEHOLDER,
} from "./push-snippets.logic";

const otlp: PushEndpointDescriptor = {
  kind: "otlp",
  path: "/api/metricstream/v1/metrics",
  label: "OTLP metrics",
};
const native: PushEndpointDescriptor = {
  kind: "native",
  path: "/api/metricstream/ingest",
  label: "Native JSON",
};

describe("buildPushSnippets", () => {
  it("uses the per-signal OTLP endpoint key", () => {
    const [collector] = buildPushSnippets({
      origin: "https://checkstack.example.com",
      endpoints: [otlp],
      signals: ["metrics"],
      token: "ckms_live",
    });
    expect(collector.id).toBe("otel-collector");
    expect(collector.code).toContain(
      "metrics_endpoint: https://checkstack.example.com/api/metricstream/v1/metrics",
    );
    expect(collector.code).not.toContain("logs_endpoint");
    expect(collector.code).toContain("metrics:\n      exporters");
  });

  it("keys logs and traces endpoints from their signals", () => {
    const logs = buildPushSnippets({
      origin: "https://cs",
      endpoints: [{ ...otlp, path: "/api/logstream/v1/logs" }],
      signals: ["logs"],
    })[0];
    expect(logs.code).toContain("logs_endpoint: https://cs/api/logstream/v1/logs");

    const traces = buildPushSnippets({
      origin: "https://cs",
      endpoints: [{ ...otlp, path: "/api/tracestream/v1/traces" }],
      signals: ["traces"],
    })[0];
    expect(traces.code).toContain(
      "traces_endpoint: https://cs/api/tracestream/v1/traces",
    );
  });

  it("origin-prefixes every endpoint path and trims a trailing slash", () => {
    const snippets = buildPushSnippets({
      origin: "https://checkstack.example.com/",
      endpoints: [otlp, native],
      signals: ["metrics"],
    });
    const curl = snippets.find((s) => s.id === "curl");
    expect(curl?.code).toContain(
      'curl -X POST "https://checkstack.example.com/api/metricstream/ingest"',
    );
    expect(snippets[0].code).not.toContain(".com//api");
  });

  it("interpolates a live token into every snippet", () => {
    const snippets = buildPushSnippets({
      origin: "https://cs",
      endpoints: [otlp, native],
      signals: ["metrics"],
      token: "ckms_secret_value",
    });
    for (const snippet of snippets) {
      expect(snippet.code).toContain("Bearer ckms_secret_value");
      expect(snippet.code).not.toContain(PUSH_TOKEN_PLACEHOLDER);
    }
  });

  it("falls back to a visible placeholder when no token is given", () => {
    const [collector] = buildPushSnippets({
      origin: "https://cs",
      endpoints: [otlp],
      signals: ["metrics"],
    });
    expect(collector.code).toContain(`Bearer ${PUSH_TOKEN_PLACEHOLDER}`);
  });

  it("treats an empty-string token as no token", () => {
    const [collector] = buildPushSnippets({
      origin: "https://cs",
      endpoints: [otlp],
      signals: ["metrics"],
      token: "",
    });
    expect(collector.code).toContain(`Bearer ${PUSH_TOKEN_PLACEHOLDER}`);
  });

  it("emits only the OTLP snippet when there is no native endpoint", () => {
    const snippets = buildPushSnippets({
      origin: "https://cs",
      endpoints: [otlp],
      signals: ["metrics"],
    });
    expect(snippets.map((s) => s.id)).toEqual(["otel-collector"]);
  });

  it("emits only the curl snippet when there is no OTLP endpoint", () => {
    const snippets = buildPushSnippets({
      origin: "https://cs",
      endpoints: [native],
      signals: ["logs"],
    });
    expect(snippets.map((s) => s.id)).toEqual(["curl"]);
    expect(snippets[0].code).toContain('"level":"error"');
  });

  it("emits an endpoint key and pipeline per signal for multi-signal types", () => {
    const [collector] = buildPushSnippets({
      origin: "https://cs",
      endpoints: [otlp],
      signals: ["logs", "metrics"],
    });
    expect(collector.code).toContain("logs_endpoint:");
    expect(collector.code).toContain("metrics_endpoint:");
    expect(collector.code).toContain("    logs:");
    expect(collector.code).toContain("    metrics:");
  });

  it("picks the native example body from the first signal", () => {
    const [curl] = buildPushSnippets({
      origin: "https://cs",
      endpoints: [native],
      signals: ["traces"],
    });
    expect(curl.code).toContain("resourceSpans");
  });
});
