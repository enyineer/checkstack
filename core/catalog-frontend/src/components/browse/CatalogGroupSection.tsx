import React from "react";
import {
  Card,
  CardContent,
  Badge,
  cn,
  usePerformance,
} from "@checkstack/ui";
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
import type { GroupHealthRollup } from "./healthRollup.logic";
import type { Density } from "./browseState.logic";
import { CatalogSystemRow } from "./CatalogSystemRow";

export interface CatalogGroupSectionProps {
  section: GroupSection;
  density: Density;
  onToggle: (id: string, open: boolean) => void;
}

/**
 * Group health rollup pill, derived from the status DATA (`section.rollup`), not
 * from rendered badges. Renders nothing when no health source reported data
 * (`hasData` false) so the header falls back to the count-only `Badge`. Always
 * pairs colour with an icon AND a text label so it never relies on colour alone
 * (a11y, plan §7).
 */
const HealthRollupBadge: React.FC<{ rollup: GroupHealthRollup }> = ({
  rollup,
}) => {
  if (!rollup.hasData) return null;

  if (rollup.allHealthy) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        All healthy
      </Badge>
    );
  }

  if (rollup.unhealthy > 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        {rollup.unhealthy} unhealthy
        {rollup.degraded > 0 ? `, ${rollup.degraded} degraded` : ""}
      </Badge>
    );
  }

  if (rollup.degraded > 0) {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {rollup.degraded} degraded
      </Badge>
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

  // The synthetic "Ungrouped" bucket is not a real group, so it has no group
  // resource to subscribe to.
  const canSubscribe = !section.isUngrouped && !!session;

  return (
    <Card>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => onToggle(section.id, !section.open)}
          aria-expanded={section.open}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-tl-lg"
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
          <Badge variant="secondary">
            {section.totalCount}{" "}
            {section.totalCount === 1 ? "system" : "systems"}
          </Badge>
        </button>
        {canSubscribe && (
          <div className="shrink-0 pr-2 pl-1">
            <NotificationSubscriptionsManager
              target={catalogGroupTarget}
              resource={{ groupId: section.id, groupName: section.name }}
            />
          </div>
        )}
      </div>

      {section.open && (
        <CardContent
          className={cn("pt-0", density === "compact" ? "space-y-0.5" : "space-y-1")}
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
              />
            ))
          )}
        </CardContent>
      )}
    </Card>
  );
};
