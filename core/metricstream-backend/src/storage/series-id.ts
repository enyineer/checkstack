import { createHash } from "node:crypto";

/**
 * Canonical string form of a series' label set: keys sorted ascending, rendered
 * Prometheus-style `{k1="v1",k2="v2"}`. Deterministic across pods, so the same
 * `(name, labels)` always hashes to the same series id regardless of insertion
 * order. An empty label set canonicalizes to `{}`.
 */
export function canonicalLabelString(labels: Record<string, string>): string {
  const keys = Object.keys(labels).toSorted();
  const parts = keys.map((key) => `${key}=${JSON.stringify(labels[key] ?? "")}`);
  return `{${parts.join(",")}}`;
}

/**
 * Derive a series id from its stream, metric name and labels. Single-space
 * separators, matching the frozen contract:
 * `seriesId = sha256(streamId + " " + name + " " + canonicalLabelString)`.
 * Ingestion is stateless (no per-series memory), so this must be pure.
 */
export function computeSeriesId({
  streamId,
  name,
  labels,
}: {
  streamId: string;
  name: string;
  labels: Record<string, string>;
}): string {
  const canonical = canonicalLabelString(labels);
  return createHash("sha256")
    .update(`${streamId} ${name} ${canonical}`, "utf8")
    .digest("hex");
}
