/**
 * Ship-logs setup snippets. Pure string builders so the Settings tab can render
 * copy-paste configs for every supported log shipper, and so the URL + token
 * interpolation is unit-testable (a wrong endpoint or a leaked/placeholder token
 * in a snippet is a real bug). The component supplies `baseUrl` from
 * `window.location.origin`; `token` defaults to a visible placeholder so we
 * never bake a real secret into copyable text unless the caller opts in.
 */

/** Ingest endpoint paths, mounted at `/api/{pluginId}{path}` (pluginId `logstream`). */
export const LOGSTREAM_ENDPOINTS = {
  /** OTLP/HTTP logs (JSON + protobuf + gzip). */
  otlpLogs: "/api/logstream/v1/logs",
  /** Native JSON / NDJSON ingest. */
  native: "/api/logstream/ingest",
} as const;

/** RFC 5424 structured-data element id carrying the source token for syslog. */
export const SYSLOG_SD_ID = "checkstack@50501";

/** Placeholder shown when the caller has no real token to interpolate. */
export const TOKEN_PLACEHOLDER = "<YOUR_SOURCE_TOKEN>";

/** Placeholder for the operator-configured syslog TCP port. */
export const SYSLOG_PORT_PLACEHOLDER = "<SYSLOG_PORT>";

export type ShipSnippetId =
  | "otel-collector"
  | "fluent-bit"
  | "vector"
  | "curl"
  | "rsyslog";

export interface ShipSnippet {
  id: ShipSnippetId;
  label: string;
  /** Fence language hint for the code block. */
  language: "yaml" | "ini" | "toml" | "bash" | "text";
  code: string;
  /** Short one-line description shown above the snippet. */
  description: string;
}

export interface BuildShipSnippetsInput {
  /** Origin of the Checkstack instance, e.g. `https://checkstack.example.com`. */
  baseUrl: string;
  /** The source token to interpolate; omitted -> visible placeholder. */
  token?: string;
}

interface ParsedBase {
  origin: string;
  host: string;
  scheme: "http" | "https";
  /** Explicit port, or the scheme default. */
  port: string;
  tls: boolean;
}

/** Parse a base URL into the parts the snippets need; tolerant of trailing slash. */
export function parseBaseUrl(baseUrl: string): ParsedBase {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = new URL(trimmed);
  const scheme = url.protocol === "https:" ? "https" : "http";
  const port = url.port || (scheme === "https" ? "443" : "80");
  return {
    origin: `${scheme}://${url.host}`,
    host: url.hostname,
    scheme,
    port,
    tls: scheme === "https",
  };
}

/** Build the full set of shipper snippets for a stream's endpoints + token. */
export function buildShipSnippets({
  baseUrl,
  token,
}: BuildShipSnippetsInput): ShipSnippet[] {
  const base = parseBaseUrl(baseUrl);
  const secret = token && token.length > 0 ? token : TOKEN_PLACEHOLDER;
  const otlpUrl = `${base.origin}${LOGSTREAM_ENDPOINTS.otlpLogs}`;
  const nativeUrl = `${base.origin}${LOGSTREAM_ENDPOINTS.native}`;

  return [
    {
      id: "otel-collector",
      label: "OTel Collector",
      language: "yaml",
      description:
        "Add an otlphttp exporter and wire it into your logs pipeline.",
      code: [
        "exporters:",
        "  otlphttp/checkstack:",
        `    logs_endpoint: ${otlpUrl}`,
        "    headers:",
        `      Authorization: "Bearer ${secret}"`,
        "",
        "service:",
        "  pipelines:",
        "    logs:",
        "      exporters: [otlphttp/checkstack]",
      ].join("\n"),
    },
    {
      id: "fluent-bit",
      label: "Fluent Bit",
      language: "ini",
      description: "Use the opentelemetry output plugin (OTLP/HTTP).",
      code: [
        "[OUTPUT]",
        "    Name             opentelemetry",
        "    Match            *",
        `    Host             ${base.host}`,
        `    Port             ${base.port}`,
        `    Logs_uri         ${LOGSTREAM_ENDPOINTS.otlpLogs}`,
        `    Tls              ${base.tls ? "On" : "Off"}`,
        `    Header           Authorization Bearer ${secret}`,
      ].join("\n"),
    },
    {
      id: "vector",
      label: "Vector",
      language: "toml",
      description: "An http sink posting NDJSON to the native endpoint.",
      code: [
        "[sinks.checkstack]",
        'type = "http"',
        'inputs = ["my_logs"]',
        `uri = "${nativeUrl}"`,
        'encoding.codec = "ndjson"',
        `request.headers.Authorization = "Bearer ${secret}"`,
      ].join("\n"),
    },
    {
      id: "curl",
      label: "curl (NDJSON)",
      language: "bash",
      description: "Post newline-delimited JSON directly for a quick test.",
      code: [
        `curl -X POST "${nativeUrl}" \\`,
        `  -H "Authorization: Bearer ${secret}" \\`,
        '  -H "Content-Type: application/x-ndjson" \\',
        String.raw`  --data-binary $'{"level":"error","message":"payment failed","service":"checkout"}\n{"level":"info","message":"checkout ok","service":"checkout"}'`,
      ].join("\n"),
    },
    {
      id: "rsyslog",
      label: "rsyslog",
      language: "text",
      description:
        "Forward RFC 5424 over TCP; the token rides in structured data.",
      code: [
        "# /etc/rsyslog.d/checkstack.conf",
        'template(name="checkstackFmt" type="string"',
        '  string="<%PRI%>1 %TIMESTAMP:::date-rfc3339% %HOSTNAME% %APP-NAME% %PROCID% %MSGID% ' +
          String.raw`[${SYSLOG_SD_ID} token=\"${secret}\"] %msg%\n")`,
        "",
        'action(type="omfwd"',
        `  target="${base.host}" port="${SYSLOG_PORT_PLACEHOLDER}" protocol="tcp"`,
        '  template="checkstackFmt")',
      ].join("\n"),
    },
  ];
}
