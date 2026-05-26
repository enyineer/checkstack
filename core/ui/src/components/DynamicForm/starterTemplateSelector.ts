import type { EditorStarterTemplates, EditorType } from "./types";

/**
 * Pure decision function powering the "seed empty editor with a starter
 * template" behaviour in `MultiTypeEditorField`. Returns the starter
 * content to install, or `undefined` if the field shouldn't be touched.
 *
 * Used both on first mount and when the user switches editor language on
 * a still-empty field, so a single source of truth governs both paths
 * (and a single test suite covers them).
 *
 * Returns `undefined` when:
 *  - the field already has non-whitespace content (don't clobber user input)
 *  - no `starterTemplates` were provided
 *  - no starter exists for the currently-selected language
 *  - the matching starter is the empty string
 */
export function pickStarterForEmptyField({
  value,
  selectedType,
  starterTemplates,
}: {
  value: string | undefined;
  selectedType: EditorType;
  starterTemplates?: EditorStarterTemplates;
}): string | undefined {
  const trimmed = (value ?? "").trim();
  if (trimmed.length > 0) return undefined;
  const starter = starterTemplates?.[selectedType];
  if (!starter || starter.length === 0) return undefined;
  return starter;
}
