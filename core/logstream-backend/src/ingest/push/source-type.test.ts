import { describe, it, expect } from "bun:test";
import { TOKEN_PREFIX } from "@checkstack/logstream-common";
import {
  pushSourceType,
  PushSourceConfigSchema,
  LOGSTREAM_PUSH_SOURCE_TYPE_ID,
  PUSH_SOURCE_TYPE_LOCAL_ID,
} from "./source-type";

/**
 * Contract tests for the `logstream.push` source type. The qualified id and the
 * token prefix are load-bearing across the platform migration (telemetry 0002
 * promoted tokens under the SAME literal id, and shippers keep the `ckls_`
 * prefix), so pin them here.
 */
describe("pushSourceType", () => {
  it("declares the push seam with the ckls_ prefix and both endpoints", () => {
    expect(pushSourceType.id).toBe(PUSH_SOURCE_TYPE_LOCAL_ID);
    expect(pushSourceType.id).toBe("push");
    expect(pushSourceType.signals).toEqual(["logs"]);
    expect(pushSourceType.push).toBeDefined();
    expect(pushSourceType.push!.tokenPrefix).toBe(TOKEN_PREFIX);
    expect(pushSourceType.push!.tokenPrefix).toBe("ckls_");
    expect(pushSourceType.push!.endpoints).toEqual([
      { kind: "otlp", path: "/api/logstream/v1/logs", label: "OTLP logs" },
      { kind: "native", path: "/api/logstream/ingest", label: "Native JSON" },
    ]);
    // Not a pull/webhook/listener/derive source.
    expect(pushSourceType.pull).toBeUndefined();
    expect(pushSourceType.listener).toBeUndefined();
    expect(pushSourceType.derive).toBeUndefined();
  });

  it("qualifies to the literal telemetry migration 0002 promoted rows under", () => {
    // `logstream` (pluginId) + `.` + `push` (local id).
    expect(LOGSTREAM_PUSH_SOURCE_TYPE_ID).toBe("logstream.push");
  });

  it("has an empty config schema (the token + binding are everything)", () => {
    const parsed = PushSourceConfigSchema.parse({});
    expect(parsed).toEqual({});
  });
});
