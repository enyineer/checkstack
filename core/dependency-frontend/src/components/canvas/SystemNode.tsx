import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { cn, usePerformance } from "@checkstack/ui";
import { combineStatus, type NodeStatus } from "../dependencyDisplay.logic";

export interface SystemNodeData extends Record<string, unknown> {
  label: string;
  status?: "operational" | "degraded" | "down";
  derivedState?: "info" | "degraded" | "down";
  systemId: string;
  /** Number of systems this node depends on (outgoing edges via right handle) */
  upstreamCount: number;
  /** Number of systems that depend on this node (incoming edges via left handle) */
  downstreamCount: number;
  /**
   * Whether the current user may MANAGE this system, and therefore ORIGINATE a
   * dependency FROM it. Only managed systems expose an enabled outgoing (source)
   * connection handle; the incoming (target) handle is always available since
   * targets are not access-checked.
   */
  canManage: boolean;
}

export type SystemNode = Node<SystemNodeData, "system">;

/**
 * Per-status class sets for the node's left accent stripe, status pill, and dot.
 * Spelled out as full literal strings (not interpolated) so Tailwind's JIT keeps
 * them, and driven by the colorblind-safe status triad.
 */
const statusStyles: Record<
  NodeStatus,
  { accent: string; pill: string; dot: string }
> = {
  operational: {
    accent: "bg-status-ok",
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
  },
  degraded: {
    accent: "bg-status-warn",
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
  },
  down: {
    accent: "bg-status-down",
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
  },
};

const ownStatusLabel: Record<string, string> = {
  operational: "Healthy",
  degraded: "Degraded",
  down: "Unhealthy",
};

const derivedStateLabel: Record<string, string> = {
  info: "↑ Upstream issue",
  degraded: "↑ Upstream degraded",
  down: "↑ Upstream down",
};

/**
 * Custom React Flow node representing a system in the dependency graph,
 * styled as a mini premium card: layered depth, a left accent stripe keyed to
 * the worst of own + derived status, a multi-encoded status pill, and the two
 * directional dependency counts promoted to number-led heroes. Color-coded
 * handles preserve directionality.
 */
export const SystemNodeComponent = memo(function SystemNodeComponent({
  data,
  selected,
}: NodeProps<SystemNode>) {
  const { isLowPower } = usePerformance();
  const effectiveStatus = combineStatus({
    status: data.status,
    derivedState: data.derivedState,
  });
  const styles = statusStyles[effectiveStatus];
  const hasConnections = data.upstreamCount > 0 || data.downstreamCount > 0;

  const ownStatus = data.status ?? "operational";

  return (
    <>
      {/* Target handle (left) — "I am depended upon" — teal */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-teal-400/60 !border-2 !border-background !z-10"
      />

      <div
        className={cn(
          "relative min-w-[140px] max-w-[220px] overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
          !isLowPower &&
            "backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          !isLowPower && "hover:scale-[1.02]",
          "cursor-grab active:cursor-grabbing",
        )}
      >
        {/* Status accent stripe: status by position + hue, not border tint alone. */}
        <span
          className={cn("absolute inset-y-0 left-0 w-1", styles.accent)}
          aria-hidden
        />

        {/* Main body */}
        <div className="py-3 pl-3 pr-3">
          <div className="flex items-start justify-between gap-2">
            <span className="mt-0.5 truncate text-sm font-medium text-foreground">
              {data.label}
            </span>
            {/* Status pill */}
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                styles.pill,
              )}
            >
              <span className="relative flex-shrink-0">
                <span
                  className={cn("block size-1.5 rounded-full", styles.dot)}
                />
                {effectiveStatus !== "operational" && !isLowPower && (
                  <span
                    className={cn(
                      "absolute inset-0 size-1.5 rounded-full opacity-75 animate-ping",
                      styles.dot,
                    )}
                  />
                )}
              </span>
              {ownStatusLabel[ownStatus]}
            </span>
          </div>

          {data.derivedState && (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {derivedStateLabel[data.derivedState]}
            </p>
          )}
        </div>

        {/* Directional footer — the number-led moment, only when connected */}
        {hasConnections && (
          <div className="flex border-t border-border/60">
            {/* Left zone: incoming — systems that depend on this node */}
            <div className="flex flex-1 flex-col items-start px-3 py-2 border-r border-border/40">
              <span className="text-xl font-bold tabular-nums text-foreground leading-none">
                {data.downstreamCount}
              </span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">
                used by
              </span>
            </div>

            {/* Right zone: outgoing — systems this node depends on */}
            <div className="flex flex-1 flex-col items-end px-3 py-2">
              <span className="text-xl font-bold tabular-nums text-foreground leading-none">
                {data.upstreamCount}
              </span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">
                depends
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Source handle (right) — "I depend on..." — violet.
          ALWAYS rendered: React Flow silently drops every edge whose source
          node has no source handle, so hiding it for unmanaged systems erased
          all outgoing edges from read-only users' maps. Manage access gates
          only CONNECTABILITY (drag-to-connect); unmanaged systems show the
          same handle muted and inert. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={data.canManage}
        isConnectableStart={data.canManage}
        className={cn(
          "!w-3 !h-3 !border-2 !border-background !z-10",
          data.canManage
            ? "!bg-violet-400/60"
            : "!bg-muted-foreground/25 !cursor-default",
        )}
        title={
          data.canManage
            ? undefined
            : "You can only add dependencies from systems you manage"
        }
        aria-label={
          data.canManage
            ? undefined
            : "You can only add dependencies from systems you manage"
        }
      />
    </>
  );
});
