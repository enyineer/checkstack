import { describe, expect, it } from "bun:test";
import type {
  AuditAdvisory,
  AuditState,
} from "@checkstack/script-packages-common";
import { createAuditRunner, type AuditRunnerDeps } from "./audit-runner";
import { advisoryKey } from "./audit-delta";

function adv(
  packageName: string,
  advisoryId: string,
  severity: AuditAdvisory["severity"],
): AuditAdvisory {
  return {
    packageName,
    advisoryId,
    severity,
    title: `${packageName} ${advisoryId}`,
    vulnerableVersions: "<1",
    url: null,
    cvssScore: null,
  };
}

/** In-memory audit store + notify capture for a given hash. */
function makeHarness(opts: {
  lockfileHash: string | null;
  scanResult: AuditAdvisory[];
  managers?: string[];
  initialStored?: AuditAdvisory[];
  initialNotifiedKeys?: Set<string>;
}) {
  const stored = new Map<string, AuditAdvisory>(); // key -> advisory
  const notifiedFlags = new Set<string>();
  for (const a of opts.initialStored ?? []) stored.set(advisoryKey(a), a);
  for (const k of opts.initialNotifiedKeys ?? []) notifiedFlags.add(k);

  let lastState: AuditState | null = null;
  const notifies: { userId: string; body: string }[] = [];
  let locked = false;
  const completed: { lockfileHash: string | null; total: number }[] = [];
  const pruneCalls: string[][] = [];

  const deps: AuditRunnerDeps = {
    installerLock: {
      async tryInstallerLock() {
        if (locked) return null;
        locked = true;
        return { release: async () => { locked = false; } };
      },
    },
    auditStore: {
      async advisoriesForHash() {
        return [...stored.values()];
      },
      async notifiedSeverities() {
        const m = new Map<string, AuditAdvisory["severity"]>();
        for (const k of notifiedFlags) {
          const a = stored.get(k);
          if (a) m.set(k, a.severity);
        }
        return m;
      },
      async replaceForHash({ advisories, notifiedKeys }) {
        stored.clear();
        notifiedFlags.clear();
        for (const a of advisories) {
          stored.set(advisoryKey(a), a);
          if (notifiedKeys.has(advisoryKey(a))) notifiedFlags.add(advisoryKey(a));
        }
      },
      async markNotified({ keys }) {
        for (const k of keys) notifiedFlags.add(advisoryKey(k));
      },
      async pruneHashesNotIn(keepHashes: string[]) {
        // Harness keys are not hash-scoped, so we record the call to assert
        // the runner prunes superseded hashes (keeping only the current one).
        pruneCalls.push(keepHashes);
      },
      async getState() {
        return lastState!;
      },
      async recordRun({ lockfileHash, total, counts }) {
        lastState = {
          lastRunAt: new Date(),
          lockfileHash,
          total,
          counts,
          errorMessage: null,
        };
      },
      async recordError(message) {
        lastState = {
          lastRunAt: new Date(),
          lockfileHash: null,
          total: 0,
          counts: { low: 0, moderate: 0, high: 0, critical: 0 },
          errorMessage: message,
        };
      },
    },
    async loadCurrent() {
      return {
        lockfileHash: opts.lockfileHash,
        packages: [{ name: "lodash", version: "4.0.0", enabled: true }],
        ignoreScripts: true,
      };
    },
    async scan() {
      return { advisories: opts.scanResult };
    },
    async getUserIds() {
      return (opts.managers ?? []).length > 0 ? ["u1", "u2"] : [];
    },
    async filterManagers() {
      return opts.managers ?? [];
    },
    async notifyUser({ userId, body }) {
      notifies.push({ userId, body });
    },
    async emitCompleted(input) {
      completed.push(input);
    },
  };

  return {
    deps,
    notifies,
    completed,
    stored,
    notifiedFlags,
    pruneCalls,
    getState: () => lastState,
  };
}

describe("createAuditRunner", () => {
  it("records all severities and notifies managers on new at/above-threshold advisories", async () => {
    const h = makeHarness({
      lockfileHash: "hash-1",
      scanResult: [adv("lodash", "1", "high"), adv("a", "2", "low")],
      managers: ["u1", "u2"],
    });
    const run = createAuditRunner(h.deps);
    const summary = await run();

    expect(summary).toMatchObject({ ran: true, lockfileHash: "hash-1", total: 2, notified: 1 });
    // Prunes advisory rows for any superseded hash, keeping only the current one.
    expect(h.pruneCalls).toEqual([["hash-1"]]);
    // Recorded all (low counted too).
    expect(h.getState()?.counts).toEqual({ low: 1, moderate: 0, high: 1, critical: 0 });
    // Notified both managers, once each.
    expect(h.notifies.map((n) => n.userId).sort()).toEqual(["u1", "u2"]);
    // Completion signal emitted.
    expect(h.completed).toEqual([{ lockfileHash: "hash-1", total: 2 }]);
  });

  it("does NOT re-notify an unchanged set on the second run (spam guard)", async () => {
    const h = makeHarness({
      lockfileHash: "hash-1",
      scanResult: [adv("lodash", "1", "high")],
      managers: ["u1"],
    });
    const run = createAuditRunner(h.deps);
    await run();
    expect(h.notifies).toHaveLength(1);
    // Second run, identical scan result.
    await run();
    expect(h.notifies).toHaveLength(1); // no new notification
  });

  it("re-notifies on escalation of a previously-notified advisory", async () => {
    const h = makeHarness({
      lockfileHash: "hash-1",
      scanResult: [adv("lodash", "1", "moderate")],
      managers: ["u1"],
    });
    const run = createAuditRunner(h.deps);
    await run();
    expect(h.notifies).toHaveLength(1);

    // Re-point the scan at an escalated severity for the same advisory.
    h.deps.scan = async () => ({ advisories: [adv("lodash", "1", "critical")] });
    await run();
    expect(h.notifies).toHaveLength(2);
  });

  it("refuses cleanly when the installer lock is held", async () => {
    const h = makeHarness({
      lockfileHash: "hash-1",
      scanResult: [adv("lodash", "1", "high")],
      managers: ["u1"],
    });
    // Hold the lock first.
    await h.deps.installerLock.tryInstallerLock();
    const run = createAuditRunner(h.deps);
    const summary = await run();
    expect(summary.ran).toBe(false);
    expect(summary.reason).toContain("installer lock");
    expect(h.notifies).toHaveLength(0);
  });

  it("records an empty result when nothing is installed", async () => {
    const h = makeHarness({
      lockfileHash: null,
      scanResult: [],
      managers: ["u1"],
    });
    const run = createAuditRunner(h.deps);
    const summary = await run();
    expect(summary).toMatchObject({ ran: true, lockfileHash: null, total: 0, notified: 0 });
    expect(h.notifies).toHaveLength(0);
  });

  it("records an error and does not throw when the scan fails", async () => {
    const h = makeHarness({
      lockfileHash: "hash-1",
      scanResult: [],
      managers: ["u1"],
    });
    h.deps.scan = async () => {
      throw new Error("bun audit boom");
    };
    const run = createAuditRunner(h.deps);
    const summary = await run();
    expect(summary.ran).toBe(false);
    expect(summary.reason).toContain("boom");
    expect(h.getState()?.errorMessage).toContain("boom");
  });
});
