/**
 * Pure state model for the custom-pattern builder. A candidate pattern is
 * authored in the MASKED-token space: the chips ARE the tokens the Drain tree
 * matches against, so the template string a chip list produces is exactly what
 * `createPattern` / `testPattern` receive. Keeping this logic pure (no React,
 * no DOM) lets the builder dialog stay a thin rendering layer and lets the
 * round-trip be unit-tested in isolation.
 *
 * Masking itself is NEVER done here - the exact 12-rule masker lives in the
 * backend (`logstream-backend/src/drain/masking.ts`) and a raw pasted line is
 * masked server-side via `maskLine`. This module only manipulates an
 * already-masked template, so it cannot drift from the ingest matcher.
 */

/** The single wildcard token class (mirrors the backend masker's `WILDCARD`). */
export const WILDCARD = "<*>";

/**
 * One clickable token in the builder. `text` is the masked literal the token
 * carries; `isVariable` is whether it currently contributes a `<*>` to the
 * template. A token that came in ALREADY masked (`<*>`) is inherently variable
 * and cannot be turned into a literal (there is no literal to restore), so it is
 * not `toggleable`.
 */
export interface PatternChip {
  text: string;
  isVariable: boolean;
  toggleable: boolean;
}

/**
 * Split a masked template into chips. Whitespace is collapsed (the Drain tree
 * tokenizes on `\s+` and drops empties, so exact spacing never affects a match).
 * An empty / whitespace-only template yields no chips.
 */
export function templateToChips(template: string): PatternChip[] {
  return template
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) =>
      token === WILDCARD
        ? { text: WILDCARD, isVariable: true, toggleable: false }
        : { text: token, isVariable: false, toggleable: true },
    );
}

/** Render the chips back to a masked template string (single-space joined). */
export function chipsToTemplate(chips: PatternChip[]): string {
  return chips.map((chip) => (chip.isVariable ? WILDCARD : chip.text)).join(" ");
}

/**
 * Toggle the chip at `index` between literal and variable. An inherent wildcard
 * (`toggleable === false`) is returned unchanged; the array identity only
 * changes when a real toggle happens.
 */
export function toggleChip(
  chips: PatternChip[],
  index: number,
): PatternChip[] {
  const chip = chips[index];
  if (!chip || !chip.toggleable) return chips;
  return chips.map((current, i) =>
    i === index ? { ...current, isVariable: !current.isVariable } : current,
  );
}

/** How many chips currently contribute a LITERAL token to the template. */
export function literalTokenCount(chips: PatternChip[]): number {
  return chips.filter((chip) => !chip.isVariable).length;
}

/**
 * Whether the current chips form a saveable pattern. A pattern needs at least
 * one literal token: an all-wildcard template (`<*> <*> ...`) would match
 * essentially everything and is never what an operator means to author.
 */
export function canSavePattern(chips: PatternChip[]): boolean {
  return chips.length > 0 && literalTokenCount(chips) >= 1;
}
