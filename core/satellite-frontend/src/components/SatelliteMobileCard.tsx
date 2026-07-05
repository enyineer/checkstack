import React from "react";
import { RowActions, RowAction, cn, formatRelativeTime } from "@checkstack/ui";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import { KeyRound, MapPin, Trash2 } from "lucide-react";
import { GitOpsSourceBadge } from "@checkstack/gitops-frontend";
import type { ProvenanceLock } from "@checkstack/gitops-frontend";
import { SatelliteStatusBadge } from "./SatelliteStatusBadge";

/** Left accent stripe colour by status: position + hue, not colour alone. */
const ACCENT_BY_STATUS: Record<SatelliteWithStatus["status"], string> = {
  online: "bg-status-ok",
  offline: "bg-status-down",
};

export interface SatelliteMobileCardProps {
  satellite: SatelliteWithStatus;
  lock: ProvenanceLock;
  onRotate: (satellite: SatelliteWithStatus) => void;
  onDelete: (satellite: SatelliteWithStatus) => void;
}

/**
 * Mobile roster card on the premium bar: a depth gradient + layered shadow, a
 * status-encoding left accent stripe, a name-led hierarchy with the id demoted
 * to mono, and labeled micro-stats (region, version, last seen). The ghost
 * action row keeps its titles, aria-labels, handlers, and GitOps lock disabling
 * verbatim.
 */
export const SatelliteMobileCard: React.FC<SatelliteMobileCardProps> = ({
  satellite,
  lock,
  onRotate,
  onDelete,
}) => {
  const lastSeen = formatRelativeTime(satellite.lastHeartbeatAt);

  return (
    <div className="relative flex flex-col overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all active:translate-y-px">
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          ACCENT_BY_STATUS[satellite.status],
        )}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="flex min-w-0 items-center gap-2">
          {lock.isLocked && lock.provenance && (
            <GitOpsSourceBadge provenance={lock.provenance} />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {satellite.name}
            </p>
            <p className="truncate text-xs text-muted-foreground font-mono">
              {satellite.id}
            </p>
          </div>
        </div>
        <SatelliteStatusBadge status={satellite.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {satellite.region}
        </span>
        <span className="tabular-nums font-mono">
          {satellite.version ?? "—"}
        </span>
        {lastSeen && <span>Last seen {lastSeen}</span>}
      </div>

      <RowActions className="mt-3 pl-2">
        <RowAction
          icon={KeyRound}
          label={`Reset token for ${satellite.name}`}
          title="Reset token"
          onClick={() => onRotate(satellite)}
        />
        <RowAction
          icon={Trash2}
          tone="destructive"
          label={`Delete ${satellite.name}`}
          disabled={lock.isLocked}
          title={lock.isLocked ? "Managed by GitOps" : "Delete satellite"}
          onClick={() => onDelete(satellite)}
        />
      </RowActions>
    </div>
  );
};
