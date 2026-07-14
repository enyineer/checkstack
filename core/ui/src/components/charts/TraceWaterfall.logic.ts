/**
 * Pure geometry/tree helpers for the {@link TraceWaterfall} component.
 *
 * Framework-free and side-effect-free so they can be unit-tested in isolation
 * (see `TraceWaterfall.logic.test.ts`). The component owns all DOM/SVG concerns;
 * everything about building the span tree, flattening the visible rows and
 * placing bars on the shared time axis lives here.
 */

/** Span status as served by the trace store (mirrors OTel status codes). */
export type WaterfallSpanStatus = "unset" | "ok" | "error";

/**
 * One span as consumed by the waterfall. Deliberately decoupled from
 * `@checkstack/tracestream-common`'s `TraceSpan` so the UI package carries no
 * domain dependency: callers map their spans onto this shape. `startTs` accepts
 * a `Date` or a millisecond epoch number.
 */
export interface WaterfallSpan {
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  serviceName?: string | null;
  kind: string;
  startTs: Date | number;
  durationMs: number;
  statusCode: WaterfallSpanStatus;
}

/** A span placed in the tree with its depth and shared-axis geometry. */
export interface TraceTreeNode {
  span: WaterfallSpan;
  spanId: string;
  /** 0 for roots (true roots AND promoted orphans). */
  depth: number;
  /** Absolute start on the trace axis, ms epoch. */
  startMs: number;
  /** Absolute end (`startMs + max(0, durationMs)`), ms epoch. */
  endMs: number;
  /** Left offset as a fraction [0,1] of the trace's total span. */
  leftFraction: number;
  /** Width as a fraction [0,1] of the trace's total span. */
  widthFraction: number;
  /** This span's own status is `error`. */
  isError: boolean;
  children: TraceTreeNode[];
}

/** Result of building a trace tree from a flat span set. */
export interface TraceTree {
  roots: TraceTreeNode[];
  /** Earliest span start across the trace, ms epoch. */
  startMs: number;
  /** Latest span end across the trace, ms epoch. */
  endMs: number;
  /** `endMs - startMs`, ms (>= 0). */
  totalMs: number;
  /** Number of spans placed in the tree (deduped by spanId). */
  spanCount: number;
}

/** Coerce a `Date | number` start into a millisecond epoch. */
export function toMs(ts: Date | number): number {
  return typeof ts === "number" ? ts : ts.getTime();
}

/**
 * Build the hierarchical trace tree from a flat span set.
 *
 * Roots are spans with no parent OR whose `parentSpanId` is not present in the
 * set: such ORPHANS are promoted to the root level (documented behaviour - there
 * is no visible synthetic node, they simply render at depth 0). Children are
 * ordered by start time (ties broken by spanId for stability). A `visited` guard
 * makes the walk safe against duplicate spanIds and parent/child cycles; any
 * span trapped in a cycle with no path from a root is appended as a root so it
 * is never silently dropped.
 *
 * All spans share ONE time axis: `leftFraction`/`widthFraction` are computed
 * against the trace's `[startMs, endMs]` extent, so a bar's horizontal position
 * and length are literally when it ran and how long it took.
 */
export function buildTraceTree({
  spans,
}: {
  spans: ReadonlyArray<WaterfallSpan>;
}): TraceTree {
  if (spans.length === 0) {
    return { roots: [], startMs: 0, endMs: 0, totalMs: 0, spanCount: 0 };
  }

  const byId = new Map<string, WaterfallSpan>();
  for (const s of spans) byId.set(s.spanId, s);

  // Trace extent across every span (use the deduped set so a duplicated spanId
  // does not distort the axis).
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const s of byId.values()) {
    const start = toMs(s.startTs);
    const end = start + Math.max(0, s.durationMs);
    if (start < startMs) startMs = start;
    if (end > endMs) endMs = end;
  }
  const totalMs = Math.max(0, endMs - startMs);
  const denom = totalMs <= 0 ? 1 : totalMs;

  const childrenOf = new Map<string, WaterfallSpan[]>();
  const rootSpans: WaterfallSpan[] = [];
  for (const s of byId.values()) {
    const pid = s.parentSpanId ?? null;
    if (pid !== null && pid !== s.spanId && byId.has(pid)) {
      const bucket = childrenOf.get(pid);
      if (bucket) bucket.push(s);
      else childrenOf.set(pid, [s]);
    } else {
      rootSpans.push(s);
    }
  }

  const byStart = (a: WaterfallSpan, b: WaterfallSpan): number => {
    const d = toMs(a.startTs) - toMs(b.startTs);
    if (d !== 0) return d;
    return a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0;
  };

  const visited = new Set<string>();
  let placed = 0;

  const buildNode = (span: WaterfallSpan, depth: number): TraceTreeNode => {
    visited.add(span.spanId);
    placed += 1;
    const spanStart = toMs(span.startTs);
    const duration = Math.max(0, span.durationMs);
    const spanEnd = spanStart + duration;
    const rawLeft = (spanStart - startMs) / denom;
    const leftFraction = Math.min(1, Math.max(0, rawLeft));
    const rawWidth = duration / denom;
    const maxWidth = 1 - leftFraction;
    const widthFraction = Math.min(maxWidth, Math.max(0, rawWidth));
    const kids = (childrenOf.get(span.spanId) ?? [])
      .filter((c) => !visited.has(c.spanId))
      .toSorted(byStart)
      .map((c) => buildNode(c, depth + 1));
    return {
      span,
      spanId: span.spanId,
      depth,
      startMs: spanStart,
      endMs: spanEnd,
      leftFraction,
      widthFraction,
      isError: span.statusCode === "error",
      children: kids,
    };
  };

  const roots = rootSpans.toSorted(byStart).map((s) => buildNode(s, 0));

  // Any span caught in a parent/child cycle (never reached from a root) is
  // surfaced as a root rather than dropped.
  for (const s of byId.values()) {
    if (!visited.has(s.spanId)) roots.push(buildNode(s, 0));
  }
  roots.sort((a, b) => byStart(a.span, b.span));

  return { roots, startMs, endMs, totalMs, spanCount: placed };
}

/** One flattened, currently-visible waterfall row (feeds the virtual list). */
export interface WaterfallRow {
  spanId: string;
  span: WaterfallSpan;
  depth: number;
  hasChildren: boolean;
  /** True when this node is collapsed (its subtree is hidden). */
  collapsed: boolean;
  startMs: number;
  endMs: number;
  leftFraction: number;
  widthFraction: number;
  isError: boolean;
}

/**
 * Depth-first pre-order flatten of the tree into the rows currently visible,
 * skipping the subtrees of collapsed nodes. Producing a flat array is what lets
 * the component virtualize: collapsing a node simply shortens the array the
 * virtualizer windows over.
 */
export function flattenVisibleRows({
  roots,
  collapsed,
}: {
  roots: ReadonlyArray<TraceTreeNode>;
  collapsed: ReadonlySet<string>;
}): WaterfallRow[] {
  const rows: WaterfallRow[] = [];
  const walk = (node: TraceTreeNode): void => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.spanId);
    rows.push({
      spanId: node.spanId,
      span: node.span,
      depth: node.depth,
      hasChildren,
      collapsed: isCollapsed,
      startMs: node.startMs,
      endMs: node.endMs,
      leftFraction: node.leftFraction,
      widthFraction: node.widthFraction,
      isError: node.isError,
    });
    if (!isCollapsed) {
      for (const child of node.children) walk(child);
    }
  };
  for (const root of roots) walk(root);
  return rows;
}

/**
 * Format a span duration for the waterfall's duration column and axis. Unlike
 * the coarse `formatDuration`, this keeps sub-second precision (spans are often
 * microseconds-to-milliseconds): a real sub-millisecond span reads as "<1 ms"
 * rather than a bare "0", millisecond spans keep whole ms, and second-plus
 * spans get one decimal so "1.4 s" stays honest.
 */
export function formatSpanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms === 0) return "0 ms";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  // Round to whole seconds FIRST so 119.5s becomes "2m 0s", never "1m 60s".
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** Size of the deterministic service-color palette (matches `--chart-1..5`). */
export const SERVICE_PALETTE_SIZE = 5;

/**
 * Deterministic palette index [0, {@link SERVICE_PALETTE_SIZE}) for a service
 * name, so the same service always gets the same color lane across renders and
 * across traces. `null`/empty names return `null` (rendered with a muted lane).
 */
export function serviceColorIndex(serviceName: string | null | undefined): number | null {
  if (!serviceName) return null;
  // djb2 - small, stable, no dependency.
  let hash = 5381;
  for (let i = 0; i < serviceName.length; i += 1) {
    hash = (hash * 33) ^ (serviceName.codePointAt(i) ?? 0);
  }
  return Math.abs(hash) % SERVICE_PALETTE_SIZE;
}

/**
 * Collect every spanId in the tree that has children (the collapsible nodes).
 * Used to implement "collapse all" / "expand all" without re-walking in the
 * component.
 */
export function collectParentSpanIds({
  roots,
}: {
  roots: ReadonlyArray<TraceTreeNode>;
}): string[] {
  const ids: string[] = [];
  const walk = (node: TraceTreeNode): void => {
    if (node.children.length > 0) ids.push(node.spanId);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return ids;
}
