import { TDigest } from "tdigest";

/**
 * Shared t-digest helpers for approximate percentile aggregation (p95 latency,
 * span-duration percentiles, ...). A t-digest is a small, MERGEABLE sketch: two
 * digests over disjoint samples combine into one whose percentiles approximate
 * the percentiles of the union, so per-bucket sketches can be folded up a
 * rollup hierarchy without keeping raw samples.
 *
 * These live in `backend-api` (not any one plugin) because both the healthcheck
 * hourly aggregates and the tracestream op-bucket p95 need them; the `tdigest`
 * npm dependency is owned here so consumers get it transitively.
 *
 * Storage format: a flat number array of `[mean1, n1, mean2, n2, ...]` centroid
 * pairs (compact, JSON-serializable). An empty digest serializes to `[]`.
 */

/** Serialized t-digest: flat `[mean1, n1, mean2, n2, ...]` centroid pairs. */
export type TDigestState = number[];

/** A fresh, empty t-digest. */
export function createTDigest(): TDigest {
  return new TDigest();
}

/** Serialize a t-digest to the flat centroid-pair storage format. */
export function serializeTDigest(digest: TDigest): TDigestState {
  const centroids = digest.toArray();
  const result: TDigestState = [];
  for (const c of centroids) {
    result.push(c.mean, c.n);
  }
  return result;
}

/** Reconstruct a t-digest from the flat centroid-pair storage format. */
export function deserializeTDigest(state: TDigestState): TDigest {
  const digest = new TDigest();
  if (state.length === 0) return digest;

  // Reconstruct centroids from pairs of [mean, n].
  const centroids: Array<{ mean: number; n: number }> = [];
  for (let i = 0; i < state.length; i += 2) {
    const mean = state[i];
    const n = state[i + 1];
    if (mean !== undefined && n !== undefined && n > 0) {
      centroids.push({ mean, n });
    }
  }
  if (centroids.length > 0) digest.push_centroid(centroids);
  return digest;
}

/**
 * Fold raw sample `values` into an existing serialized digest (or a fresh one
 * when `state` is null/empty), returning the new serialized digest. Read-then-
 * write: the caller persists the returned state.
 */
export function pushValuesIntoState({
  state,
  values,
}: {
  state: TDigestState | null | undefined;
  values: number[];
}): TDigestState {
  const digest = state && state.length > 0 ? deserializeTDigest(state) : new TDigest();
  for (const v of values) digest.push(v);
  return serializeTDigest(digest);
}

/** Build a serialized digest from raw sample values. `null` for no samples. */
export function tdigestStateFromValues(values: number[]): TDigestState | null {
  if (values.length === 0) return null;
  const digest = new TDigest();
  for (const v of values) digest.push(v);
  return serializeTDigest(digest);
}

/**
 * Merge several serialized digests into one. Null/empty inputs are skipped;
 * returns `null` when every input is empty (so an all-empty merge stays null
 * rather than an empty sketch). This is the mergeable-sketch operation that
 * lets per-bucket digests roll up (minute -> hour) or combine across rows
 * (many `(service, op)` digests -> one bucket p95).
 */
export function mergeTDigestStates(
  states: Array<TDigestState | null | undefined>,
): TDigestState | null {
  const merged = new TDigest();
  let any = false;
  for (const state of states) {
    if (!state || state.length === 0) continue;
    const centroids: Array<{ mean: number; n: number }> = [];
    for (let i = 0; i < state.length; i += 2) {
      const mean = state[i];
      const n = state[i + 1];
      if (mean !== undefined && n !== undefined && n > 0) {
        centroids.push({ mean, n });
      }
    }
    if (centroids.length > 0) {
      merged.push_centroid(centroids);
      any = true;
    }
  }
  return any ? serializeTDigest(merged) : null;
}

/**
 * Read a percentile `q` (0..1, e.g. 0.95 for p95) from a serialized digest.
 * Returns `null` when the digest is absent/empty or the estimate is not finite.
 */
export function percentileFromState({
  state,
  q,
}: {
  state: TDigestState | null | undefined;
  q: number;
}): number | null {
  if (!state || state.length === 0) return null;
  const value = deserializeTDigest(state).percentile(q);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
