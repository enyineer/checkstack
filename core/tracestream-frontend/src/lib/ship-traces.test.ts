import { describe, expect, it } from "bun:test";
import {
  buildTraceSnippets,
  traceIngestOrigin,
  TOKEN_PLACEHOLDER,
  TRACESTREAM_ENDPOINTS,
} from "./ship-traces";

describe("traceIngestOrigin", () => {
  it("keeps scheme + host and drops a trailing slash and path", () => {
    expect(traceIngestOrigin("https://cs.example.com/")).toBe(
      "https://cs.example.com",
    );
    expect(traceIngestOrigin("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
  });
});

describe("buildTraceSnippets", () => {
  const baseUrl = "https://cs.example.com";

  it("returns the three shipper snippets in order", () => {
    const snippets = buildTraceSnippets({ baseUrl });
    expect(snippets.map((s) => s.id)).toEqual([
      "otel-sdk",
      "otel-collector",
      "curl",
    ]);
  });

  it("interpolates the real OTLP traces endpoint into every snippet", () => {
    const otlpUrl = `${baseUrl}${TRACESTREAM_ENDPOINTS.otlpTraces}`;
    for (const snippet of buildTraceSnippets({ baseUrl })) {
      expect(snippet.code).toContain(otlpUrl);
    }
  });

  it("uses a visible placeholder when no token is given", () => {
    for (const snippet of buildTraceSnippets({ baseUrl })) {
      expect(snippet.code).toContain(TOKEN_PLACEHOLDER);
    }
  });

  it("interpolates a real token when provided and never the placeholder", () => {
    const token = "cktr_abc_secret";
    for (const snippet of buildTraceSnippets({ baseUrl, token })) {
      expect(snippet.code).toContain(token);
      expect(snippet.code).not.toContain(TOKEN_PLACEHOLDER);
    }
  });

  it("emits the OTel SDK env var names and http/protobuf protocol", () => {
    const sdk = buildTraceSnippets({ baseUrl }).find((s) => s.id === "otel-sdk");
    expect(sdk?.code).toContain("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=");
    expect(sdk?.code).toContain("OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer");
    expect(sdk?.code).toContain("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf");
  });
});
