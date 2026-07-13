/**
 * Ship-metrics setup snippets. Pure string builders so the Sources tab can
 * render copy-paste configs for the push sources (OTLP/HTTP and native JSON),
 * templated with this instance's real endpoints and a source token. Prometheus
 * is a PULL source (configured as a scrape target), so it has no push snippet.
 * The URL + token interpolation is unit-testable (a wrong endpoint or a
 * placeholder token leaking into a snippet is a real bug).
 */

/** Ingest endpoint paths, mounted at `/api/{pluginId}{path}` (pluginId `metricstream`). */
export const METRICSTREAM_ENDPOINTS = {
  /** OTLP/HTTP metrics (JSON + protobuf + gzip). */
  otlpMetrics: "/api/metricstream/v1/metrics",
  /** Native JSON ingest. */
  native: "/api/metricstream/ingest",
} as const;

/** Placeholder shown when the caller has no real token to interpolate. */
export const TOKEN_PLACEHOLDER = "<YOUR_SOURCE_TOKEN>";

export type MetricSnippetId = "otel-collector" | "curl";

export interface MetricSnippet {
  id: MetricSnippetId;
  label: string;
  /** Fence language hint for the code block. */
  language: "yaml" | "bash";
  code: string;
  /** Short one-line description shown above the snippet. */
  description: string;
}

export interface BuildMetricSnippetsInput {
  /** Origin of the Checkstack instance, e.g. `https://checkstack.example.com`. */
  baseUrl: string;
  /** The source token to interpolate; omitted -> visible placeholder. */
  token?: string;
}

/** Build the push-source snippets for a stream's endpoints + token. */
export function buildMetricSnippets({
  baseUrl,
  token,
}: BuildMetricSnippetsInput): MetricSnippet[] {
  const origin = baseUrl.replace(/\/+$/, "");
  const secret = token && token.length > 0 ? token : TOKEN_PLACEHOLDER;
  const otlpUrl = `${origin}${METRICSTREAM_ENDPOINTS.otlpMetrics}`;
  const nativeUrl = `${origin}${METRICSTREAM_ENDPOINTS.native}`;

  return [
    {
      id: "otel-collector",
      label: "OTel Collector",
      language: "yaml",
      description:
        "Add an otlphttp exporter and wire it into your metrics pipeline.",
      code: [
        "exporters:",
        "  otlphttp/checkstack:",
        `    metrics_endpoint: ${otlpUrl}`,
        "    headers:",
        `      Authorization: "Bearer ${secret}"`,
        "",
        "service:",
        "  pipelines:",
        "    metrics:",
        "      exporters: [otlphttp/checkstack]",
      ].join("\n"),
    },
    {
      id: "curl",
      label: "curl (native JSON)",
      language: "bash",
      description: "Post native JSON datapoints directly for a quick test.",
      code: [
        `curl -X POST "${nativeUrl}" \\`,
        `  -H "Authorization: Bearer ${secret}" \\`,
        '  -H "Content-Type: application/json" \\',
        String.raw`  --data '{"metrics":[{"name":"orders_total","type":"counter","value":42,"labels":{"service":"checkout"}}]}'`,
      ].join("\n"),
    },
  ];
}
