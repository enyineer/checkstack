// Pure helper deriving the popout-dialog title from the editor language.
// Kept separate (and unit-tested) so the title logic isn't buried in UI glue.
import type { CodeEditorLanguage } from "./types";

// Human-readable display name for the languages that get a script-flavoured
// title. Markup/text languages fall through to the generic "Edit" title since
// "script" wouldn't read correctly for them.
const SCRIPT_LANGUAGE_LABELS: Partial<Record<CodeEditorLanguage, string>> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  shell: "Shell",
};

/**
 * Derive the overlay dialog title from the editor language.
 *
 * - Script languages (`typescript` / `javascript` / `shell`) read as
 *   `Edit script - <Language>`.
 * - Everything else (markup/text: json / yaml / xml / markdown) falls back to
 *   the generic `Edit`.
 *
 * Uses a normal hyphen (not an em-dash) per the project content style.
 */
export const popoutTitle = ({
  language,
}: {
  language: CodeEditorLanguage;
}): string => {
  const scriptLabel = SCRIPT_LANGUAGE_LABELS[language];
  return scriptLabel ? `Edit script - ${scriptLabel}` : "Edit";
};
