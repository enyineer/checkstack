import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  type DerivedState,
  type AffectedUpstream,
} from "@checkstack/dependency-common";
import { cn, Badge } from "@checkstack/ui";
import { ArrowUpRight, AlertTriangle, Info } from "lucide-react";
import {
  derivedStateTone,
  ownStatusTone,
  toneStyles,
} from "./statusPill.logic";

type Props = SlotContext<typeof SystemDetailsTopSlot>;

function getAlertStyle(state: DerivedState): {
  icon: React.ReactNode;
  label: string;
} {
  switch (state) {
    case "down": {
      return {
        icon: <AlertTriangle className="h-5 w-5 text-status-down" />,
        label: "Critical Upstream Failure",
      };
    }
    case "degraded": {
      return {
        icon: <AlertTriangle className="h-5 w-5 text-status-warn" />,
        label: "Upstream Degradation",
      };
    }
    default: {
      return {
        icon: <Info className="h-5 w-5 text-info" />,
        label: "Upstream Dependency Notice",
      };
    }
  }
}

/**
 * Impact severity as a multi-encoded status pill (dot + label), driven by the
 * colorblind-safe status triad. `informational` is a neutral, non-degrading
 * signal, so it keeps the neutral secondary badge.
 */
function getImpactBadge(impactType: string): React.ReactNode {
  switch (impactType) {
    case "critical": {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-down/10 px-2.5 py-1 text-xs font-medium text-status-down">
          <span className="size-1.5 rounded-full bg-status-down" />
          Critical
        </span>
      );
    }
    case "degraded": {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-warn/10 px-2.5 py-1 text-xs font-medium text-status-warn">
          <span className="size-1.5 rounded-full bg-status-warn" />
          Degraded
        </span>
      );
    }
    default: {
      return <Badge variant="secondary">Info</Badge>;
    }
  }
}

/**
 * Alert banner component injected into the SystemDetailsTopSlot.
 * Shows warnings when upstream dependencies are affected, as a premium panel:
 * layered depth, a left accent stripe keyed to the derived state, and a
 * number-led hero counting the affected upstreams.
 */
export const DependencyAlert: React.FC<Props> = ({ system }) => {
  const depClient = usePluginClient(DependencyApi);

  const { data } = depClient.getWarningsForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id },
  );

  if (!data || data.affectedUpstreams.length === 0) return;

  const style = getAlertStyle(data.derivedState);
  const accentTone = toneStyles[derivedStateTone({ state: data.derivedState })];
  const affectedCount = data.affectedUpstreams.length;

  return (
    <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
      {/* Status accent stripe: derived state by position + hue. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accentTone.accent)}
        aria-hidden
      />

      <div className="pl-3">
        {/* Number-led header: N affected upstreams. */}
        <div className="flex items-center gap-3">
          {style.icon}
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums leading-none text-foreground">
              {affectedCount}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              {style.label}
            </span>
          </div>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          This system is affected by upstream dependency issues:
        </p>

        <div className="mt-2 divide-y divide-border/60">
          {data.affectedUpstreams.map((upstream: AffectedUpstream) => {
            const ownTone = toneStyles[ownStatusTone({ ownStatus: upstream.ownStatus })];
            return (
              <div
                key={upstream.systemId}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-surface-inset"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">
                    {upstream.systemName}
                  </span>
                  {upstream.dependencyLabel && (
                    <span className="truncate text-xs text-muted-foreground">
                      ({upstream.dependencyLabel})
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                      ownTone.pill,
                    )}
                  >
                    <span
                      className={cn("size-1.5 rounded-full", ownTone.dot)}
                    />
                    {upstream.ownStatus}
                  </span>
                  {getImpactBadge(upstream.impactType)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
