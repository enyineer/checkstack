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
 * A directed dependency edge for layout purposes: `source` depends on `target`
 * (source is downstream, target is upstream). Layered layouts flow left→right
 * with upstream targets placed to the right of the sources that depend on them.
 */
export interface DependencyEdgeInput {
  source: string;
  target: string;
}

/** Horizontal spacing between layout columns (one layer apart). */
const COL_SPACING = 280;
/** Vertical spacing between rows within a column. */
const ROW_SPACING = 140;
/** Gap inserted between an existing block and a freshly-arranged one. */
const BLOCK_GAP = 160;
/** Default origin for a from-scratch layout. */
const DEFAULT_ORIGIN = { x: 100, y: 100 } as const;

/**
 * Place a set of nodes given a signed column index per node. Each distinct
 * column is a vertical stack, and every column is centered vertically around
 * `origin.y` so the block reads as a tidy, balanced band. Columns are laid out
 * left→right by ascending column index (which may be negative). Within a column
 * nodes keep the given `order` (already stable-sorted by the caller).
 */
function placeColumns({
  columnOf,
  order,
  origin,
}: {
  columnOf: Map<string, number>;
  order: string[];
  origin: { x: number; y: number };
}): NodePositionMap {
  const byColumn = new Map<number, string[]>();
  for (const id of order) {
    const col = columnOf.get(id) ?? 0;
    const bucket = byColumn.get(col);
    if (bucket) {
      bucket.push(id);
    } else {
      byColumn.set(col, [id]);
    }
  }

  const tallest = Math.max(
    1,
    ...[...byColumn.values()].map((bucket) => bucket.length),
  );
  const centerY = origin.y + ((tallest - 1) * ROW_SPACING) / 2;

  const map: NodePositionMap = new Map();
  for (const [col, ids] of byColumn) {
    const columnTop = centerY - ((ids.length - 1) * ROW_SPACING) / 2;
    for (const [row, id] of ids.entries()) {
      map.set(id, {
        x: origin.x + col * COL_SPACING,
        y: columnTop + row * ROW_SPACING,
      });
    }
  }
  return map;
}

/**
 * Longest-path layering of a DAG subset. For each edge `source → target` the
 * target is pushed at least one layer deeper (to the right), so upstream systems
 * end up right of everything that depends on them. Nodes never referenced by an
 * internal edge stay at layer 0. The dependency graph is a guaranteed DAG
 * (cycles are rejected on write); a stray cycle degrades gracefully to layer 0
 * for the unreached nodes rather than looping.
 */
function layerNodes({
  nodes,
  edges,
}: {
  nodes: Set<string>;
  edges: DependencyEdgeInput[];
}): Map<string, number> {
  const layer = new Map<string, number>();
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of nodes) {
    layer.set(id, 0);
    indegree.set(id, 0);
    outgoing.set(id, []);
  }

  const internal = edges.filter(
    (e) => nodes.has(e.source) && nodes.has(e.target),
  );
  for (const edge of internal) {
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  // Kahn topological order, relaxing the longest path as we go.
  const queue = [...nodes].filter((id) => (indegree.get(id) ?? 0) === 0);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    const nodeLayer = layer.get(node) ?? 0;
    for (const next of outgoing.get(node) ?? []) {
      if ((layer.get(next) ?? 0) < nodeLayer + 1) {
        layer.set(next, nodeLayer + 1);
      }
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return layer;
}

/**
 * Crossing-reduction ordering (the Sugiyama ordering phase). Given a column per
 * node, decide the vertical order WITHIN each column so connected nodes line up
 * across columns and edges cross as little as possible. Uses the classic
 * barycenter heuristic: sweep columns left→right ordering each by the average
 * row of its parents (previous column), then right→left by its children (next
 * column), repeated a few times. Nodes with no neighbour on the relevant side
 * keep their current relative order (stable). Returns the flattened node list in
 * final per-column order, suitable for {@link placeColumns}.
 */
function orderByBarycenter({
  nodes,
  columnOf,
  edges,
  seedOrder,
}: {
  nodes: Set<string>;
  columnOf: Map<string, number>;
  edges: DependencyEdgeInput[];
  seedOrder: string[];
}): string[] {
  const byColumn = new Map<number, string[]>();
  for (const id of seedOrder) {
    if (!nodes.has(id)) continue;
    const col = columnOf.get(id) ?? 0;
    const bucket = byColumn.get(col);
    if (bucket) bucket.push(id);
    else byColumn.set(col, [id]);
  }
  const columns = [...byColumn.keys()].toSorted((a, b) => a - b);

  const rowOf = new Map<string, number>();
  const reindex = (): void => {
    for (const bucket of byColumn.values()) {
      for (const [index, id] of bucket.entries()) rowOf.set(id, index);
    }
  };
  reindex();

  const parents = new Map<string, string[]>(); // id → sources pointing at it (left)
  const children = new Map<string, string[]>(); // id → targets it points at (right)
  for (const id of nodes) {
    parents.set(id, []);
    children.set(id, []);
  }
  for (const edge of edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    children.get(edge.source)?.push(edge.target);
    parents.get(edge.target)?.push(edge.source);
  }

  const orderColumn = (
    bucket: string[],
    neighbours: Map<string, string[]>,
  ): string[] => {
    const score = new Map<string, number>();
    for (const [index, id] of bucket.entries()) {
      const list = neighbours.get(id) ?? [];
      if (list.length === 0) {
        score.set(id, index); // no anchor → keep current position
        continue;
      }
      let sum = 0;
      for (const other of list) sum += rowOf.get(other) ?? 0;
      score.set(id, sum / list.length);
    }
    return bucket.toSorted(
      (a, b) =>
        (score.get(a) ?? 0) - (score.get(b) ?? 0) ||
        (rowOf.get(a) ?? 0) - (rowOf.get(b) ?? 0),
    );
  };

  for (let iteration = 0; iteration < 3; iteration++) {
    // Forward: each column follows its parents in the previous column.
    for (let i = 1; i < columns.length; i++) {
      const col = columns[i] ?? 0;
      const bucket = byColumn.get(col);
      if (bucket) byColumn.set(col, orderColumn(bucket, parents));
      reindex();
    }
    // Backward: each column follows its children in the next column.
    for (let i = columns.length - 2; i >= 0; i--) {
      const col = columns[i] ?? 0;
      const bucket = byColumn.get(col);
      if (bucket) byColumn.set(col, orderColumn(bucket, children));
      reindex();
    }
  }

  const ordered: string[] = [];
  for (const col of columns) ordered.push(...(byColumn.get(col) ?? []));
  return ordered;
}

/**
 * Sugiyama-style layered layout for a set of systems. Systems connected by any
 * edge are arranged left→right by dependency depth (upstream to the right).
 * Systems with no edge to any other node in the set are "edgeless" and parked in
 * a single column off to the right so they never tangle with the wired graph.
 */
export function sugiyamaLayout({
  systemIds,
  edges,
  origin = DEFAULT_ORIGIN,
}: {
  systemIds: string[];
  edges: DependencyEdgeInput[];
  origin?: { x: number; y: number };
}): NodePositionMap {
  const nodes = new Set(systemIds);
  const internal = edges.filter(
    (e) => nodes.has(e.source) && nodes.has(e.target),
  );

  const connected = new Set<string>();
  for (const edge of internal) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  // Seed vertical order from caller input, then reduce edge crossings.
  const connectedOrder = systemIds.filter((id) => connected.has(id));
  const edgeless = systemIds.filter((id) => !connected.has(id));

  const layer = layerNodes({ nodes: connected, edges: internal });
  const ordered = orderByBarycenter({
    nodes: connected,
    columnOf: layer,
    edges: internal,
    seedOrder: connectedOrder,
  });
  const map = placeColumns({
    columnOf: layer,
    order: ordered,
    origin,
  });

  // Park edgeless nodes to the right of the wired graph (or at the origin when
  // there is no wired graph at all), so they stay out of the way.
  let parkX = origin.x;
  if (map.size > 0) {
    const maxX = Math.max(...[...map.values()].map((p) => p.x));
    parkX = maxX + COL_SPACING + BLOCK_GAP;
  }
  for (const [index, id] of edgeless.entries()) {
    map.set(id, { x: parkX, y: origin.y + index * ROW_SPACING });
  }

  return map;
}

/**
 * Center-on-box layout: arrange the whole graph around one focus system. The
 * focus sits at the center; systems it depends on (upstream) fan out to the
 * right by dependency distance, systems that depend on it (downstream) fan out
 * to the left. Systems in a different connected component are parked below the
 * focused band so they do not interfere.
 */
export function centerLayout({
  focusId,
  systemIds,
  edges,
  origin = DEFAULT_ORIGIN,
}: {
  focusId: string;
  systemIds: string[];
  edges: DependencyEdgeInput[];
  origin?: { x: number; y: number };
}): NodePositionMap {
  const nodes = new Set(systemIds);
  if (!nodes.has(focusId)) {
    return sugiyamaLayout({ systemIds, edges, origin });
  }

  const internal = edges.filter(
    (e) => nodes.has(e.source) && nodes.has(e.target),
  );
  const upstreamOf = new Map<string, string[]>(); // source → targets it depends on
  const downstreamOf = new Map<string, string[]>(); // target → sources depending on it
  for (const id of nodes) {
    upstreamOf.set(id, []);
    downstreamOf.set(id, []);
  }
  for (const edge of internal) {
    upstreamOf.get(edge.source)?.push(edge.target);
    downstreamOf.get(edge.target)?.push(edge.source);
  }

  const columnOf = new Map<string, number>([[focusId, 0]]);

  // BFS outward in one direction, assigning signed column distances. Nodes
  // already assigned (including the focus) are never reassigned, so a diamond
  // resolves to whichever side reaches it first.
  const bfs = ({
    adjacency,
    sign,
  }: {
    adjacency: Map<string, string[]>;
    sign: number;
  }): void => {
    const queue = [focusId];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined) break;
      const nodeColumn = columnOf.get(node) ?? 0;
      for (const next of adjacency.get(node) ?? []) {
        if (columnOf.has(next)) continue;
        columnOf.set(next, nodeColumn + sign);
        queue.push(next);
      }
    }
  };
  bfs({ adjacency: upstreamOf, sign: 1 });
  bfs({ adjacency: downstreamOf, sign: -1 });

  const reachable = systemIds.filter((id) => columnOf.has(id));
  const ordered = orderByBarycenter({
    nodes: new Set(reachable),
    columnOf,
    edges: internal,
    seedOrder: reachable,
  });
  const map = placeColumns({ columnOf, order: ordered, origin });

  // Park systems unreachable from the focus below the focused band.
  const disconnected = systemIds.filter((id) => !columnOf.has(id));
  if (disconnected.length > 0) {
    const maxY = Math.max(origin.y, ...[...map.values()].map((p) => p.y));
    const parkTop = maxY + ROW_SPACING + BLOCK_GAP;
    for (const [index, id] of disconnected.entries()) {
      map.set(id, {
        x: origin.x + index * COL_SPACING,
        y: parkTop,
      });
    }
  }

  return map;
}

/**
 * Default layout used when opening the map. Saved positions are kept verbatim;
 * only unpositioned systems are arranged:
 *
 * - No saved positions at all → lay the whole graph out with {@link sugiyamaLayout}.
 * - Some saved positions → arrange just the new systems as their own tidy
 *   layered block placed in free space below the saved bounding box, so nothing
 *   the user already placed ever moves.
 *
 * `edges` drives the layered arrangement; pass every dependency edge among the
 * systems being laid out.
 */
export function autoLayout({
  systemIds,
  savedPositions,
  edges,
}: {
  systemIds: string[];
  savedPositions: SavedNodePosition[];
  edges: DependencyEdgeInput[];
}): NodePositionMap {
  const savedMap = new Map(
    savedPositions.map((p) => [p.systemId, { x: p.x, y: p.y }]),
  );
  const result: NodePositionMap = new Map(savedMap);

  const unpositioned = systemIds.filter((id) => !savedMap.has(id));
  if (unpositioned.length === 0) {
    return result;
  }

  if (savedMap.size === 0) {
    const laid = sugiyamaLayout({
      systemIds: unpositioned,
      edges,
      origin: DEFAULT_ORIGIN,
    });
    for (const [id, pos] of laid) result.set(id, pos);
    return result;
  }

  // Tidy block in free space: place the new systems below the saved bounding
  // box, left-aligned to it. `sugiyamaLayout` filters `edges` to those among the
  // new systems, so a new box wired only to a saved box is treated as edgeless
  // and parked to the side of the new block.
  const savedX = [...savedMap.values()].map((p) => p.x);
  const savedY = [...savedMap.values()].map((p) => p.y);
  const origin = {
    x: Math.min(...savedX),
    y: Math.max(...savedY) + ROW_SPACING + BLOCK_GAP,
  };
  const block = sugiyamaLayout({ systemIds: unpositioned, edges, origin });
  for (const [id, pos] of block) result.set(id, pos);

  return result;
}
