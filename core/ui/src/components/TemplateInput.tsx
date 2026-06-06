import React from "react";
// Deep package specifier (not "./CodeEditor"): routes the CodeEditor value
// through the Module Federation shared singleton (see core/ui/src/index.ts).
import {
  CodeEditor,
  type TemplateProperty,
} from "@checkstack/ui/code-editor";
import { TemplateValueInput } from "./TemplateValueInput";

/**
 * Edit mode for a `TemplateInput`. Drives both the rendered widget and
 * the language passed to the underlying Monaco editor in code modes.
 *
 *  - `text` — single-line `<Input>` with `{{` autocomplete
 *    (`TemplateValueInput`). Cheapest, no Monaco bundle.
 *  - `code` — full Monaco TypeScript editor. Use for inline scripts.
 *  - `bash` — Monaco shell editor with optional `shellEnvVars`.
 *  - `json` / `yaml` — Monaco editor in the matching language. Use for
 *    structured config bodies that may interpolate `{{ }}`.
 */
export type TemplateInputMode = "text" | "code" | "bash" | "json" | "yaml";

export interface TemplateInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  mode?: TemplateInputMode;
  placeholder?: string;
  /**
   * Template properties surfaced after the user types `{{`. Required for
   * the picker to do anything; omit to disable autocomplete entirely.
   */
  templateProperties?: TemplateProperty[];
  /** Optional TS declarations injected into Monaco (code mode only). */
  typeDefinitions?: string;
  /** Optional shell env-var hints (bash mode only). */
  shellEnvVars?: Array<{ name: string; description?: string; example?: string }>;
  /** Min height for code-mode editors. */
  minHeight?: string;
  /** Forwarded to the input/editor. */
  disabled?: boolean;
  className?: string;
}

/**
 * High-level template editor. Picks the right underlying widget for the
 * given `mode` and forwards the standard template-property + type-decl
 * props through to it.
 *
 *  - `mode === "text"` (the default) renders a single-line
 *    `TemplateValueInput` — the same picker the key/value editor uses.
 *  - Any code mode delegates to `CodeEditor`, which already runs the
 *    same `{{` autocomplete inside Monaco plus the shell `$` env-var
 *    completion provider.
 *
 * Wrapping both in one component lets the automation editor render a
 * single field that switches editor flavour as the user changes the
 * action's `x-editor-types` annotation, without each action having to
 * choose its own widget.
 */
export const TemplateInput: React.FC<TemplateInputProps> = ({
  id,
  value,
  onChange,
  mode = "text",
  placeholder,
  templateProperties,
  typeDefinitions,
  shellEnvVars,
  minHeight,
  disabled,
  className,
}) => {
  if (mode === "text") {
    return (
      <TemplateValueInput
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        templateProperties={templateProperties}
        disabled={disabled}
        className={className}
      />
    );
  }

  const language =
    mode === "code"
      ? "typescript"
      : mode === "bash"
        ? "shell"
        : mode;

  return (
    <CodeEditor
      id={id}
      value={value}
      onChange={onChange}
      language={language}
      templateProperties={templateProperties}
      typeDefinitions={typeDefinitions}
      shellEnvVars={shellEnvVars}
      minHeight={minHeight}
      placeholder={placeholder}
      readOnly={disabled}
    />
  );
};
