import React from "react";
import { Link } from "react-router";
import { ExtensionSlot } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  catalogRoutes,
  catalogSystemTarget,
  SystemStateBadgesSlot,
  type System,
} from "@checkstack/catalog-common";
import { NotificationSubscriptionsManager } from "@checkstack/notification-frontend";
import { cn } from "@checkstack/ui";
import { ChevronRight } from "lucide-react";
import type { Density } from "./browseState.logic";

export interface CatalogSystemRowProps {
  system: System;
  density: Density;
  /**
   * Whether to show the per-system notification bell. Gated on session
   * presence by the parent section (one session read per section rather
   * than one per row).
   */
  canSubscribe: boolean;
}

/**
 * One browse row for a single system: name (links to the system detail page),
 * the `SystemStateBadgesSlot` (health/maintenance/incident badges contributed
 * by other plugins — exactly the decoupled mechanism `SystemDetailPage` uses),
 * a density-aware description, and — for signed-in users — the notification
 * bell so a system can be subscribed to right from the catalog. Compact
 * density drops the inline description to a `title` tooltip and tightens
 * spacing.
 *
 * The bell (a button that opens a dialog) sits OUTSIDE the row's `<Link>` as a
 * sibling: nesting interactive controls inside an anchor is invalid and would
 * let bell clicks navigate to the detail page. The visual row shell (border,
 * hover, background) lives on the flex container so the bell shares the row's
 * hover affordance.
 */
export const CatalogSystemRow: React.FC<CatalogSystemRowProps> = ({
  system,
  density,
  canSubscribe,
}) => {
  const isCompact = density === "compact";
  const description = system.description?.trim();

  return (
    <div
      className={cn(
        "group flex items-center rounded-md border border-transparent bg-surface/40 pr-1.5 transition-all hover:border-primary/40 hover:bg-surface-inset hover:shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]",
      )}
    >
      <Link
        to={resolveRoute(catalogRoutes.routes.systemDetail, {
          systemId: system.id,
        })}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 px-3",
          isCompact ? "py-1.5" : "py-2.5",
        )}
        title={isCompact && description ? description : undefined}
      >
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {system.name}
          </span>
          {!isCompact && description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {/* Fixed-width status lane so the badge slot aligns down the list rather
            than floating ragged-right. */}
        <div className="flex min-w-[2rem] shrink-0 items-center justify-end gap-1">
          <ExtensionSlot slot={SystemStateBadgesSlot} context={{ system }} />
        </div>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground"
          aria-hidden="true"
        />
      </Link>
      {canSubscribe && (
        <div className="shrink-0 pl-1">
          <NotificationSubscriptionsManager
            target={catalogSystemTarget}
            resource={{ systemId: system.id, systemName: system.name }}
            triggerClassName="h-8 w-8"
          />
        </div>
      )}
    </div>
  );
};
