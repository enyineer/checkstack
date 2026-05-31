export {
  CodeEditor,
  type CodeEditorProps,
  type CodeEditorLanguage,
  type TemplateProperty,
  type ShellEnvVar,
  type EditorMarker,
  type AcquireTypes,
  type AcquiredTypeFile,
} from "./CodeEditor";

export {
  generateTypeDefinitions,
  type GenerateTypesOptions,
} from "./generateTypeDefinitions";

export {
  customShellEnvVars,
  healthcheckScriptContext,
  integrationScriptContext,
  type ScriptEditorContext,
} from "./scriptContext";

// Pure helper used by consumers (e.g. script-packages-frontend) to derive the
// importable package-name list for the editor's import-specifier completions.
export { importablePackageNames } from "./importSpecifiers";
