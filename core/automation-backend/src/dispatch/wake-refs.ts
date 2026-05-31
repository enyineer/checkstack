/**
 * Wake-index reference extraction (reactive automation engine §8.3).
 *
 * A reactive `wait_until` no longer polls — at suspend time we statically
 * extract the `state.*` entity refs its condition reads and insert one
 * wake-index row per ref (§8.1). A relevant `ENTITY_CHANGED` then wakes the
 * wait and re-evaluates the full condition synchronously.
 *
 * This module is the static-analysis half: given a {@link Condition}, return
 * the set of dependency refs the condition depends on. Each ref is one of:
 *
 *   - A concrete entity ref `{ kind, id }` → wake-index ref `${kind}:${id}`.
 *   - A kind-level WILDCARD `{ kind, id: "*" }` → wake-index ref `${kind}:*`,
 *     emitted when the walker can see the kind but not a concrete id (a
 *     dynamic/computed id). The wait then wakes on ANY change of that kind
 *     and re-evaluates — a few extra wakes, never a silent stall (§12).
 *
 * When extraction is wholly indeterminate (not even a kind), the result is
 * `{ refs: [], indeterminate: true }` so the caller can fall back to the
 * durable timeout timer only and log at `warn` (§8.3) — never silent.
 *
 * Grammar coverage:
 *   - Structured `state` conditions → `health:<entity>` (the current health
 *     entity's kind is `health`; `evaluateStateCondition` reads
 *     `health.systems[entity]`).
 *   - Structured `numeric_state` conditions whose `value` is a path/template
 *     into `state.<kind>.<id>.<field>` (or the rich `health.*` snapshot).
 *   - Template-string conditions: every member-expression rooted at
 *     `state.<kind>.<id>` or `health.systems[<id>]` / `health.system`.
 *   - `and` / `or` / `not` combinators recurse into their operands.
 */
import {
  parseCondition,
  type Expr,
} from "@checkstack/template-engine";
import type { Condition } from "@checkstack/automation-common";

/** The entity kind the rich `health.*` scope snapshot maps to. */
export const HEALTH_ENTITY_KIND = "health";

/** A single extracted dependency. `id === "*"` is the kind-level wildcard. */
export interface WakeRef {
  kind: string;
  /** Concrete entity id, or `"*"` for the kind-level wildcard. */
  id: string;
}

export interface ExtractedRefs {
  /** De-duplicated refs the condition depends on. */
  refs: ReadonlyArray<WakeRef>;
  /**
   * True when the walker could not derive ANY ref (not even a kind) from a
   * condition that nonetheless references live state — the caller falls back
   * to the timeout timer only and logs a warning.
   */
  indeterminate: boolean;
}

/** Serialize a {@link WakeRef} to its wake-index `ref` column value. */
export function refToString(ref: WakeRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Read the operand array of an `and` / `or` combinator, or undefined when
 * `condition` is not that combinator. Avoids a type-predicate over the
 * `Condition` union (which includes `string`).
 */
function combinatorOperands(
  condition: Exclude<Condition, string>,
  key: "and" | "or",
): ReadonlyArray<Condition> | undefined {
  const value = (condition as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as ReadonlyArray<Condition>) : undefined;
}

/**
 * Extract the wake-index dependency refs for a wait condition.
 *
 * The result is de-duplicated. `indeterminate` is set only when the
 * condition clearly reads state (a template / structured variant) but no
 * ref — concrete or wildcard — could be derived.
 */
export function extractWakeRefs(condition: Condition): ExtractedRefs {
  const collector = new RefCollector();
  collector.visitCondition(condition);
  return collector.result();
}

class RefCollector {
  private readonly seen = new Set<string>();
  private readonly refs: WakeRef[] = [];
  /** Set when at least one state-reading shape was encountered. */
  private touchedState = false;

  result(): ExtractedRefs {
    return {
      refs: this.refs,
      // Only surface indeterminate when state was read but nothing resolved
      // to a concrete-or-wildcard ref — the caller then relies on the
      // timeout timer alone and logs a warning.
      indeterminate: this.touchedState && this.refs.length === 0,
    };
  }

  private add(ref: WakeRef): void {
    this.touchedState = true;
    const key = refToString(ref);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.refs.push(ref);
  }

  /**
   * Note that we saw a state-reading shape we couldn't resolve to a ref.
   * `result()` reports `indeterminate` only if NO ref was recorded overall.
   */
  private markIndeterminate(): void {
    this.touchedState = true;
  }

  visitCondition(condition: Condition): void {
    if (typeof condition === "string") {
      this.visitTemplate(condition);
      return;
    }
    const andOps = combinatorOperands(condition, "and");
    if (andOps) {
      for (const c of andOps) this.visitCondition(c);
      return;
    }
    const orOps = combinatorOperands(condition, "or");
    if (orOps) {
      for (const c of orOps) this.visitCondition(c);
      return;
    }
    if ("not" in condition) {
      this.visitCondition(condition.not);
      return;
    }
    if ("state" in condition) {
      this.touchedState = true;
      // The structured `state` condition reads `health.systems[entity]`.
      const entity = condition.state.entity;
      if (typeof entity === "string" && entity.length > 0) {
        this.add({ kind: HEALTH_ENTITY_KIND, id: entity });
      } else {
        this.markIndeterminate();
      }
      return;
    }
    if ("numeric_state" in condition) {
      this.touchedState = true;
      const value = condition.numeric_state.value;
      if (typeof value === "string") {
        // A path/template string into state.<kind>.<id>.<field> or health.*.
        this.visitTemplate(value);
      }
      // A literal number references no entity — nothing to extract.
      return;
    }
    if ("time" in condition) {
      // `time` reads no entity state.
      return;
    }
  }

  /**
   * Parse a template/path string and walk its member-expression chains for
   * `state.<kind>.<id>` and rich `health.*` snapshot roots.
   */
  private visitTemplate(source: string): void {
    let root: Expr;
    try {
      root = parseCondition(source).root;
    } catch {
      // Unparseable — treat as a state read we can't resolve (so the caller
      // wildcards / falls back rather than silently never waking).
      this.touchedState = true;
      this.markIndeterminate();
      return;
    }
    this.visitExpr(root);
  }

  private visitExpr(expr: Expr): void {
    switch (expr.kind) {
      case "member":
      case "index": {
        // Resolve the access chain rooted at this node; if it begins at a
        // state/health root, record the ref and stop descending into the
        // path segments (they're field accesses, not new roots).
        const matched = this.tryRecordChain(expr);
        if (matched) return;
        // Not a state chain — descend into the object (and the index, which
        // may itself contain a state ref) so nested expressions are covered.
        if (expr.kind === "member") {
          this.visitExpr(expr.object);
        } else {
          this.visitExpr(expr.object);
          this.visitExpr(expr.index);
        }
        return;
      }
      case "binary": {
        this.visitExpr(expr.left);
        this.visitExpr(expr.right);
        return;
      }
      case "unary": {
        this.visitExpr(expr.operand);
        return;
      }
      case "ternary": {
        this.visitExpr(expr.condition);
        this.visitExpr(expr.consequent);
        this.visitExpr(expr.alternate);
        return;
      }
      case "pipe": {
        this.visitExpr(expr.value);
        for (const a of expr.args) this.visitExpr(a);
        return;
      }
      case "identifier":
      case "literal": {
        return;
      }
    }
  }

  /**
   * If `expr` is an access chain rooted at a recognised state/health root,
   * record the corresponding ref and return true. Otherwise return false.
   *
   * Recognised roots:
   *   - `state.<kind>.<id>[…]`              → { kind, id }
   *   - `state.<kind>[<dynamic>][…]`        → { kind, "*" } (wildcard)
   *   - `health.systems.<id>[…]`            → { health, id }
   *   - `health.systems[<dynamic>][…]`      → { health, "*" }
   *   - `health.system[…]`                  → { health, "*" } (the implicit
   *                                            context system — unknown id)
   */
  private tryRecordChain(expr: Expr): boolean {
    const chain = flattenChain(expr);
    if (!chain) return false;
    const head = chain.root;
    const rest = chain.segments;

    if (head === "state") {
      this.touchedState = true;
      const kindSeg = rest[0];
      if (kindSeg === undefined || kindSeg.dynamic) {
        // `state[<dynamic>]` — kind itself unknown.
        this.markIndeterminate();
        return true;
      }
      const kind = kindSeg.name;
      const idSeg = rest[1];
      if (idSeg === undefined) {
        // `state.<kind>` with no id — wildcard the whole kind.
        this.add({ kind, id: "*" });
        return true;
      }
      this.add({ kind, id: idSeg.dynamic ? "*" : idSeg.name });
      return true;
    }

    if (head === "health") {
      this.touchedState = true;
      const next = rest[0];
      if (next === undefined) {
        this.markIndeterminate();
        return true;
      }
      if (!next.dynamic && next.name === "systems") {
        const idSeg = rest[1];
        if (idSeg === undefined) {
          // `health.systems` with no id — wildcard.
          this.add({ kind: HEALTH_ENTITY_KIND, id: "*" });
          return true;
        }
        this.add({
          kind: HEALTH_ENTITY_KIND,
          id: idSeg.dynamic ? "*" : idSeg.name,
        });
        return true;
      }
      if (!next.dynamic && next.name === "system") {
        // The implicit context system — its concrete id isn't in the path.
        this.add({ kind: HEALTH_ENTITY_KIND, id: "*" });
        return true;
      }
      // `health.<other>` — unknown shape; wildcard health to stay safe.
      this.add({ kind: HEALTH_ENTITY_KIND, id: "*" });
      return true;
    }

    return false;
  }
}

/** A single segment of a flattened access chain. */
interface ChainSegment {
  /** The property/index name, when statically known. */
  name: string;
  /** True when the segment is a non-literal index (a computed key). */
  dynamic: boolean;
}

/** A member/index chain flattened to a root identifier + ordered segments. */
interface FlattenedChain {
  /** Root identifier name (e.g. `state`, `health`). */
  root: string;
  /** Member/index segments after the root, in source order. */
  segments: ChainSegment[];
}

/**
 * Flatten a member/index access chain into `{ root, segments }`.
 * Returns undefined when the chain isn't rooted at a plain identifier
 * (e.g. `(a ? b : c).x`) — such expressions are visited structurally
 * instead.
 */
function flattenChain(expr: Expr): FlattenedChain | undefined {
  const segments: ChainSegment[] = [];
  let node: Expr = expr;
  // Walk from the outermost access inward, prepending as we go.
  while (node.kind === "member" || node.kind === "index") {
    if (node.kind === "member") {
      segments.unshift({ name: node.property, dynamic: false });
      node = node.object;
    } else {
      const idx = node.index;
      if (idx.kind === "literal" && typeof idx.value === "string") {
        segments.unshift({ name: idx.value, dynamic: false });
      } else if (idx.kind === "literal" && typeof idx.value === "number") {
        segments.unshift({ name: String(idx.value), dynamic: false });
      } else {
        // A computed key — id (or kind) is dynamic.
        segments.unshift({ name: "", dynamic: true });
      }
      node = node.object;
    }
  }
  if (node.kind !== "identifier") return undefined;
  return { root: node.name, segments };
}
