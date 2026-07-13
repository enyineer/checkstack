/**
 * Request-body reading with hard size caps and gzip support, re-exported from
 * `@checkstack/ingest-utils`. Enforces a compressed-body cap and, for gzip
 * bodies, a decompressed cap so a zip bomb is refused before it can exhaust
 * memory. See the shared module for details.
 */

export {
  readCappedBody,
  BodyTooLargeError,
  MAX_COMPRESSED_BYTES,
  MAX_INFLATED_BYTES,
} from "@checkstack/ingest-utils";
