import { describe, it, expect } from "bun:test";
import { ProtoReader, ProtoWriter } from "./wire";
import {
  readAnyValue,
  readKeyValue,
  readResource,
  encodeExportServiceResponse,
  bytesToHex,
  MAX_OTLP_VALUE_DEPTH,
} from "./otlp";

/** Encode a scalar AnyValue and read it back. */
function roundTripAnyValue(build: (w: ProtoWriter) => void): unknown {
  const bytes = new ProtoWriter().message(99, build).finish();
  // Peel the outer field-99 wrapper to get the AnyValue bytes.
  const reader = new ProtoReader(bytes);
  reader.readTag();
  return readAnyValue(new ProtoReader(reader.readBytes()));
}

describe("readAnyValue", () => {
  it("decodes each scalar field", () => {
    expect(roundTripAnyValue((v) => v.string(1, "hi"))).toBe("hi");
    expect(roundTripAnyValue((v) => v.uint(2, 1))).toBe(true);
    expect(roundTripAnyValue((v) => v.uint(2, 0))).toBe(false);
    expect(roundTripAnyValue((v) => v.uint(3, 42))).toBe(42);
    expect(roundTripAnyValue((v) => v.bytes(7, Uint8Array.from([0xde, 0xad])))).toBe(
      "dead",
    );
  });

  it("decodes a nested kvlist AnyValue", () => {
    const inner = new ProtoWriter().string(1, "leaf").finish(); // string_value
    const keyValue = new ProtoWriter().string(1, "k").bytes(2, inner).finish();
    const keyValueList = new ProtoWriter().bytes(1, keyValue).finish();
    const anyValue = new ProtoWriter().bytes(6, keyValueList).finish(); // kvlist_value
    expect(readAnyValue(new ProtoReader(anyValue))).toEqual({ k: "leaf" });
  });
});

describe("AnyValue depth guard", () => {
  /** A kvlist AnyValue nested `depth` levels deep over a scalar leaf. */
  function nested(depth: number): Uint8Array {
    if (depth === 0) return new ProtoWriter().string(1, "leaf").finish();
    const inner = nested(depth - 1);
    const keyValue = new ProtoWriter().string(1, "k").bytes(2, inner).finish();
    const keyValueList = new ProtoWriter().bytes(1, keyValue).finish();
    return new ProtoWriter().bytes(6, keyValueList).finish();
  }

  it("decodes exactly at the depth limit", () => {
    expect(() => readAnyValue(new ProtoReader(nested(MAX_OTLP_VALUE_DEPTH)))).not.toThrow();
  });

  it("rejects nesting past the depth limit (stack-overflow DoS guard)", () => {
    expect(() =>
      readAnyValue(new ProtoReader(nested(MAX_OTLP_VALUE_DEPTH + 1))),
    ).toThrow(/nesting exceeds/);
  });
});

describe("readKeyValue", () => {
  it("decodes a key/value pair", () => {
    const value = new ProtoWriter().string(1, "v").finish();
    const kv = new ProtoWriter().string(1, "name").bytes(2, value).finish();
    expect(readKeyValue(new ProtoReader(kv))).toEqual(["name", "v"]);
  });
});

describe("readResource", () => {
  it("folds repeated KeyValue attributes into a flat record", () => {
    function attr(key: string, str: string): Uint8Array {
      const value = new ProtoWriter().string(1, str).finish();
      return new ProtoWriter().string(1, key).bytes(2, value).finish();
    }
    const resource = new ProtoWriter()
      .bytes(1, attr("service.name", "api"))
      .bytes(1, attr("host.name", "node-1"))
      .finish();
    expect(readResource(new ProtoReader(resource))).toEqual({
      "service.name": "api",
      "host.name": "node-1",
    });
  });
});

describe("encodeExportServiceResponse", () => {
  it("encodes an empty message when there are no rejected items", () => {
    expect([...encodeExportServiceResponse()]).toEqual([]);
    expect([...encodeExportServiceResponse({ rejectedItems: 0, errorMessage: "x" })]).toEqual(
      [],
    );
  });

  it("encodes partial_success { rejected, error_message } when items were rejected", () => {
    const bytes = encodeExportServiceResponse({ rejectedItems: 3, errorMessage: "nope" });
    // field 1 (partial_success), then inner field 1 = 3, inner field 2 = "nope".
    const reader = new ProtoReader(bytes);
    const { fieldNumber } = reader.readTag();
    expect(fieldNumber).toBe(1);
    const inner = new ProtoReader(reader.readBytes());
    let rejected = 0;
    let message = "";
    while (inner.hasMore) {
      const tag = inner.readTag();
      if (tag.fieldNumber === 1) rejected = inner.readVarintNumber();
      else if (tag.fieldNumber === 2) message = inner.readString();
      else inner.skip(tag.wireType);
    }
    expect(rejected).toBe(3);
    expect(message).toBe("nope");
  });
});

describe("bytesToHex", () => {
  it("lowercase hex encodes with zero padding", () => {
    expect(bytesToHex(Uint8Array.from([0x00, 0x0f, 0xff]))).toBe("000fff");
  });
});
