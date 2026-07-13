/**
 * `ExportMetricsServiceResponse` encoding (protobuf + JSON). With no rejected
 * datapoints the message is empty (`{}`); otherwise it carries
 * `partial_success { rejected_data_points, error_message }` (field 1). Delegates
 * to the shared signal-agnostic encoder - the wire shape is identical across
 * OTLP signals, only the JSON key name for the rejected count differs.
 */

import { encodeExportServiceResponse } from "@checkstack/ingest-utils";

export interface MetricsPartialSuccess {
  rejectedDataPoints: number;
  errorMessage: string;
}

export function encodeExportMetricsServiceResponse(
  partialSuccess?: MetricsPartialSuccess,
): Uint8Array {
  return encodeExportServiceResponse(
    partialSuccess && partialSuccess.rejectedDataPoints > 0
      ? {
          rejectedItems: partialSuccess.rejectedDataPoints,
          errorMessage: partialSuccess.errorMessage,
        }
      : undefined,
  );
}

export function exportMetricsServiceResponseJson(
  partialSuccess?: MetricsPartialSuccess,
): Record<string, unknown> {
  if (partialSuccess && partialSuccess.rejectedDataPoints > 0) {
    return {
      partialSuccess: {
        rejectedDataPoints: partialSuccess.rejectedDataPoints,
        errorMessage: partialSuccess.errorMessage,
      },
    };
  }
  return {};
}
