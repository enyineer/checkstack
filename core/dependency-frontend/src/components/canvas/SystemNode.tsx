import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export interface SystemNodeData extends Record<string, unknown> {
  label: string;
  status?: "operational" | "degraded" | "down";
  derivedState?: "info" | "degraded" | "down";
  systemId: string;
  /** Number of systems this node depends on (outgoing edges via right handle) */
  upstreamCount: number;
  /** Number of systems that depend on this node (incoming edges via left handle) */
  downstreamCount: number;
}

export type SystemNode = Node<SystemNodeData, "system">;

const statusStyles: Record<string, { border: string; bg: string; glow: string; dot: string }> = {
  operational: {
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/5",
    glow: "shadow-emerald-500/10",
    dot: "bg-emerald-500",
  },
  degraded: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    glow: "shadow-amber-500/10",
    dot: "bg-amber-500",
  },
  down: {
    border: "border-red-500/40",
    bg: "bg-red-500/5",
    glow: "shadow-red-500/10",
    dot: "bg-red-500",
  },
};

function combineStatus(
  status?: string,
  derivedState?: string,
): "operational" | "degraded" | "down" {
  const order = { operational: 0, info: 0, degraded: 1, down: 2 };
  const ownLevel = order[(status ?? "operational") as keyof typeof order] ?? 0;
  const derivedLevel =
    order[(derivedState ?? "operational") as keyof typeof order] ?? 0;
  const level = Math.max(ownLevel, derivedLevel);
  if (level >= 2) return "down";
  if (level >= 1) return "degraded";
  return "operational";
}

/**
 * Custom React Flow node representing a system in the dependency graph.
 * Color-coded by worst of own status and derived warning state.
 * Features a split footer bar showing directional dependency counts
 * and color-coded handles for clear directionality.
 */
export const SystemNodeComponent = memo(function SystemNodeComponent({
  data,
  selected,
}: NodeProps<SystemNode>) {
  const effectiveStatus = combineStatus(data.status, data.derivedState);
  const styles = statusStyles[effectiveStatus];
  const hasConnections = data.upstreamCount > 0 || data.downstreamCount > 0;

  return (
    <>
      {/* Target handle (left) — "I am depended upon" — teal */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-teal-400/60 !border-2 !border-background !z-10"
      />

      <div
        className={`
          rounded-xl border-2 shadow-lg backdrop-blur-sm
          transition-all duration-200
          ${styles.border} ${styles.bg} ${styles.glow}
          ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}
          hover:scale-[1.02] cursor-grab active:cursor-grabbing
          min-w-[140px] max-w-[220px] overflow-hidden
        `}
      >
        {/* Main body */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            {/* Status dot */}
            <div className="relative flex-shrink-0">
              <div
                className={`w-2.5 h-2.5 rounded-full ${styles.dot}`}
              />
              {effectiveStatus !== "operational" && (
                <div
                  className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${styles.dot} animate-ping opacity-75`}
                />
              )}
            </div>

            {/* System name */}
            <span className="text-sm font-medium text-foreground truncate">
              {data.label}
            </span>
          </div>

          {/* Status labels */}
          <div className="mt-1.5 flex flex-col gap-0.5">
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold ${
                (data.status ?? "operational") === "operational"
                  ? "text-emerald-500/70"
                  : (data.status ?? "operational") === "degraded"
                    ? "text-amber-500/70"
                    : "text-red-500/70"
              }`}
            >
              {(data.status ?? "operational") === "operational"
                ? "Healthy"
                : (data.status ?? "operational") === "degraded"
                  ? "Degraded"
                  : "Unhealthy"}
            </span>
            {data.derivedState && (
              <span
                className={`text-[10px] uppercase tracking-wider font-semibold ${
                  data.derivedState === "info"
                    ? "text-blue-400/70"
                    : data.derivedState === "degraded"
                      ? "text-amber-500/70"
                      : "text-red-500/70"
                }`}
              >
                {data.derivedState === "info"
                  ? "↑ Upstream issue"
                  : data.derivedState === "degraded"
                    ? "↑ Upstream degraded"
                    : "↑ Upstream down"}
              </span>
            )}
          </div>
        </div>

        {/* Directional footer — only shown when the node has connections */}
        {hasConnections && (
          <div className="flex border-t border-border/40">
            {/* Left zone: incoming — systems that depend on this node */}
            <div className="flex-1 flex items-center gap-1 px-2.5 py-1.5 bg-teal-500/5 border-r border-border/30">
              <span className="text-[10px] text-teal-400/80 font-medium">
                ←
              </span>
              <span className="text-[10px] text-teal-400/80 font-medium tabular-nums">
                {data.downstreamCount}
              </span>
              <span className="text-[10px] text-muted-foreground/60 truncate">
                used by
              </span>
            </div>

            {/* Right zone: outgoing — systems this node depends on */}
            <div className="flex-1 flex items-center justify-end gap-1 px-2.5 py-1.5 bg-violet-500/5">
              <span className="text-[10px] text-muted-foreground/60 truncate">
                depends
              </span>
              <span className="text-[10px] text-violet-400/80 font-medium tabular-nums">
                {data.upstreamCount}
              </span>
              <span className="text-[10px] text-violet-400/80 font-medium">
                →
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Source handle (right) — "I depend on..." — violet */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-violet-400/60 !border-2 !border-background !z-10"
      />
    </>
  );
});
