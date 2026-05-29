// Shared, pure type definitions for the CodeEditor public API.
//
// NOTE: this file MUST stay free of monaco / @codingame / vite imports so that
// SSR/test/node paths can reference these types (and the package barrel can
// re-export them) without pulling in the browser-only editor stack.

export type CodeEditorLanguage =
  | "json"
  | "yaml"
  | "xml"
  | "markdown"
  | "javascript"
  | "typescript"
  | "shell";

/**
 * A single payload property available for templating. Used by both the
 * Monaco-backed `CodeEditor` and the lightweight single-line
 * `TemplateValueInput` for the simple "insert a `{{ path }}` reference" flow.
 */
export interface TemplateProperty {
  /** Full canonical path to the property, e.g., "trigger.payload.title". */
  path: string;
  /**
   * Runtime-parseable `{{ }}` insertion text, e.g.
   * `artifacts["integration-jira.issue"].issueKey`. When present this is
   * what gets inserted; consumers fall back to `path` when it's absent.
   */
  templateRef?: string;
  /** Type label rendered on the right, e.g. "string", "number". */
  type: string;
  /** Optional description of the property. */
  description?: string;
  /**
   * Known discrete values for this field, when the schema declares an `enum`.
   * Consumed by the template-completion provider to suggest concrete values
   * after a comparator (e.g. `"low"` / `"high"` for a severity field).
   */
  enumValues?: Array<string | number | boolean>;
}

/**
 * A single environment variable available to shell scripts. Surfaced as a
 * completion item after the user types `$` or `${` in shell mode.
 */
export interface ShellEnvVar {
  /** Variable name without the leading `$`, e.g. `EVENT_ID`. */
  name: string;
  /** Optional description shown in the completion popup. */
  description?: string;
  /** Optional example value shown in the completion item detail. */
  example?: string;
}

/**
 * An externally-supplied diagnostic to render as an inline squiggle. Positions
 * are 1-based line/column (the editor's convention). Callers compute these from
 * their own validation (e.g. mapping a definition issue path back to a YAML
 * node range) and pass them via `markers`.
 */
export interface EditorMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity?: "error" | "warning" | "info";
}

export interface CodeEditorProps {
  /** Unique identifier for the editor. */
  id?: string;
  /** Current value of the editor. */
  value: string;
  /** Callback when the value changes. */
  onChange: (value: string) => void;
  /** Language for syntax highlighting. */
  language?: CodeEditorLanguage;
  /** Minimum height of the editor, as a CSS length (e.g. "240px"). */
  minHeight?: string;
  /** Whether the editor is read-only. */
  readOnly?: boolean;
  /** Placeholder text when empty. */
  placeholder?: string;
  /**
   * TypeScript type definitions to inject for IntelliSense (the `context.d.ts`).
   * Generated from JSON schemas for context-aware autocomplete. For
   * `typescript` / `javascript` editors, non-identifier object keys in these
   * definitions (e.g. artifact ids) are offered as `["key"]` bracket
   * completions automatically.
   */
  typeDefinitions?: string;
  /**
   * Optional template properties for autocomplete. When provided, typing "{{"
   * triggers autocomplete with the available template variables.
   */
  templateProperties?: TemplateProperty[];
  /**
   * Optional environment-variable hints for shell mode. When provided and
   * `language === "shell"`, they autocomplete after `$` and `${`.
   */
  shellEnvVars?: ShellEnvVar[];
  /**
   * Externally-computed diagnostics rendered as inline squiggles (under a
   * dedicated marker owner, so they coexist with the editor's own language
   * diagnostics).
   */
  markers?: EditorMarker[];
}
