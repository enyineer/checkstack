// Public `CodeEditor` component. Adapts the stable `CodeEditorProps` API to the
// `@typefox/monaco-editor-react`-backed `TypefoxEditor` (real VS Code language
// services in the browser). Consumers (DynamicForm, automation, healthcheck)
// import this and are unaffected by the underlying editor implementation.
import { TypefoxEditor } from "./TypefoxEditor";
import type { CodeEditorProps } from "./types";

/**
 * Code editor with context-aware IntelliSense, template / shell completion, and
 * structural validation. See `CodeEditorProps`.
 */
export const CodeEditor = ({
  id,
  value,
  onChange,
  language = "typescript",
  minHeight = "100px",
  readOnly,
  placeholder,
  typeDefinitions,
  templateProperties,
  shellEnvVars,
  markers,
}: CodeEditorProps) => {
  // CodeEditorProps.minHeight is a CSS length string ("240px"); TypefoxEditor
  // takes a pixel number.
  const minHeightPx = Number.parseInt(minHeight, 10) || 100;

  return (
    <TypefoxEditor
      id={id ?? "code-editor"}
      value={value}
      onChange={onChange}
      language={language}
      minHeight={minHeightPx}
      readOnly={readOnly}
      placeholder={placeholder}
      typeDefinitions={typeDefinitions}
      templateProperties={templateProperties}
      shellEnvVars={shellEnvVars}
      markers={markers}
    />
  );
};

export type {
  CodeEditorProps,
  CodeEditorLanguage,
  TemplateProperty,
  ShellEnvVar,
  EditorMarker,
} from "./types";

export {
  generateTypeDefinitions,
  type GenerateTypesOptions,
} from "./generateTypeDefinitions";

export {
  healthcheckScriptContext,
  integrationScriptContext,
  type ScriptEditorContext,
} from "./scriptContext";
