/**
 * Path navigation utilities for the action tree.
 *
 * Action paths are serialized as strings like
 * `actions[1].choose[0].sequence[2]` and parsed back into structured
 * `ActionPath` arrays.
 */
import type { ActionPath } from "./types";

/**
 * Parse a path string emitted by `formatActionPath`.
 *
 *   "actions[1].choose[0].sequence[2]"
 *      → ["actions", 1, "choose", 0, "sequence", 2]
 */
export function parseActionPath(serialized: string): ActionPath {
  const segments: Array<string | number> = [];
  // Either a `word` (key segment) or `[42]` (index segment); the literal
  // `.` separators between them are intentionally ignored.
  const pattern = /([a-z_]+)|\[(\d+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(serialized)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1]);
    } else if (match[2] !== undefined) {
      segments.push(Number(match[2]));
    }
  }
  return segments;
}

/**
 * Detect whether a serialized path contains any container segment that
 * is forbidden for `wait_for_trigger` / `delay` in v1.
 *
 * Waits and delays are supported in the top-level `actions:` list and
 * inside any depth of nested `choose` branches. They are forbidden
 * inside `parallel` and `repeat` because suspension semantics for those
 * containers require branch-level coordination state which is deferred
 * to a follow-up. Validation throws at edit time and the runtime
 * rejects at execution time as a defence in depth.
 */
export function isSuspensionAllowedAtPath(path: ActionPath): boolean {
  for (const segment of path) {
    if (segment === "parallel" || segment === "repeat") return false;
  }
  return true;
}

/**
 * Pop one container worth of segments off the end of the path.
 *
 * Used to walk back out after finishing a nested sequence: the dispatch
 * engine knows the inner sequence is done, and asks the path util to
 * give it the container's own path so it can find a sibling at that
 * level.
 *
 *   ["actions", 1, "choose", 0, "sequence", 2]  →  ["actions", 1, "choose", 0]
 *   ["actions", 1, "choose", 0]                 →  ["actions", 1]
 */
export function popContainer(path: ActionPath): ActionPath {
  // Container segments come in pairs (key, index). We pop two at a time.
  if (path.length < 2) return path;
  return path.slice(0, -2);
}
