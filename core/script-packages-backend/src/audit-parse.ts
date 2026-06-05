import { z } from "zod";
import {
  AUDIT_SEVERITY_RANK,
  type AuditAdvisory,
  type AuditSeverity,
} from "@checkstack/script-packages-common";

/**
 * Parse `bun audit --json` stdout into a normalised, deterministically-sorted
 * advisory list.
 *
 * `bun audit --json` writes an object keyed by package name, each value an
 * array of advisories:
 * ```json
 * { "lodash": [ { "id": 123, "url": "...", "title": "...",
 *   "severity": "high", "vulnerable_versions": "<4.17.21",
 *   "cvss": { "score": 7.2, "vectorString": "..." } } ] }
 * ```
 * A clean tree emits `{}` (or `[]` when there are no dependencies). The exit
 * code is unreliable (Bun exits non-zero even on a clean tree in some
 * versions), so callers MUST rely on this parse, never the exit status.
 *
 * Unknown severities are coerced to `low` rather than dropped, so a future
 * registry value never silently hides a finding.
 */

const KNOWN_SEVERITIES = new Set<AuditSeverity>([
  "low",
  "moderate",
  "high",
  "critical",
]);

function normaliseSeverity(value: unknown): AuditSeverity {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    // npm/GitHub sometimes use "medium" as a synonym for "moderate".
    if (lower === "medium") return "moderate";
    if (KNOWN_SEVERITIES.has(lower as AuditSeverity)) {
      return lower as AuditSeverity;
    }
  }
  return "low";
}

/** Raw advisory entry as Bun emits it. Lenient: tolerate missing fields. */
const RawAdvisorySchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  url: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  severity: z.string().optional().nullable(),
  vulnerable_versions: z.string().optional().nullable(),
  cvss: z
    .object({ score: z.number().optional().nullable() })
    .optional()
    .nullable(),
});

/**
 * The whole document: `{ [packageName]: RawAdvisory[] }`. An empty-deps tree
 * yields `[]`, which we treat as "no advisories".
 */
const AuditDocumentSchema = z.union([
  z.record(z.string(), z.array(RawAdvisorySchema)),
  z.array(z.unknown()),
]);

export interface ParseAuditResult {
  advisories: AuditAdvisory[];
}

/**
 * Compare advisories deterministically so equal sets serialise identically:
 * package name, then advisory id.
 */
function compareAdvisories(a: AuditAdvisory, b: AuditAdvisory): number {
  if (a.packageName !== b.packageName) {
    return a.packageName.localeCompare(b.packageName);
  }
  return a.advisoryId.localeCompare(b.advisoryId);
}

export function parseBunAudit(stdout: string): ParseAuditResult {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { advisories: [] };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("bun audit produced output that is not valid JSON.");
  }

  const doc = AuditDocumentSchema.parse(json);
  if (Array.isArray(doc)) return { advisories: [] };

  const advisories: AuditAdvisory[] = [];
  const seen = new Set<string>();
  for (const [packageName, rawList] of Object.entries(doc)) {
    for (const raw of rawList) {
      const advisoryId =
        raw.id === undefined || raw.id === null ? "" : String(raw.id);
      if (advisoryId.length === 0) continue;
      // Dedup on (package, advisory) so a registry returning the same
      // advisory twice can't double-count.
      const dedupKey = `${packageName} ${advisoryId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      advisories.push({
        packageName,
        advisoryId,
        title: raw.title ?? "",
        severity: normaliseSeverity(raw.severity),
        vulnerableVersions: raw.vulnerable_versions ?? "",
        url: raw.url ?? null,
        cvssScore:
          raw.cvss && typeof raw.cvss.score === "number"
            ? raw.cvss.score
            : null,
      });
    }
  }

  advisories.sort(compareAdvisories);
  return { advisories };
}

/** Count advisories by severity (all four buckets always present). */
export function countBySeverity(advisories: AuditAdvisory[]): {
  low: number;
  moderate: number;
  high: number;
  critical: number;
} {
  const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
  for (const a of advisories) counts[a.severity] += 1;
  return counts;
}

/** True when `severity` is at or above `threshold`. */
export function meetsThreshold(
  severity: AuditSeverity,
  threshold: AuditSeverity,
): boolean {
  return AUDIT_SEVERITY_RANK[severity] >= AUDIT_SEVERITY_RANK[threshold];
}
