/**
 * Ship-traces setup snippets. Pure string builders so the Settings tab can
 * render copy-paste configs for every supported way to send spans, and so the
 * endpoint + token interpolation is unit-testable (a wrong endpoint or a
 * leaked/placeholder token in a snippet is a real bug). The component supplies
 * `baseUrl` from `window.location.origin`; `token` defaults to a visible
 * placeholder so we never bake a real secret into copyable text unless the
 * caller opts in. Mirrors `logstream-frontend`'s `ship-snippets.ts` mechanism.
 */

/** Ingest endpoint paths, mounted at `/api/tracestream{path}` (pluginId `tracestream`). */
export const TRACESTREAM_ENDPOINTS = {
  /** OTLP/HTTP traces (protobuf + JSON + gzip). */
  otlpTraces: "/api/tracestream/v1/traces",
  /** Native OTLP-JSON ingest (same shape, always JSON). */
  native: "/api/tracestream/ingest",
} as const;

/** Placeholder shown when the caller has no real token to interpolate. */
export const TOKEN_PLACEHOLDER = "<YOUR_SOURCE_TOKEN>";

export type ShipSnippetId = "otel-sdk" | "otel-collector" | "curl";

export interface ShipSnippet {
  id: ShipSnippetId;
  label: string;
  /** Fence language hint for the code block. */
  language: "env" | "yaml" | "bash";
  code: string;
  /** Short one-line description shown above the snippet. */
  description: string;
}

export interface BuildTraceSnippetsInput {
  /** Origin of the Checkstack instance, e.g. `https://checkstack.example.com`. */
  baseUrl: string;
  /** The source token to interpolate; omitted -> visible placeholder. */
  token?: string;
}

/** Parse a base URL into an origin, tolerant of a trailing slash. */
export function traceIngestOrigin(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = new URL(trimmed);
  const scheme = url.protocol === "https:" ? "https" : "http";
  return `${scheme}://${url.host}`;
}

/** Build the full set of trace-shipper snippets for a stream's endpoint + token. */
export function buildTraceSnippets({
  baseUrl,
  token,
}: BuildTraceSnippetsInput): ShipSnippet[] {
  const origin = traceIngestOrigin(baseUrl);
  const secret = token && token.length > 0 ? token : TOKEN_PLACEHOLDER;
  const otlpUrl = `${origin}${TRACESTREAM_ENDPOINTS.otlpTraces}`;

  return [
    {
      id: "otel-sdk",
      label: "OTel SDK",
      language: "env",
      description:
        "Point any OpenTelemetry SDK at the stream with these exporter env vars.",
      code: [
        `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${otlpUrl}`,
        `OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer ${secret}`,
        "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf",
      ].join("\n"),
    },
    {
      id: "otel-collector",
      label: "OTel Collector",
      language: "yaml",
      description:
        "Add an otlphttp exporter and wire it into your traces pipeline.",
      code: [
        "exporters:",
        "  otlphttp/checkstack:",
        `    traces_endpoint: ${otlpUrl}`,
        "    headers:",
        `      authorization: "Bearer ${secret}"`,
        "",
        "service:",
        "  pipelines:",
        "    traces:",
        "      exporters: [otlphttp/checkstack]",
      ].join("\n"),
    },
    {
      id: "curl",
      label: "curl (OTLP-JSON)",
      language: "bash",
      description:
        "Post a minimal OTLP-JSON trace directly for a quick end-to-end test.",
      code: [
        `curl -X POST "${otlpUrl}" \\`,
        `  -H "Authorization: Bearer ${secret}" \\`,
        '  -H "Content-Type: application/json" \\',
        String.raw`  --data-binary '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}}]},"scopeSpans":[{"spans":[{"traceId":"5b8aa5a2d2c872e8321cf37308d69df2","spanId":"051581bf3cb55c13","name":"POST /checkout","kind":2,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000000840000000"}]}]}]}'`,
      ].join("\n"),
    },
  ];
}
