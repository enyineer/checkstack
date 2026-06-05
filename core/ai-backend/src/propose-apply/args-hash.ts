import { createHash } from "node:crypto";

/**
 * Deterministically serialize a value to canonical JSON: object keys are sorted
 * recursively so two semantically-equal argument objects hash identically
 * regardless of key order. Arrays preserve order (order is significant).
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * SHA-256 of the canonical-JSON form of the tool arguments. The audit row
 * stores ONLY this hash, never the raw args, because args may carry PII or
 * secrets (§10). Identical args always hash identically; key order is
 * irrelevant.
 */
export function hashToolArgs(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex");
}
