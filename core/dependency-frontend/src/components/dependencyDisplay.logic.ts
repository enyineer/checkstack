import type { DerivedState } from "@checkstack/dependency-common";
import type { StatusTone } from "@checkstack/ui";

/**
 * Pure, DOM-free display helpers for the dependency plugin.
 *
 * These translate a system's `DerivedState` (the worst upstream impact) into the
 * badge tone/label shown on the dashboard, and combine a node's own status with
 * its derived state for the dependency-graph node color. The `StatusTone` import
 * is type-only, so it is erased at runtime and this module stays free of any
 * `@checkstack/ui` runtime dependency.
 */

/** Combined own-status + derived-state level for a dependency-graph node. */
export type NodeStatus = "operational" | "degraded" | "down";

/** Severity ranking shared by own status and derived state. Higher = worse. */
const STATUS_LEVEL: Record<string, number> = {
  operational: 0,
  info: 0,
  degraded: 1,
  down: 2,
};

/**
 * Resolve the worst of a node's own status and its derived warning state. Both
 * inputs are optional; an unknown value (including `undefined`) is treated as
 * `operational` (level 0). `info` ranks the same as `operational` because it is
 * an informational, non-degrading signal.
 */
export function combineStatus({
  status,
  derivedState,
}: {
  status?: string;
  derivedState?: string;
}): NodeStatus {
  const ownLevel = STATUS_LEVEL[status ?? "operational"] ?? 0;
  const derivedLevel = STATUS_LEVEL[derivedState ?? "operational"] ?? 0;
  const level = Math.max(ownLevel, derivedLevel);
  if (level >= 2) return "down";
  if (level >= 1) return "degraded";
  return "operational";
}

/**
 * Badge tone for a derived dependency state. `down` is an error, `degraded` a
 * warning, and the informational `info` state maps to the neutral `info` tone.
 */
export function getBadgeTone({ state }: { state: DerivedState }): StatusTone {
  switch (state) {
    case "down": {
      return "error";
    }
    case "degraded": {
      return "warn";
    }
    default: {
      return "info";
    }
  }
}

/** Human label for the dependency warning badge, by derived state. */
export function getBadgeLabel({ state }: { state: DerivedState }): string {
  switch (state) {
    case "down": {
      return "Upstream down";
    }
    case "degraded": {
      return "Upstream degraded";
    }
    default: {
      return "Dependency info";
    }
  }
}

/** Placed node positions keyed by system id. */
export type NodePositionMap = Map<string, { x: number; y: number }>;

/** A previously persisted node position. */
export interface SavedNodePosition {
  systemId: string;
  x: number;
  y: number;
}

/**
 * Compute node positions for the dependency graph. Systems with a saved
 * position keep it; the rest are auto-placed in a square-ish grid (column count
 * = ceil(sqrt(unpositioned)), 250x120 spacing, offset 100,100). Saved positions
 * take precedence even when a system also appears in `systemIds`.
 */
export function autoLayout({
  systemIds,
  savedPositions,
}: {
  systemIds: string[];
  savedPositions: SavedNodePosition[];
}): NodePositionMap {
  const posMap: NodePositionMap = new Map();
  const savedMap = new Map(savedPositions.map((p) => [p.systemId, p]));

  const unpositioned = systemIds.filter((id) => !savedMap.has(id));
  const cols = Math.ceil(Math.sqrt(unpositioned.length));
  const spacingX = 250;
  const spacingY = 120;

  // Apply saved positions
  for (const pos of savedPositions) {
    posMap.set(pos.systemId, { x: pos.x, y: pos.y });
  }

  // Auto-position remaining systems
  for (const [index, id] of unpositioned.entries()) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    posMap.set(id, {
      x: col * spacingX + 100,
      y: row * spacingY + 100,
    });
  }

  return posMap;
}
