/**
 * Conservative safety analysis for USER-AUTHORED regex patterns that run
 * inside the shared ingest flush path (trace-extraction `bodyRegex`). JS has
 * no linear-time regex engine and no execution timeout, so a pathological
 * pattern would stall the ingest worker (default pool size 1) or, with
 * workers disabled, the whole pod - input-slicing does NOT bound backtracking
 * (catastrophic backtracking is exponential in match-attempt length).
 *
 * The analysis rejects the classic super-linear classes outright rather than
 * trying to time-box execution:
 *
 * 1. Backreferences (`\1`, `\k<name>`) - matching with backreferences is
 *    NP-hard in general.
 * 2. Any quantifier applied to a group that itself CONTAINS a quantifier or
 *    an alternation - the `(a+)+` / `(a|a)+` exponential families. This is
 *    deliberately conservative: it also rejects safe-but-ambiguous shapes
 *    like `(a|b)+`, which id-extraction patterns don't need (character
 *    classes cover them: `[ab]+`).
 * 3. More than {@link MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers
 *    (`*`, `+`, `{n,}`, or a bounded repetition wider than
 *    {@link BOUNDED_REPEAT_LIMIT}) - k ambiguous unbounded quantifiers give
 *    O(n^k) backtracking, and with the 4096-char body slice O(n^2) is the
 *    largest acceptable degree.
 *
 * The analyzer assumes the pattern already COMPILES (callers validate that
 * first); on any parse confusion it fails CLOSED with a reason.
 *
 * Pure module: no IO, browser-safe.
 */

/** Max unbounded quantifiers allowed in one pattern (worst case O(n^2)). */
export const MAX_UNBOUNDED_QUANTIFIERS = 2;
/** A bounded repetition `{n,m}` wider than this counts as unbounded. */
export const BOUNDED_REPEAT_LIMIT = 100;

export type RegexSafetyVerdict =
  | { safe: true }
  | { safe: false; reason: string };

interface GroupState {
  containsQuantifier: boolean;
  containsAlternation: boolean;
}

/**
 * Assess a regex SOURCE (no flags) for backtracking safety per the module
 * rules. Returns `{ safe: false, reason }` with an operator-readable reason on
 * rejection.
 */
export function assessRegexSafety({
  source,
}: {
  source: string;
}): RegexSafetyVerdict {
  const stack: GroupState[] = [];
  let unboundedCount = 0;
  /** Set when the previous atom was a group, so a following quantifier can be
   * checked against that group's contents. */
  let lastClosedGroup: GroupState | null = null;
  /** True right after a quantifier was consumed (allows the lazy `?` marker). */
  let afterQuantifier = false;
  let index = 0;

  const applyQuantifier = ({
    unbounded,
  }: {
    unbounded: boolean;
  }): RegexSafetyVerdict | null => {
    if (
      lastClosedGroup &&
      (lastClosedGroup.containsQuantifier ||
        lastClosedGroup.containsAlternation)
    ) {
      return {
        safe: false,
        reason:
          "a quantifier must not apply to a group containing a quantifier or alternation (catastrophic backtracking); use a character class instead, e.g. [0-9a-f]+",
      };
    }
    if (unbounded) {
      unboundedCount += 1;
      if (unboundedCount > MAX_UNBOUNDED_QUANTIFIERS) {
        return {
          safe: false,
          reason: `at most ${MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers (*, +, {n,} or repetitions wider than ${BOUNDED_REPEAT_LIMIT}) are allowed`,
        };
      }
    }
    for (const group of stack) group.containsQuantifier = true;
    lastClosedGroup = null;
    afterQuantifier = true;
    return null;
  };

  while (index < source.length) {
    const char = source[index];

    if (char === "\\") {
      const next = source[index + 1] ?? "";
      if (next >= "1" && next <= "9") {
        return {
          safe: false,
          reason: String.raw`backreferences (\1, \k<...>) are not allowed`,
        };
      }
      if (next === "k") {
        return {
          safe: false,
          reason: String.raw`backreferences (\1, \k<...>) are not allowed`,
        };
      }
      index += 2; // escaped atom
      lastClosedGroup = null;
      afterQuantifier = false;
      continue;
    }

    if (char === "[") {
      // Character class: consume to the unescaped closing bracket.
      index += 1;
      while (index < source.length && source[index] !== "]") {
        index += source[index] === "\\" ? 2 : 1;
      }
      if (index >= source.length) {
        return { safe: false, reason: "unterminated character class" };
      }
      index += 1; // the ']'
      lastClosedGroup = null;
      afterQuantifier = false;
      continue;
    }

    if (char === "(") {
      stack.push({ containsQuantifier: false, containsAlternation: false });
      index += 1;
      // Consume a group modifier so its '?' is not read as a quantifier:
      // (?: (?= (?! (?<= (?<! (?<name>
      if (source[index] === "?") {
        const modifier = source[index + 1];
        if (modifier === ":" || modifier === "=" || modifier === "!") {
          index += 2;
        } else if (modifier === "<") {
          const after = source[index + 2];
          if (after === "=" || after === "!") {
            index += 3;
          } else {
            const close = source.indexOf(">", index + 2);
            if (close === -1) {
              return { safe: false, reason: "unterminated named group" };
            }
            index = close + 1;
          }
        } else {
          return { safe: false, reason: "unrecognized group modifier" };
        }
      }
      lastClosedGroup = null;
      afterQuantifier = false;
      continue;
    }

    if (char === ")") {
      const closed = stack.pop();
      if (!closed) return { safe: false, reason: "unbalanced group" };
      const parent = stack.at(-1);
      if (parent) {
        parent.containsQuantifier ||= closed.containsQuantifier;
        parent.containsAlternation ||= closed.containsAlternation;
      }
      lastClosedGroup = closed;
      afterQuantifier = false;
      index += 1;
      continue;
    }

    if (char === "|") {
      const top = stack.at(-1);
      if (top) top.containsAlternation = true;
      // Top-level alternation cannot be quantified, so it needs no tracking.
      lastClosedGroup = null;
      afterQuantifier = false;
      index += 1;
      continue;
    }

    if (char === "*" || char === "+") {
      const verdict = applyQuantifier({ unbounded: true });
      if (verdict) return verdict;
      index += 1;
      continue;
    }

    if (char === "?") {
      if (afterQuantifier) {
        // Lazy marker (`+?`, `*?`, `{n,m}?`), not a quantifier of its own.
        afterQuantifier = false;
        index += 1;
        continue;
      }
      const verdict = applyQuantifier({ unbounded: false });
      if (verdict) return verdict;
      index += 1;
      continue;
    }

    if (char === "{") {
      const match = /^\{(\d+)(,(\d*)?)?\}/.exec(source.slice(index));
      if (match) {
        const hasComma = match[2] !== undefined;
        const upper = match[3];
        const unbounded =
          (hasComma && (upper === undefined || upper === "")) ||
          Number(upper ?? match[1]) > BOUNDED_REPEAT_LIMIT;
        const verdict = applyQuantifier({ unbounded });
        if (verdict) return verdict;
        index += match[0].length;
        continue;
      }
      // A `{` that is not a quantifier is a literal.
      index += 1;
      lastClosedGroup = null;
      afterQuantifier = false;
      continue;
    }

    // Any other literal atom.
    index += 1;
    lastClosedGroup = null;
    afterQuantifier = false;
  }

  if (stack.length > 0) return { safe: false, reason: "unbalanced group" };
  return { safe: true };
}
