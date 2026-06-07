import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthUser } from "@checkstack/backend-api";
import {
  catalogAccess,
  pluginMetadata as catalogPluginMetadata,
} from "@checkstack/catalog-common";
import type { SystemSignal, SystemSignalsMap } from "@checkstack/catalog-common";
import type { SystemSignalsContributor } from "../extension-points";
import type { RegisteredAiTool } from "../tool-registry";

/** Input for `system.issues`: optionally narrow the answer to specific systems. */
export const SystemIssuesInputSchema = z.object({
  /**
   * When provided, only signals for these system ids are returned. Omit to get
   * issues across ALL systems the principal can see.
   */
  systemIds: z.array(z.string()).optional(),
});
export type SystemIssuesInput = z.infer<typeof SystemIssuesInputSchema>;

/** One signal as surfaced to the model (the source it came from is carried inline). */
export const SystemIssueSignalSchema = z.object({
  source: z.string(),
  tone: z.enum(["error", "warn", "info"]),
  label: z.string(),
  detail: z.string().optional(),
  since: z.string().optional(),
});

/** All current issues for one system. */
export const SystemIssuesGroupSchema = z.object({
  systemId: z.string(),
  signals: z.array(SystemIssueSignalSchema),
});

/** The model-facing result: issues grouped by system. */
export const SystemIssuesOutputSchema = z.object({
  /** One entry per system that currently has at least one issue. */
  systems: z.array(SystemIssuesGroupSchema),
  /** Total number of systems with issues (== `systems.length`). */
  totalSystems: z.number(),
  /** Total number of individual signals across all systems. */
  totalSignals: z.number(),
});
export type SystemIssuesOutput = z.infer<typeof SystemIssuesOutputSchema>;

/**
 * Merge several contributors' {@link SystemSignalsMap}s into one map keyed by
 * systemId, concatenating the signal arrays for systems that appear in more than
 * one source. Pure and order-stable (sources are concatenated in input order),
 * so it is unit-testable without standing up an environment.
 */
export function mergeSystemSignalsMaps(
  maps: SystemSignalsMap[],
): SystemSignalsMap {
  const merged: SystemSignalsMap = {};
  for (const map of maps) {
    for (const [systemId, signals] of Object.entries(map)) {
      if (signals.length === 0) continue;
      const existing = merged[systemId];
      if (existing) {
        existing.push(...signals);
      } else {
        merged[systemId] = [...signals];
      }
    }
  }
  return merged;
}

/**
 * Shape a merged {@link SystemSignalsMap} into the model-friendly grouped
 * result, optionally narrowed to `systemIds`. Drops the link/icon fields the
 * model does not need (`href`, `accessRule`, `iconName`) and keeps
 * source/tone/label/detail/since.
 */
export function toSystemIssuesOutput({
  merged,
  systemIds,
}: {
  merged: SystemSignalsMap;
  systemIds?: string[];
}): SystemIssuesOutput {
  const allow = systemIds ? new Set(systemIds) : undefined;
  const systems = Object.entries(merged)
    .filter(([systemId]) => !allow || allow.has(systemId))
    .map(([systemId, signals]) => ({
      systemId,
      signals: signals.map((s: SystemSignal) => ({
        source: s.source,
        tone: s.tone,
        label: s.label,
        detail: s.detail,
        since: s.since,
      })),
    }));
  return {
    systems,
    totalSystems: systems.length,
    totalSignals: systems.reduce((sum, s) => sum + s.signals.length, 0),
  };
}

/**
 * Read every contributor's signals for `principal`, tolerating a contributor
 * that throws or returns `{}` (it is skipped, never breaking the whole call),
 * and return the merged map. Contributors enforce their OWN per-source access,
 * so a source the principal cannot see returns `{}` itself.
 */
export async function collectSystemSignals({
  contributors,
  principal,
}: {
  contributors: SystemSignalsContributor[];
  principal: AuthUser;
}): Promise<SystemSignalsMap> {
  const settled = await Promise.allSettled(
    contributors.map((c) => c.read({ principal })),
  );
  const maps: SystemSignalsMap[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      maps.push(result.value);
    }
  }
  return mergeSystemSignalsMaps(maps);
}

/**
 * `system.issues` - the single "what are the current issues" tool. It fans out
 * across every backend `SystemSignalsContributor` (failing health checks,
 * breaching/at-risk SLOs, active anomalies, open incidents, active
 * maintenances, dependency problems) and returns them aggregated across systems
 * in ONE call. `effect: "read"` (auto-runs).
 *
 * The `contributors` array is the live array from
 * `createSystemSignalsExtensionPoint`, read at execute time so contributors
 * registered during plugin init are always seen.
 */
export function createSystemIssuesTool({
  contributors,
}: {
  contributors: SystemSignalsContributor[];
}): RegisteredAiTool<SystemIssuesInput, SystemIssuesOutput> {
  return {
    name: "system.issues",
    description:
      "Return ALL current system issues - failing health checks, breaching or at-risk SLOs, active anomalies, open incidents, active maintenances, and dependency problems - aggregated across every system in ONE call. Use this FIRST whenever asked whether there are any issues, what is wrong, what is down, or for an overall health overview, before reaching for any per-domain tool. Read-only. Optionally pass systemIds to narrow the answer to specific systems.",
    effect: "read",
    input: SystemIssuesInputSchema,
    output: SystemIssuesOutputSchema,
    // The TOOL is gated by catalog.system.read; PER-SOURCE access is enforced
    // inside each contributor (a source the principal cannot see returns {}).
    requiredAccessRules: [
      qualifyAccessRuleId(catalogPluginMetadata, catalogAccess.system.read),
    ],
    async execute({
      input,
      principal,
    }: {
      input: SystemIssuesInput;
      principal: AuthUser;
    }) {
      const merged = await collectSystemSignals({ contributors, principal });
      return toSystemIssuesOutput({ merged, systemIds: input.systemIds });
    },
  };
}
