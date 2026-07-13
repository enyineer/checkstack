/**
 * Pure, IO-free matcher for USER-authored patterns. This is the single source of
 * truth for "does this masked line match this template?" shared by two callers
 * that MUST never drift apart:
 *
 * - The Drain core, which installs user templates as protected clusters and
 *   matches incoming lines against them (with precedence over mining).
 * - The API's `testPattern` handler (Phase C3), which previews a candidate
 *   template against recent raw lines before the user saves it.
 *
 * Both classification and preview therefore agree by construction. A user
 * template matches a line iff their token counts are equal AND every
 * non-wildcard template token is exactly equal to the line's token at that
 * position - `<*>` positions match anything. There is NO similarity scoring and
 * NO template refinement: a non-matching line is simply not this pattern's.
 */

import { WILDCARD } from "./masking";

/**
 * Split a stored, space-joined template into its token sequence. The inverse of
 * `tokens.join(" ")`; an empty template is zero tokens (not `[""]`).
 */
export function templateToTokens(template: string): string[] {
  return template.length === 0 ? [] : template.split(" ");
}

/**
 * Exact-match-with-wildcards predicate. `templateTokens` is a user pattern in the
 * masked-token space (with `<*>` at the varying positions); `lineTokens` is a
 * line already run through the SAME masking. Returns true iff the two have equal
 * length and every non-`<*>` template token equals the line token at its index.
 */
export function matchesTemplate({
  templateTokens,
  lineTokens,
}: {
  templateTokens: readonly string[];
  lineTokens: readonly string[];
}): boolean {
  if (templateTokens.length !== lineTokens.length) return false;
  for (const [i, token] of templateTokens.entries()) {
    if (token === WILDCARD) continue;
    if (token !== lineTokens[i]) return false;
  }
  return true;
}
