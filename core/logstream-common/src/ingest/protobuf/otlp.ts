/**
 * OTLP LOGS field mapping over the shared protobuf primitives and the
 * signal-agnostic OTLP structure readers from `@checkstack/ingest-utils`.
 * Decodes an `ExportLogsServiceRequest` (the body OTLP/HTTP shippers POST) into
 * a protocol-neutral {@link OtlpLogsPayload}, and encodes an
 * `ExportLogsServiceResponse` (with optional `partialSuccess`).
 *
 * Field numbers follow the stable OpenTelemetry proto definitions
 * (`opentelemetry/proto/logs/v1/logs.proto`,
 * `opentelemetry/proto/collector/logs/v1/logs_service.proto`). The `AnyValue` /
 * `KeyValue` / `Resource` readers and the depth guard are shared; only the
 * logs-specific `LogRecord` / `ScopeLogs` / `ResourceLogs` decoding lives here.
 * Unknown fields are skipped, so a newer producer decodes fine.
 *
 * Pure module: no IO.
 */

import {
  ProtoReader,
  readAnyValue,
  readAttribute,
  readResource,
  bytesToHex,
  encodeExportServiceResponse,
} from "@checkstack/otlp-wire";

/** Re-exported for the logs decoder's tests; owned by `@checkstack/otlp-wire`. */
export { MAX_OTLP_VALUE_DEPTH } from "@checkstack/otlp-wire";

/** A single decoded OTLP log record, protocol-neutral. */
export interface OtlpLogRecord {
  /** Event time in nanoseconds since the Unix epoch (0/absent -> use observed). */
  timeUnixNano: bigint;
  observedTimeUnixNano: bigint;
  severityNumber: number;
  severityText?: string;
  /** Resolved `body` AnyValue (string / number / boolean / object / null). */
  body: unknown;
  attributes: Record<string, unknown>;
  /** Lowercase hex trace id, or undefined. */
  traceId?: string;
  spanId?: string;
}

/** One `ResourceLogs`: a resource's attributes plus its flattened records. */
export interface OtlpResourceLogs {
  resource: Record<string, unknown>;
  records: OtlpLogRecord[];
}

/** The decoded `ExportLogsServiceRequest`. */
export type OtlpLogsPayload = OtlpResourceLogs[];

// -----------------------------------------------------------------------------
// LogRecord / ScopeLogs / ResourceLogs / request
// -----------------------------------------------------------------------------

function readLogRecord(reader: ProtoReader): OtlpLogRecord {
  const record: OtlpLogRecord = {
    timeUnixNano: 0n,
    observedTimeUnixNano: 0n,
    severityNumber: 0,
    body: null,
    attributes: {},
  };
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: { // time_unix_nano (fixed64)
        record.timeUnixNano = reader.readFixed64();
        break;
      }
      case 11: { // observed_time_unix_nano (fixed64)
        record.observedTimeUnixNano = reader.readFixed64();
        break;
      }
      case 2: { // severity_number (enum -> varint)
        record.severityNumber = reader.readVarintNumber();
        break;
      }
      case 3: { // severity_text (string)
        record.severityText = reader.readString();
        break;
      }
      case 5: { // body (AnyValue)
        record.body = readAnyValue(new ProtoReader(reader.readBytes()));
        break;
      }
      case 6: {
        // attributes (repeated KeyValue)
        Object.assign(
          record.attributes,
          readAttribute(new ProtoReader(reader.readBytes())),
        );
        break;
      }
      case 9: { // trace_id (bytes)
        record.traceId = bytesToHex(reader.readBytes());
        break;
      }
      case 10: { // span_id (bytes)
        record.spanId = bytesToHex(reader.readBytes());
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return record;
}

function readScopeLogs(reader: ProtoReader): OtlpLogRecord[] {
  const records: OtlpLogRecord[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 2) {
      records.push(readLogRecord(new ProtoReader(reader.readBytes())));
    } else {
      reader.skip(wireType);
    }
  }
  return records;
}

function readResourceLogs(reader: ProtoReader): OtlpResourceLogs {
  let resource: Record<string, unknown> = {};
  const records: OtlpLogRecord[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: { // resource (Resource)
        resource = readResource(new ProtoReader(reader.readBytes()));
        break;
      }
      case 2: { // scope_logs (repeated ScopeLogs)
        records.push(...readScopeLogs(new ProtoReader(reader.readBytes())));
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return { resource, records };
}

/** Decode an `ExportLogsServiceRequest` from protobuf bytes. */
export function decodeExportLogsServiceRequest(
  buf: Uint8Array,
): OtlpLogsPayload {
  const reader = new ProtoReader(buf);
  const out: OtlpLogsPayload = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      out.push(readResourceLogs(new ProtoReader(reader.readBytes())));
    } else {
      reader.skip(wireType);
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// ExportLogsServiceResponse
// -----------------------------------------------------------------------------

/** The partial-success detail returned when some records were rejected. */
export interface PartialSuccess {
  rejectedLogRecords: number;
  errorMessage: string;
}

/**
 * Encode an `ExportLogsServiceResponse`. With no partial success the message is
 * empty (`{}`); otherwise it carries `partial_success { rejected_log_records,
 * error_message }` (field 1). Delegates to the shared signal-agnostic encoder
 * (the wire shape is identical across OTLP signals).
 */
export function encodeExportLogsServiceResponse(
  partialSuccess?: PartialSuccess,
): Uint8Array {
  return encodeExportServiceResponse(
    partialSuccess && partialSuccess.rejectedLogRecords > 0
      ? {
          rejectedItems: partialSuccess.rejectedLogRecords,
          errorMessage: partialSuccess.errorMessage,
        }
      : undefined,
  );
}

/** The JSON body for an `ExportLogsServiceResponse` (OTLP/JSON responses). */
export function exportLogsServiceResponseJson(
  partialSuccess?: PartialSuccess,
): Record<string, unknown> {
  if (partialSuccess && partialSuccess.rejectedLogRecords > 0) {
    return {
      partialSuccess: {
        rejectedLogRecords: partialSuccess.rejectedLogRecords,
        errorMessage: partialSuccess.errorMessage,
      },
    };
  }
  return {};
}
