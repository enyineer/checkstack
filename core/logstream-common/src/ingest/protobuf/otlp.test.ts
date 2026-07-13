import { describe, it, expect } from "bun:test";
import { ProtoWriter } from "@checkstack/otlp-wire";
import {
  decodeExportLogsServiceRequest,
  MAX_OTLP_VALUE_DEPTH,
} from "./otlp";

/**
 * Build a nested OTLP `AnyValue` `depth` levels deep. Level 0 is a scalar
 * `string_value`; each further level wraps it in a `kvlist_value` (field 6),
 * exactly the recursion the decoder walks (AnyValue -> KeyValueList -> KeyValue
 * -> AnyValue). Built with the raw wire writer since the friendly encoder only
 * emits scalar AnyValues.
 */
function nestedAnyValue(depth: number): Uint8Array {
  if (depth === 0) {
    return new ProtoWriter().string(1, "leaf").finish(); // string_value
  }
  const inner = nestedAnyValue(depth - 1);
  const keyValue = new ProtoWriter().string(1, "k").bytes(2, inner).finish();
  const keyValueList = new ProtoWriter().bytes(1, keyValue).finish();
  return new ProtoWriter().bytes(6, keyValueList).finish(); // kvlist_value
}

/** Wrap a body `AnyValue` in a full `ExportLogsServiceRequest`. */
function requestWithBodyDepth(depth: number): Uint8Array {
  const body = nestedAnyValue(depth);
  const logRecord = new ProtoWriter().bytes(5, body).finish(); // LogRecord.body
  const scopeLogs = new ProtoWriter().bytes(2, logRecord).finish(); // ScopeLogs.log_records
  const resourceLogs = new ProtoWriter().bytes(2, scopeLogs).finish(); // ResourceLogs.scope_logs
  return new ProtoWriter().bytes(1, resourceLogs).finish(); // request.resource_logs
}

describe("decodeExportLogsServiceRequest AnyValue depth guard", () => {
  it("decodes a shallowly-nested kvlist body", () => {
    const payload = decodeExportLogsServiceRequest(requestWithBodyDepth(1));
    expect(payload).toHaveLength(1);
    expect(payload[0]!.records[0]!.body).toEqual({ k: "leaf" });
  });

  it("decodes a body nested exactly at the depth limit", () => {
    expect(() =>
      decodeExportLogsServiceRequest(requestWithBodyDepth(MAX_OTLP_VALUE_DEPTH)),
    ).not.toThrow();
  });

  it("rejects a body nested past the depth limit (stack-overflow DoS guard)", () => {
    expect(() =>
      decodeExportLogsServiceRequest(requestWithBodyDepth(MAX_OTLP_VALUE_DEPTH + 1)),
    ).toThrow(/nesting exceeds/);
  });
});
