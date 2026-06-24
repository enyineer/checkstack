import type { TemplateProperty } from "@checkstack/ui/code-editor";

/**
 * Pure logic for the raw editor's `{{ }}` template autocomplete. Kept free of
 * React / Monaco imports so it is unit-testable (the `.tsx` pulls in the heavy
 * CodeEditor).
 */

/**
 * Detect whether the cursor sits inside an unclosed `{{ … }}` span and, if so,
 * return the query text typed after the `{{` and the span's start offset.
 *
 * `query` includes any leading space the author typed (`{{ artifacts…`), so
 * consumers must trim before matching — see {@link filterTemplatePropertiesByQuery}.
 */
export function detectRawTemplateContext(
  text: string,
  cursorPos: number,
): { isInTemplate: boolean; query: string; startPos: number } {
  const textBefore = text.slice(0, cursorPos);
  const lastOpenBrace = textBefore.lastIndexOf("{{");
  const lastCloseBrace = textBefore.lastIndexOf("}}");

  if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
    const query = textBefore.slice(lastOpenBrace + 2);
    if (!query.includes("\n")) {
      return { isInTemplate: true, query, startPos: lastOpenBrace };
    }
  }
  return { isInTemplate: false, query: "", startPos: -1 };
}

/**
 * Filter `{{ }}` autocomplete properties by the user's in-template query.
 *
 * The query is the text between `{{` and the cursor, so it carries the leading
 * space authors type (and the editor renders) in `{{ artifacts.x }}`. That
 * space MUST be trimmed before matching — otherwise `" arti"` never matches
 * `artifacts.…` and the popup goes empty the moment a letter is typed after
 * `{{ ` (the bug that hid upstream artifacts in a nested action's config). An
 * empty/whitespace-only query returns every property (the initial open).
 */
export function filterTemplatePropertiesByQuery(
  properties: TemplateProperty[],
  query: string,
): TemplateProperty[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return properties;
  return properties.filter(
    (prop) =>
      prop.path.toLowerCase().includes(normalized) ||
      (prop.templateRef?.toLowerCase().includes(normalized) ?? false),
  );
}

/**
 * Split a dotted template label into a `prefix` (the shared, contextual head,
 * including the trailing dot) and a `leaf` (the final segment).
 *
 * Autocomplete rows for deep paths like `artifacts.triage.analysis.summary`
 * share a long prefix, so end-truncation hides the only distinguishing part —
 * the leaf. Rendering the leaf separately (never truncated) while the prefix
 * absorbs the ellipsis keeps every row distinguishable. Bracket segments
 * (`artifacts["a.b"].x`) split on the last top-level dot, not one inside `[]`.
 */
export function splitTemplateLabel(label: string): {
  prefix: string;
  leaf: string;
} {
  // Find the last dot that is NOT inside square brackets, so a quoted
  // bracket key containing a dot doesn't get mis-split.
  let depth = 0;
  let splitAt = -1;
  for (const [i, ch] of [...label].entries()) {
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "." && depth === 0) splitAt = i;
  }
  if (splitAt === -1) return { prefix: "", leaf: label };
  return { prefix: label.slice(0, splitAt + 1), leaf: label.slice(splitAt + 1) };
}
