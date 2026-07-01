import React from "react";
import { cn, usePerformance } from "@checkstack/ui";
import {
  ChevronDown,
  FolderTree,
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { useApi } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { NotificationSubscriptionsManager } from "@checkstack/notification-frontend";
import { catalogGroupTarget } from "@checkstack/catalog-common";
import type { GroupSection } from "./filterEntities.logic";
import {
  resolveSectionTone,
  type GroupHealthRollup,
  type SectionTone,
} from "./healthRollup.logic";
import type { Density } from "./browseState.logic";
import { CatalogSystemRow } from "./CatalogSystemRow";

/**
 * Left-accent-stripe class per section tone. Spelled out as full literal strings
 * (not interpolated) so Tailwind's JIT keeps them, driven by the colorblind-safe
 * status triad. `unknown` stays neutral so color only appears on a real signal.
 */
const accentByTone: Record<SectionTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  down: "bg-status-down",
  unknown: "bg-border",
};

export interface CatalogGroupSectionProps {
  section: GroupSection;
  density: Density;
  onToggle: (id: string, open: boolean) => void;
}

/**
 * Shared pill shell for the health rollup: a tinted, rounded chip pairing the
 * colorblind-safe status triad with an icon AND a text label, so the signal
 * never relies on colour alone (a11y, plan §7).
 */
const HealthRollupPill: React.FC<{
  className: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}> = ({ className, icon: Icon, children }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
      className,
    )}
  >
    <Icon className="h-3 w-3" aria-hidden={true} />
    {children}
  </span>
);

/**
 * Group health rollup pill, derived from the status DATA (`section.rollup`), not
 * from rendered badges. Renders nothing when no health source reported data
 * (`hasData` false) so the header falls back to the count-only `Badge`. Always
 * pairs the status triad with an icon AND a text label so it never relies on
 * colour alone (a11y, plan §7).
 */
const HealthRollupBadge: React.FC<{ rollup: GroupHealthRollup }> = ({
  rollup,
}) => {
  if (!rollup.hasData) return null;

  if (rollup.allHealthy) {
    return (
      <HealthRollupPill
        className="bg-status-ok/10 text-status-ok"
        icon={CheckCircle2}
      >
        All healthy
      </HealthRollupPill>
    );
  }

  if (rollup.unhealthy > 0) {
    return (
      <HealthRollupPill
        className="bg-status-down/10 text-status-down"
        icon={XCircle}
      >
        {rollup.unhealthy} unhealthy
        {rollup.degraded > 0 ? `, ${rollup.degraded} degraded` : ""}
      </HealthRollupPill>
    );
  }

  if (rollup.degraded > 0) {
    return (
      <HealthRollupPill
        className="bg-status-warn/10 text-status-warn"
        icon={AlertTriangle}
      >
        {rollup.degraded} degraded
      </HealthRollupPill>
    );
  }

  // Has some data but no degraded/unhealthy and not all-healthy (mixed
  // healthy + unknown) — no rollup pill, count-only header is the honest signal.
  return null;
};

/**
 * One collapsible group (or the synthetic "Ungrouped") section. The header is
 * a real `<button>` with `aria-expanded` so keyboard + screen reader users can
 * toggle it. We intentionally do NOT set `aria-controls`: the body is unmounted
 * when collapsed (`{section.open && <CardContent…>}`), so a referenced id would
 * dangle; `aria-expanded` alone is the correct contract for a custom disclosure
 * whose controlled region is removed from the DOM. The header shows a member
 * count and, when a `CatalogBrowseHealthSlot` filler reported data, a health
 * rollup `Badge` derived from that DATA (not from rendered per-system badges).
 *
 * Collapsed sections render only their header — not their member rows — so the
 * mounted-node count stays bounded even with hundreds of systems (plan §3.4).
 */
export const CatalogGroupSection: React.FC<CatalogGroupSectionProps> = ({
  section,
  density,
  onToggle,
}) => {
  const { isLowPower } = usePerformance();
  const authApi = useApi(authApiRef);
  const { data: session } = authApi.useSession();
  const Icon = section.isUngrouped ? Layers : FolderTree;
  const tone = resolveSectionTone(section.rollup);

  // Read the session once per section (not once per row). Signed-in users get
  // a per-system bell on every row; the group-level bell additionally
  // requires a real group (the synthetic "Ungrouped" bucket has no group
  // resource to subscribe to).
  const hasSession = !!session;
  const canSubscribeGroup = !section.isUngrouped && hasSession;

  return (
    <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
      {/* Status accent stripe: multi-encodes group health by position + hue,
          not color alone (the inline pill carries the icon + label). */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accentByTone[tone])}
        aria-hidden="true"
      />

      <div className="flex items-center pl-1">
        <button
          type="button"
          onClick={() => onToggle(section.id, !section.open)}
          aria-expanded={section.open}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground",
              !isLowPower && "transition-transform",
              section.open ? "rotate-0" : "-rotate-90",
            )}
            aria-hidden="true"
          />
          <Icon
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
            {section.name}
          </span>
          <HealthRollupBadge rollup={section.rollup} />
          {/* Number-led hero: the member count is the group's headline figure. */}
          <span className="flex shrink-0 flex-col items-end leading-none">
            <span className="text-2xl font-bold leading-none tabular-nums text-foreground">
              {section.totalCount}
            </span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {section.totalCount === 1 ? "system" : "systems"}
            </span>
          </span>
        </button>
        {canSubscribeGroup && (
          <div className="shrink-0 pr-2 pl-1">
            <NotificationSubscriptionsManager
              target={catalogGroupTarget}
              resource={{ groupId: section.id, groupName: section.name }}
              triggerClassName="h-8 w-8"
            />
          </div>
        )}
      </div>

      {section.open && (
        <div
          className={cn(
            "px-4 pb-4 pl-5",
            density === "compact" ? "space-y-0.5" : "space-y-1",
          )}
        >
          {section.systems.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No systems match the current filters.
            </p>
          ) : (
            section.systems.map((system) => (
              <CatalogSystemRow
                key={system.id}
                system={system}
                density={density}
                canSubscribe={hasSession}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
