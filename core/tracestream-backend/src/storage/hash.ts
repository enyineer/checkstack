/**
 * Deterministic hash of a trace id to a unit interval `[0, 1)`, used by the
 * tail-sampling DECISION job for baseline sampling. Because the mapping is a
 * PURE function of the trace id, the baseline verdict is identical on every pod
 * and across retries - a re-run of the decision job reaches the SAME keep/drop
 * conclusion, so the job is idempotent without persisting a random draw.
 *
 * FNV-1a (32-bit) over the id's UTF-8 bytes: cheap, dependency-free, and well
 * enough distributed for a sampling gate (validated by the distribution test).
 */

const FNV_OFFSET_BASIS = 0x81_1C_9D_C5;
const FNV_PRIME = 0x01_00_01_93;

/** FNV-1a 32-bit hash of a string, returned as an unsigned 32-bit integer. */
export function fnv1a32(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < value.length; i++) {
    const code = value.codePointAt(i) ?? 0;
    hash ^= code & 0xFF;
    // A code point can exceed a byte for non-ASCII; fold the high byte in too so
    // multi-byte units still contribute (trace ids are hex, but keep it total
    // for any input).
    const high = code >> 8;
    if (high) hash ^= high;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Map a trace id to `[0, 1)`. `traceId < baselineSampleRate` is the keep gate.
 * Deterministic and stable: the same id always yields the same value.
 */
export function hashToUnitInterval(traceId: string): number {
  return fnv1a32(traceId) / 0x1_00_00_00_00;
}
