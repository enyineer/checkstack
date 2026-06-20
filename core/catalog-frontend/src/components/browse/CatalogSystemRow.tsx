import React from "react";
import { Link } from "react-router-dom";
import { ExtensionSlot } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  catalogRoutes,
  SystemStateBadgesSlot,
  type System,
} from "@checkstack/catalog-common";
import { cn } from "@checkstack/ui";
import { ChevronRight } from "lucide-react";
import type { Density } from "./browseState.logic";

export interface CatalogSystemRowProps {
  system: System;
  density: Density;
}

/**
 * One browse row for a single system: name (links to the system detail page),
 * the `SystemStateBadgesSlot` (health/maintenance/incident badges contributed
 * by other plugins — exactly the decoupled mechanism `SystemDetailPage` uses),
 * and a density-aware description. Compact density drops the inline
 * description to a `title` tooltip and tightens spacing.
 */
export const CatalogSystemRow: React.FC<CatalogSystemRowProps> = ({
  system,
  density,
}) => {
  const isCompact = density === "compact";
  const description = system.description?.trim();

  return (
    <Link
      to={resolveRoute(catalogRoutes.routes.systemDetail, {
        systemId: system.id,
      })}
      className={cn(
        "group flex items-center gap-3 rounded-md border border-transparent bg-surface/40 px-3 transition-all hover:border-primary/40 hover:bg-surface-inset hover:shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]",
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
  );
};
