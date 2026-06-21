import { z } from "zod";
import {
  PublicStatusSchema,
  BannerDtoSchema,
  SystemHealthDtoSchema,
  GroupStatusDtoSchema,
  UptimeDtoSchema,
  BUILTIN_WIDGET_IDS,
  type PublicStatus,
} from "./widget-types";
import type { ResolvedBlock } from "./schemas";

/**
 * The page-wide rollup shown in the public header banner. Reuses the same
 * vocabulary as the per-widget {@link PublicStatusSchema} so the banner and the
 * widgets below it speak one language.
 */
export const OverallStatusSchema = PublicStatusSchema;
export type OverallStatus = PublicStatus;

/**
 * The summary the resolver attaches to the published page: the rolled-up status
 * plus a human label suitable for the banner heading. `status` is the machine
 * value (drives color/icon); `label` is the default copy a renderer may show.
 */
export const OverallStatusSummarySchema = z.object({
  status: OverallStatusSchema,
  label: z.string(),
});
export type OverallStatusSummary = z.infer<typeof OverallStatusSummarySchema>;

/** Default human label per status (matches the per-widget pill copy). */
const OVERALL_STATUS_LABEL: Record<OverallStatus, string> = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
  maintenance: "Under maintenance",
  unknown: "Status unknown",
};

/** Default banner label for a derived overall status. */
export function overallStatusLabel(status: OverallStatus): string {
  return OVERALL_STATUS_LABEL[status];
}

/**
 * Worst-status-wins precedence. Higher number = more severe and therefore wins
 * the rollup. `unknown` sits at the very bottom (rank 0) so any real signal
 * outranks it; it only survives when NO widget contributed a status at all.
 *
 * `maintenance` ranks above `operational` (it is a real, surfaced state) but
 * below any degradation/outage: an active outage during a maintenance window is
 * still an outage to a visitor, so the more alarming state wins.
 */
const STATUS_RANK: Record<OverallStatus, number> = {
  unknown: 0,
  operational: 1,
  maintenance: 2,
  degraded: 3,
  partial_outage: 4,
  major_outage: 5,
};

/**
 * Extract every status signal a single resolved block contributes. Operates on
 * the resolver's already-allow-listed DTO `data` only (never reaches into any
 * domain plugin); unknown/foreign/un-parseable blocks contribute nothing.
 */
function statusesFromBlock(block: ResolvedBlock): OverallStatus[] {
  switch (block.type) {
    case BUILTIN_WIDGET_IDS.banner: {
      const parsed = BannerDtoSchema.safeParse(block.data);
      return parsed.success ? [parsed.data.status] : [];
    }
    case BUILTIN_WIDGET_IDS.systemHealth: {
      const parsed = SystemHealthDtoSchema.safeParse(block.data);
      return parsed.success ? parsed.data.systems.map((s) => s.status) : [];
    }
    case BUILTIN_WIDGET_IDS.groupStatus: {
      const parsed = GroupStatusDtoSchema.safeParse(block.data);
      if (!parsed.success) return [];
      // The group's own rolled-up status plus each member (member statuses are
      // already reflected in the group status, but including them is harmless
      // under worst-wins and is robust to a group with an empty members list).
      return [parsed.data.status, ...parsed.data.systems.map((s) => s.status)];
    }
    case BUILTIN_WIDGET_IDS.uptime: {
      const parsed = UptimeDtoSchema.safeParse(block.data);
      if (!parsed.success || parsed.data.bars.length === 0) return [];
      // Use only the most recent bar: the rollup reflects CURRENT health, not a
      // historical bad day. Bars are oldest-first, so the last one is "today".
      const latest = parsed.data.bars.at(-1);
      return latest ? [latest.status] : [];
    }
    default: {
      return [];
    }
  }
}

/**
 * Derive the page-wide overall status from the ALREADY-RESOLVED blocks of a
 * published page, worst-status-wins. PURE: it reads only the public DTO `data`
 * the resolver emitted, so it carries no domain dependency and is fully unit
 * testable.
 *
 * Returns `operational` when every status signal is operational, `maintenance`
 * when the worst signal is a maintenance window, the worst degradation/outage
 * otherwise, and `unknown` only when no widget contributed any status at all
 * (an empty page, or a page of purely content widgets).
 */
export function deriveOverallStatus({
  blocks,
}: {
  blocks: ResolvedBlock[];
}): OverallStatusSummary {
  let worst: OverallStatus | null = null;
  for (const block of blocks) {
    for (const status of statusesFromBlock(block)) {
      if (worst === null || STATUS_RANK[status] > STATUS_RANK[worst]) {
        worst = status;
      }
    }
  }
  const status = worst ?? "unknown";
  return { status, label: overallStatusLabel(status) };
}
