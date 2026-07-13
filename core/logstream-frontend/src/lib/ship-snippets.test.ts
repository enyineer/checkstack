import { describe, expect, it } from "bun:test";
import {
  buildShipSnippets,
  LOGSTREAM_ENDPOINTS,
  parseBaseUrl,
  SYSLOG_SD_ID,
  TOKEN_PLACEHOLDER,
  type ShipSnippetId,
} from "./ship-snippets";

const ALL_IDS: ShipSnippetId[] = [
  "otel-collector",
  "fluent-bit",
  "vector",
  "curl",
  "rsyslog",
];

describe("parseBaseUrl", () => {
  it("derives host, scheme, port and tls for https", () => {
    const p = parseBaseUrl("https://checkstack.example.com");
    expect(p.host).toBe("checkstack.example.com");
    expect(p.scheme).toBe("https");
    expect(p.port).toBe("443");
    expect(p.tls).toBe(true);
    expect(p.origin).toBe("https://checkstack.example.com");
  });

  it("keeps an explicit port and tolerates a trailing slash", () => {
    const p = parseBaseUrl("http://localhost:5173/");
    expect(p.host).toBe("localhost");
    expect(p.scheme).toBe("http");
    expect(p.port).toBe("5173");
    expect(p.tls).toBe(false);
    expect(p.origin).toBe("http://localhost:5173");
  });
});

describe("buildShipSnippets", () => {
  it("emits every shipper tab exactly once", () => {
    const snippets = buildShipSnippets({ baseUrl: "https://logs.example.com" });
    expect(snippets.map((s) => s.id).sort()).toEqual([...ALL_IDS].sort());
  });

  it("interpolates the absolute OTLP + native endpoints into the right tabs", () => {
    const base = "https://logs.example.com";
    const snippets = buildShipSnippets({ baseUrl: base });
    const byId = new Map(snippets.map((s) => [s.id, s]));

    const otlpUrl = `${base}${LOGSTREAM_ENDPOINTS.otlpLogs}`;
    const nativeUrl = `${base}${LOGSTREAM_ENDPOINTS.native}`;

    expect(byId.get("otel-collector")!.code).toContain(otlpUrl);
    expect(byId.get("vector")!.code).toContain(nativeUrl);
    expect(byId.get("curl")!.code).toContain(nativeUrl);
    // Fluent Bit splits host/port + uri path.
    expect(byId.get("fluent-bit")!.code).toContain(LOGSTREAM_ENDPOINTS.otlpLogs);
    expect(byId.get("fluent-bit")!.code).toContain("logs.example.com");
  });

  it("uses the token placeholder when no token is supplied", () => {
    const snippets = buildShipSnippets({ baseUrl: "https://logs.example.com" });
    for (const s of snippets) {
      expect(s.code).toContain(TOKEN_PLACEHOLDER);
    }
  });

  it("interpolates a real token into every tab when provided", () => {
    const token = "ckls_abc_deadbeefdeadbeefdeadbeefdeadbeef";
    const snippets = buildShipSnippets({
      baseUrl: "https://logs.example.com",
      token,
    });
    for (const s of snippets) {
      expect(s.code).toContain(token);
      expect(s.code).not.toContain(TOKEN_PLACEHOLDER);
    }
  });

  it("carries the token in the syslog structured-data element", () => {
    const token = "ckls_xyz_00000000000000000000000000000000";
    const snippets = buildShipSnippets({
      baseUrl: "https://logs.example.com",
      token,
    });
    const rsyslog = snippets.find((s) => s.id === "rsyslog")!;
    expect(rsyslog.code).toContain(`[${SYSLOG_SD_ID} token=`);
    expect(rsyslog.code).toContain(token);
  });

  it("reflects tls off for a plain-http base", () => {
    const snippets = buildShipSnippets({ baseUrl: "http://localhost:5173" });
    const fluentBit = snippets.find((s) => s.id === "fluent-bit")!;
    expect(fluentBit.code).toContain("Tls              Off");
    expect(fluentBit.code).toContain("Port             5173");
  });
});
