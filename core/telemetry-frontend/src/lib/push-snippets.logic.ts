import type {
  PushEndpointDescriptor,
  TelemetrySignal,
} from "@checkstack/telemetry-common";

/**
 * Setup-snippet builders for PUSH source instances. Pure string builders so the
 * reveal panel can render copy-paste shipper configs, templated from the type's
 * descriptor endpoints, its signals, and (optionally) a freshly-minted token.
 * Kept pure and unit-tested because the interpolation carries real correctness:
 * a wrong OTLP endpoint key, a missing origin prefix, or a placeholder token
 * leaking into a snippet that should carry a live one are all real bugs.
 */

/** Placeholder shown when the caller has no real token to interpolate. */
export const PUSH_TOKEN_PLACEHOLDER = "<YOUR_SOURCE_TOKEN>";

export type PushSnippetId = "otel-collector" | "curl";

export interface PushSnippet {
  id: PushSnippetId;
  label: string;
  /** Fence language hint for the code block. */
  language: "yaml" | "bash";
  code: string;
  /** Short one-line description shown above the snippet. */
  description: string;
}

export interface BuildPushSnippetsInput {
  /** Origin of the Checkstack instance, e.g. `https://checkstack.example.com`. */
  origin: string;
  /** The type's inbound endpoints (from the descriptor / PushInfo). */
  endpoints: PushEndpointDescriptor[];
  /** Signals the instance emits; drives the OTLP endpoint keys. */
  signals: TelemetrySignal[];
  /** The source token to interpolate; omitted -> visible placeholder. */
  token?: string;
}

/**
 * The OTel Collector `otlphttp` exporter keys a separate endpoint per signal
 * (`logs_endpoint` / `metrics_endpoint` / `traces_endpoint`). Our signal names
 * are already the plural stem the exporter expects, so the key is
 * `${signal}_endpoint`.
 */
function otlpEndpointKey(signal: TelemetrySignal): string {
  return `${signal}_endpoint`;
}

/** A minimal, signal-appropriate example body for the native `curl` snippet. */
const NATIVE_EXAMPLE_BODY: Record<TelemetrySignal, string> = {
  logs: '{"level":"error","message":"payment failed","service":"checkout"}',
  metrics:
    '{"metrics":[{"name":"orders_total","type":"counter","value":42,"labels":{"service":"checkout"}}]}',
  traces:
    '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}}]},"scopeSpans":[{"spans":[{"traceId":"5b8aa5a2d2c872e8321cf37308d69df2","spanId":"051581bf3cb55c13","name":"POST /checkout","kind":2,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000000840000000"}]}]}]}',
};

/** Strip trailing slashes so `${origin}${path}` never doubles a separator. */
function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/**
 * Build the push-source snippets for the given endpoints, signals, and token.
 * Emits an OTel Collector snippet for the `otlp` endpoint (if any) and a `curl`
 * snippet for the `native` endpoint (if any); a type may serve either or both.
 */
export function buildPushSnippets({
  origin,
  endpoints,
  signals,
  token,
}: BuildPushSnippetsInput): PushSnippet[] {
  const base = trimOrigin(origin);
  const secret = token && token.length > 0 ? token : PUSH_TOKEN_PLACEHOLDER;
  const otlp = endpoints.find((endpoint) => endpoint.kind === "otlp");
  const native = endpoints.find((endpoint) => endpoint.kind === "native");
  // Fall back to every signal name if the caller passed none, so a snippet is
  // never emitted with an empty exporter/pipeline.
  const emitted: TelemetrySignal[] =
    signals.length > 0 ? signals : ["logs", "metrics", "traces"];

  const snippets: PushSnippet[] = [];

  if (otlp) {
    const otlpUrl = `${base}${otlp.path}`;
    const endpointLines = emitted.map(
      (signal) => `    ${otlpEndpointKey(signal)}: ${otlpUrl}`,
    );
    const pipelineLines = emitted.flatMap((signal) => [
      `    ${signal}:`,
      "      exporters: [otlphttp/checkstack]",
    ]);
    snippets.push({
      id: "otel-collector",
      label: "OTel Collector",
      language: "yaml",
      description:
        "Add an otlphttp exporter and wire it into your pipeline(s).",
      code: [
        "exporters:",
        "  otlphttp/checkstack:",
        ...endpointLines,
        "    headers:",
        `      Authorization: "Bearer ${secret}"`,
        "",
        "service:",
        "  pipelines:",
        ...pipelineLines,
      ].join("\n"),
    });
  }

  if (native) {
    const nativeUrl = `${base}${native.path}`;
    const body = NATIVE_EXAMPLE_BODY[emitted[0]];
    snippets.push({
      id: "curl",
      label: "curl (native)",
      language: "bash",
      description: "Post directly to the native endpoint for a quick test.",
      code: [
        `curl -X POST "${nativeUrl}" \\`,
        `  -H "Authorization: Bearer ${secret}" \\`,
        '  -H "Content-Type: application/json" \\',
        `  --data '${body}'`,
      ].join("\n"),
    });
  }

  return snippets;
}
