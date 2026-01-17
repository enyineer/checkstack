import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";

export type CodeEditorLanguage = "json";

export interface CodeEditorProps {
  /** Unique identifier for the editor */
  id?: string;
  /** Current value of the editor */
  value: string;
  /** Callback when the value changes */
  onChange: (value: string) => void;
  /** Language for syntax highlighting */
  language?: CodeEditorLanguage;
  /** Minimum height of the editor */
  minHeight?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Placeholder text when empty */
  placeholder?: string;
}

const languageExtensions = {
  json: json(),
};

/**
 * A code editor component with syntax highlighting.
 * Wraps @uiw/react-codemirror for consistent styling and API across the platform.
 */
export const CodeEditor: React.FC<CodeEditorProps> = ({
  id,
  value,
  onChange,
  language = "json",
  minHeight = "100px",
  readOnly = false,
  placeholder,
}) => {
  const extensions = React.useMemo(() => {
    const exts = [
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "14px",
          fontFamily: "ui-monospace, monospace",
        },
        ".cm-content": {
          padding: "10px",
        },
        ".cm-gutters": {
          display: "none",
        },
        "&.cm-focused": {
          outline: "none",
        },
      }),
    ];

    const langExt = languageExtensions[language];
    if (langExt) {
      exts.push(langExt);
    }

    return exts;
  }, [language]);

  return (
    <div
      id={id}
      className="w-full rounded-md border border-input bg-background font-mono text-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all overflow-hidden box-border"
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        editable={!readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightSelectionMatches: false,
          autocompletion: false,
        }}
        style={{
          minHeight,
        }}
      />
    </div>
  );
};
