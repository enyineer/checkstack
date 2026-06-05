import {
  AUDIT_SEVERITY_RANK,
  type AuditAdvisory,
  type AuditSeverity,
} from "@checkstack/script-packages-common";
import { meetsThreshold } from "./audit-parse";

/**
 * Pure delta logic for the vulnerability audit: given the previously-stored
 * advisory set and the freshly-parsed one, decide which advisories warrant a
 * NEW notification to `script-packages.manage` holders.
 *
 * Notify rules (locked product decision: threshold = `moderate`):
 * - A NEWLY-APPEARED advisory (not in the previous set) at or above the
 *   threshold notifies.
 * - An advisory whose severity ESCALATED across the threshold (was below,
 *   now at/above) notifies. (A within-threshold escalation, e.g.
 *   high -> critical, also notifies because operators want to know it got
 *   worse; a de-escalation never notifies.)
 * - An UNCHANGED advisory never re-notifies. This is the spam guard: a daily
 *   run over a stable set produces zero notifications.
 *
 * The function is the suppression mechanism — the notification transport
 * (`sendTransactional`) has no de-dup of its own, so "don't emit when
 * nothing changed" lives here against the durably-stored previous set.
 */

/** Identity of one advisory: `<package> <advisoryId>`. */
export function advisoryKey(advisory: {
  packageName: string;
  advisoryId: string;
}): string {
  return `${advisory.packageName} ${advisory.advisoryId}`;
}

export interface AuditDeltaInput {
  /** Advisories stored from the previous run (any severity). */
  previous: AuditAdvisory[];
  /** Advisories parsed from the current run (any severity). */
  current: AuditAdvisory[];
  /** Notify on this severity and above. */
  threshold: AuditSeverity;
}

export interface AuditDeltaResult {
  /**
   * Advisories to notify about this run: newly-appeared or severity-escalated
   * across/within the threshold. Sorted by severity (most severe first) then
   * package name for stable rendering.
   */
  toNotify: AuditAdvisory[];
  /** Advisory keys that newly appeared (regardless of severity). */
  newlyAppeared: string[];
  /** Advisory keys whose severity increased since the previous run. */
  escalated: string[];
}

export function computeAuditDelta({
  previous,
  current,
  threshold,
}: AuditDeltaInput): AuditDeltaResult {
  const prevBySeverity = new Map<string, AuditSeverity>();
  for (const a of previous) prevBySeverity.set(advisoryKey(a), a.severity);

  const toNotify: AuditAdvisory[] = [];
  const newlyAppeared: string[] = [];
  const escalated: string[] = [];

  for (const adv of current) {
    const key = advisoryKey(adv);
    const prevSeverity = prevBySeverity.get(key);
    const meetsNow = meetsThreshold(adv.severity, threshold);

    if (prevSeverity === undefined) {
      newlyAppeared.push(key);
      // A brand-new advisory notifies only if it meets the threshold.
      if (meetsNow) toNotify.push(adv);
      continue;
    }

    const increased =
      AUDIT_SEVERITY_RANK[adv.severity] > AUDIT_SEVERITY_RANK[prevSeverity];
    if (increased) {
      escalated.push(key);
      // An escalation notifies when the (now-higher) severity meets the
      // threshold. (If it escalated but is still below threshold, stay quiet.)
      if (meetsNow) toNotify.push(adv);
    }
    // Unchanged or de-escalated: never re-notify.
  }

  toNotify.sort((a, b) => {
    const rank = AUDIT_SEVERITY_RANK[b.severity] - AUDIT_SEVERITY_RANK[a.severity];
    if (rank !== 0) return rank;
    return a.packageName.localeCompare(b.packageName);
  });

  return { toNotify, newlyAppeared, escalated };
}
