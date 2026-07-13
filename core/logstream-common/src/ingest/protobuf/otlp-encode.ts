/**
 * Encoder for an OTLP `ExportLogsServiceRequest`, the mirror of
 * {@link decodeExportLogsServiceRequest}. Only the tests use it (to build a
 * genuine protobuf fixture and round-trip it through the decoder), but it lives
 * in shipped code so the encode/decode field mapping stays in one place and
 * cannot drift.
 *
 * Pure module: no IO.
 */

import { ProtoWriter } from "@checkstack/otlp-wire";

/** A scalar OTLP AnyValue the encoder knows how to write. */
export type AnyValueInput =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: number }
  | { doubleValue: number };

export interface EncodeLogRecordInput {
  timeUnixNano?: bigint;
  observedTimeUnixNano?: bigint;
  severityNumber?: number;
  severityText?: string;
  body?: AnyValueInput;
  attributes?: Record<string, AnyValueInput>;
  /** Lowercase hex trace id. */
  traceId?: string;
  spanId?: string;
}

export interface EncodeResourceLogsInput {
  resource?: Record<string, AnyValueInput>;
  records: EncodeLogRecordInput[];
}

function writeAnyValue(writer: ProtoWriter, value: AnyValueInput): void {
  if ("stringValue" in value) writer.string(1, value.stringValue);
  else if ("boolValue" in value) writer.uint(2, value.boolValue ? 1 : 0);
  else if ("intValue" in value) writer.uint(3, value.intValue);
  else writeDouble(writer, value.doubleValue);
}

/** Write a `double_value` (AnyValue field 4) as a little-endian fixed64. */
function writeDouble(writer: ProtoWriter, value: number): void {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  const bytes = new Uint8Array(buf);
  let bits = 0n;
  for (let i = 7; i >= 0; i -= 1) bits = (bits << 8n) | BigInt(bytes[i]!);
  writer.fixed64(4, bits);
}

function writeKeyValue(
  writer: ProtoWriter,
  key: string,
  value: AnyValueInput,
): void {
  writer.string(1, key);
  writer.message(2, (v) => writeAnyValue(v, value));
}

function writeLogRecord(writer: ProtoWriter, rec: EncodeLogRecordInput): void {
  if (rec.timeUnixNano !== undefined) writer.fixed64(1, rec.timeUnixNano);
  if (rec.observedTimeUnixNano !== undefined) {
    writer.fixed64(11, rec.observedTimeUnixNano);
  }
  if (rec.severityNumber !== undefined) writer.uint(2, rec.severityNumber);
  if (rec.severityText !== undefined) writer.string(3, rec.severityText);
  if (rec.body !== undefined) {
    writer.message(5, (b) => writeAnyValue(b, rec.body!));
  }
  for (const [key, value] of Object.entries(rec.attributes ?? {})) {
    writer.message(6, (kv) => writeKeyValue(kv, key, value));
  }
  if (rec.traceId !== undefined) writer.bytes(9, hexToBytes(rec.traceId));
  if (rec.spanId !== undefined) writer.bytes(10, hexToBytes(rec.spanId));
}

/** Encode an `ExportLogsServiceRequest` from friendly resource-logs input. */
export function encodeExportLogsServiceRequest(
  resourceLogs: EncodeResourceLogsInput[],
): Uint8Array {
  const writer = new ProtoWriter();
  for (const rl of resourceLogs) {
    writer.message(1, (rlw) => {
      if (rl.resource) {
        rlw.message(1, (res) => {
          for (const [key, value] of Object.entries(rl.resource!)) {
            res.message(1, (kv) => writeKeyValue(kv, key, value));
          }
        });
      }
      rlw.message(2, (scope) => {
        for (const rec of rl.records) {
          scope.message(2, (r) => writeLogRecord(r, rec));
        }
      });
    });
  }
  return writer.finish();
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
