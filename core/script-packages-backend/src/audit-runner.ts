import {
  AUDIT_NOTIFY_THRESHOLD,
  scriptPackagesRoutes,
  type AuditAdvisory,
  type AuditRunSummary,
} from "@checkstack/script-packages-common";
import { extractErrorMessage, resolveRoute } from "@checkstack/common";
import type { InstallerLock } from "./install-state-store";
import type { AuditStore } from "./stores";
import { countBySeverity } from "./audit-parse";
import { advisoryKey, computeAuditDelta } from "./audit-delta";

/**
 * Build an `auditNow()` callable that wires the pure audit pieces (scanner,
 * delta logic, store) to the real stores + notification path, shared by the
 * admin `auditNow` RPC and the scheduled recurring job (so the safety + delta
 * logic lives in exactly one place). Mirrors {@link createBlobGcTrigger}.
 *
 * Election + mutual exclusion: takes the installer-election advisory lock for
 * the whole pass, so a concurrent install / migration / blob-GC (which
 * contend for the same lock) cannot run while the audit does, and vice versa.
 * If the lock is held, the audit refuses cleanly and retries on the next tick.
 *
 * Notify suppression: only NEWLY-APPEARED or severity-ESCALATED advisories at
 * or above the threshold notify; the durable per-advisory `notified` flag in
 * the store carries across runs so a stable set never re-notifies (even
 * across a redeploy). RECORD all severities regardless of the notify gate.
 */

export interface AuditRunnerDeps {
  installerLock: InstallerLock;
  auditStore: AuditStore;
  /** Current desired install state (the tree to audit). */
  loadCurrent(): Promise<{
    lockfileHash: string | null;
    packages: { name: string; version: string; enabled: boolean }[];
    ignoreScripts: boolean;
  }>;
  /** Run the actual `bun audit` scan against the resolved tree. */
  scan(input: {
    packages: { name: string; version: string; enabled: boolean }[];
    ignoreScripts: boolean;
  }): Promise<{ advisories: AuditAdvisory[] }>;
  /** Enumerate candidate user ids (auth.getUsers ids). */
  getUserIds(): Promise<string[]>;
  /** Narrow to holders of `script-packages.manage`. */
  filterManagers(userIds: string[]): Promise<string[]>;
  /** Deliver one transactional notification to one user. */
  notifyUser(input: {
    userId: string;
    title: string;
    body: string;
    importance: "info" | "warning" | "critical";
    action?: { label: string; url: string };
  }): Promise<void>;
  /** Broadcast the audit-completed signal so settings pages refresh. */
  emitCompleted(input: {
    lockfileHash: string | null;
    total: number;
  }): Promise<void>;
  logger?: { debug(msg: string): void; error(msg: string): void };
}

/** Importance for a notification batch, driven by its most-severe advisory. */
function importanceFor(
  advisories: AuditAdvisory[],
): "info" | "warning" | "critical" {
  if (advisories.some((a) => a.severity === "critical")) return "critical";
  if (advisories.some((a) => a.severity === "high")) return "warning";
  return "info";
}

function buildBody(advisories: AuditAdvisory[]): string {
  const lines = advisories.map((a) => {
    const link = a.url ? `[${a.title || a.advisoryId}](${a.url})` : a.title || a.advisoryId;
    return `- **${a.packageName}** (${a.severity}): ${link}`;
  });
  return [
    `${advisories.length} new vulnerability advisor${advisories.length === 1 ? "y" : "ies"} found in the installed script packages:`,
    "",
    ...lines,
  ].join("\n");
}

export function createAuditRunner(
  deps: AuditRunnerDeps,
): () => Promise<AuditRunSummary> {
  return async function auditNow(): Promise<AuditRunSummary> {
    const lock = await deps.installerLock.tryInstallerLock();
    if (!lock) {
      const reason =
        "An install, storage migration, or blob GC holds the installer lock; skipping audit.";
      deps.logger?.debug(reason);
      return { ran: false, reason, lockfileHash: null, total: 0, notified: 0 };
    }

    try {
      const current = await deps.loadCurrent();
      const lockfileHash = current.lockfileHash;

      // Nothing installed → record an empty, error-free result.
      if (!lockfileHash) {
        await deps.auditStore.recordRun({
          lockfileHash: null,
          total: 0,
          counts: { low: 0, moderate: 0, high: 0, critical: 0 },
        });
        await deps.emitCompleted({ lockfileHash: null, total: 0 });
        return { ran: true, lockfileHash: null, total: 0, notified: 0 };
      }

      const previous = await deps.auditStore.advisoriesForHash(lockfileHash);
      const alreadyNotified =
        await deps.auditStore.notifiedSeverities(lockfileHash);

      const { advisories } = await deps.scan({
        packages: current.packages,
        ignoreScripts: current.ignoreScripts,
      });

      const delta = computeAuditDelta({
        previous,
        current: advisories,
        threshold: AUDIT_NOTIFY_THRESHOLD,
      });

      // Drop advisories we've already notified at (at least) their current
      // severity, so a redeploy with the same set never re-spams.
      const toNotify = delta.toNotify.filter((a) => {
        const prev = alreadyNotified.get(advisoryKey(a));
        // Re-notify only if not yet notified, or it escalated beyond what we
        // last told them about (handled by the delta's escalation check).
        return prev === undefined || prev !== a.severity;
      });

      // Persist findings first (so the read path is correct even if notify
      // fails). Carry `notified` forward for advisories that stay unchanged.
      const notifiedKeys = new Set(alreadyNotified.keys());
      await deps.auditStore.replaceForHash({
        lockfileHash,
        advisories,
        notifiedKeys,
      });

      // Drop advisory rows for superseded lockfile hashes so they don't
      // accumulate forever as the installed tree changes. Only the current
      // hash is queryable (getAuditState reads the current hash), so anything
      // else is dead data. Best-effort: a prune failure must not fail the run.
      await deps.auditStore
        .pruneHashesNotIn([lockfileHash])
        .catch((error) => {
          deps.logger?.error(
            `Audit: pruning superseded advisory hashes failed: ${extractErrorMessage(error)}`,
          );
        });

      const counts = countBySeverity(advisories);
      await deps.auditStore.recordRun({
        lockfileHash,
        total: advisories.length,
        counts,
      });

      // Notify holders about the new/escalated advisories (best-effort).
      if (toNotify.length > 0) {
        try {
          const userIds = await deps.getUserIds();
          const managers =
            userIds.length > 0 ? await deps.filterManagers(userIds) : [];
          if (managers.length > 0) {
            const body = buildBody(toNotify);
            const importance = importanceFor(toNotify);
            for (const userId of managers) {
              await deps
                .notifyUser({
                  userId,
                  title: `Script packages: ${toNotify.length} new vulnerability advisor${toNotify.length === 1 ? "y" : "ies"}`,
                  body,
                  importance,
                  action: {
                    label: "Review advisories",
                    url: resolveRoute(scriptPackagesRoutes.routes.settings),
                  },
                })
                .catch((error) => {
                  deps.logger?.error(
                    `Audit notify to ${userId} failed: ${extractErrorMessage(error)}`,
                  );
                });
            }
          }
          // Mark the notified advisories so the next pass doesn't re-notify.
          await deps.auditStore.markNotified({
            lockfileHash,
            keys: toNotify.map((a) => ({
              packageName: a.packageName,
              advisoryId: a.advisoryId,
            })),
          });
        } catch (error) {
          deps.logger?.error(
            `Audit notification step failed: ${extractErrorMessage(error)}`,
          );
        }
      }

      await deps.emitCompleted({ lockfileHash, total: advisories.length });

      return {
        ran: true,
        lockfileHash,
        total: advisories.length,
        notified: toNotify.length,
      };
    } catch (error) {
      const message = extractErrorMessage(error);
      deps.logger?.error(`Audit pass failed: ${message}`);
      await deps.auditStore.recordError(message).catch(() => {});
      return { ran: false, reason: message, lockfileHash: null, total: 0, notified: 0 };
    } finally {
      await lock.release();
    }
  };
}
