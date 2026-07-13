/**
 * Signal-agnostic OTLP structures shared by every OTLP export decoder: the
 * `AnyValue` / `KeyValue` / `Resource` readers, the recursion depth guard, and
 * the `Export*ServiceResponse` encoding (an empty message, or a
 * `partial_success { rejected_<items>, error_message }` field-1 sub-message).
 *
 * Signal-specific message decoding (logs `LogRecord`, metrics `Metric`, ...)
 * lives in each plugin and composes these readers over the {@link ProtoReader}.
 * These structures follow the stable OpenTelemetry proto definitions
 * (`opentelemetry/proto/common/v1/common.proto`,
 * `opentelemetry/proto/resource/v1/resource.proto`). Unknown fields are skipped.
 *
 * Pure module: no IO.
 */

import { ProtoReader, ProtoWriter } from "./wire";

/**
 * Max nesting depth for an OTLP `AnyValue` (array_value / kvlist_value can
 * recurse into further AnyValues). A hostile producer can nest these arbitrarily
 * deep to force unbounded recursion - a stack-overflow DoS and cheap CPU burn.
 * Well past any legitimate attribute shape; deeper decodes are rejected with a
 * decode error the endpoint maps to 400.
 */
export const MAX_OTLP_VALUE_DEPTH = 32;

/** Decode an OTLP `AnyValue` to a JS value (string/number/boolean/object/null). */
export function readAnyValue(reader: ProtoReader, depth = 0): unknown {
  if (depth > MAX_OTLP_VALUE_DEPTH) {
    throw new Error(
      `OTLP AnyValue nesting exceeds ${MAX_OTLP_VALUE_DEPTH} levels`,
    );
  }
  let value: unknown = null;
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: { // string_value
        value = reader.readString();
        break;
      }
      case 2: { // bool_value
        value = reader.readVarintNumber() !== 0;
        break;
      }
      case 3: { // int_value (int64)
        value = Number(reader.readVarint());
        break;
      }
      case 4: { // double_value
        value = reader.readDouble();
        break;
      }
      case 5: { // array_value (ArrayValue)
        value = readArrayValue(new ProtoReader(reader.readBytes()), depth + 1);
        break;
      }
      case 6: { // kvlist_value (KeyValueList)
        value = readKeyValueList(new ProtoReader(reader.readBytes()), depth + 1);
        break;
      }
      case 7: { // bytes_value
        value = bytesToHex(reader.readBytes());
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return value;
}

function readArrayValue(reader: ProtoReader, depth: number): unknown[] {
  const out: unknown[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      out.push(readAnyValue(new ProtoReader(reader.readBytes()), depth));
    } else {
      reader.skip(wireType);
    }
  }
  return out;
}

function readKeyValueList(
  reader: ProtoReader,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      const [key, value] = readKeyValue(new ProtoReader(reader.readBytes()), depth);
      out[key] = value;
    } else {
      reader.skip(wireType);
    }
  }
  return out;
}

/** Decode an OTLP `KeyValue` (field 1 = key, field 2 = AnyValue) to a pair. */
export function readKeyValue(reader: ProtoReader, depth = 0): [string, unknown] {
  let key = "";
  let value: unknown = null;
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: {
        key = reader.readString();
        break;
      }
      case 2: {
        value = readAnyValue(new ProtoReader(reader.readBytes()), depth);
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return [key, value];
}

/** Decode a single `KeyValue` message into a one-entry record. */
export function readAttribute(reader: ProtoReader): Record<string, unknown> {
  const [key, value] = readKeyValue(reader);
  return { [key]: value };
}

/**
 * Decode an OTLP `Resource` (field 1 = repeated `KeyValue` attributes) into a
 * flat attributes record. Other fields (dropped_attributes_count) are skipped.
 */
export function readResource(reader: ProtoReader): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      Object.assign(attributes, readAttribute(new ProtoReader(reader.readBytes())));
    } else {
      reader.skip(wireType);
    }
  }
  return attributes;
}

/**
 * Encode an OTLP `Export*ServiceResponse`. With no rejected items the message is
 * empty (`{}`); otherwise it carries `partial_success` (field 1) holding
 * `rejected_<items>` (field 1, int64) and `error_message` (field 2, string).
 * The field numbers are identical across signals - only the JSON key name for
 * the rejected count differs, which the caller supplies for the JSON form.
 */
export function encodeExportServiceResponse(partial?: {
  rejectedItems: number;
  errorMessage: string;
}): Uint8Array {
  const writer = new ProtoWriter();
  if (partial && partial.rejectedItems > 0) {
    writer.message(1, (ps) => {
      ps.uint(1, partial.rejectedItems);
      if (partial.errorMessage) {
        ps.string(2, partial.errorMessage);
      }
    });
  }
  return writer.finish();
}

/** Lowercase hex encoding of a byte slice (trace/span ids, bytes AnyValues). */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
