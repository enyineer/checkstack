import { describe, it, expect } from "bun:test";
import {
  buildMetricSnippets,
  METRICSTREAM_ENDPOINTS,
  TOKEN_PLACEHOLDER,
} from "./ship-metrics";

describe("buildMetricSnippets", () => {
  it("interpolates the real token into every snippet when given one", () => {
    const snippets = buildMetricSnippets({
      baseUrl: "https://cs.example.com",
      token: "ckms_secret123",
    });
    for (const s of snippets) {
      expect(s.code).toContain("ckms_secret123");
      expect(s.code).not.toContain(TOKEN_PLACEHOLDER);
    }
  });

  it("falls back to a visible placeholder (never a blank/real token) when absent", () => {
    const snippets = buildMetricSnippets({ baseUrl: "https://cs.example.com" });
    for (const s of snippets) {
      expect(s.code).toContain(TOKEN_PLACEHOLDER);
    }
  });

  it("targets the OTLP + native endpoints on the given origin, trimming a trailing slash", () => {
    const [otel, curl] = buildMetricSnippets({
      baseUrl: "https://cs.example.com/",
    });
    expect(otel.code).toContain(
      `https://cs.example.com${METRICSTREAM_ENDPOINTS.otlpMetrics}`,
    );
    expect(curl.code).toContain(
      `https://cs.example.com${METRICSTREAM_ENDPOINTS.native}`,
    );
  });
});
