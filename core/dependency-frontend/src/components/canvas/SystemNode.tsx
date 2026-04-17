import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export interface SystemNodeData extends Record<string, unknown> {
  label: string;
  status?: "operational" | "degraded" | "down";
  derivedState?: "info" | "degraded" | "down";
  systemId: string;
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
 */
export const SystemNodeComponent = memo(function SystemNodeComponent({
  data,
  selected,
}: NodeProps<SystemNode>) {
  const effectiveStatus = combineStatus(data.status, data.derivedState);
  const styles = statusStyles[effectiveStatus];

  return (
    <>
      {/* Target handle (left) — "I am depended upon" */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background"
      />

      <div
        className={`
          px-4 py-3 rounded-xl border-2 shadow-lg backdrop-blur-sm
          transition-all duration-200
          ${styles.border} ${styles.bg} ${styles.glow}
          ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}
          hover:scale-[1.02] cursor-grab active:cursor-grabbing
          min-w-[140px] max-w-[200px]
        `}
      >
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

        {/* Subtle status label */}
        <div className="mt-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/60">
            {effectiveStatus === "operational"
              ? "Operational"
              : effectiveStatus === "degraded"
                ? "Degraded"
                : "Down"}
          </span>
        </div>
      </div>

      {/* Source handle (right) — "I depend on..." */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background"
      />
    </>
  );
});
