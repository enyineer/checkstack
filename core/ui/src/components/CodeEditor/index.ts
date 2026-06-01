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

// Headless script validator: type-check scripts against their generated
// `context` types without a mounted editor (drives the same standalone TS
// worker). Used by the automation editor to surface type errors on collapsed
// script-action cards.
export {
  validateTypeScriptSources,
  type ScriptValidationInput,
  type ScriptDiagnostic,
} from "./validateScripts";

// Subscribe to / query the monaco-vscode "services ready" transition so a
// consumer (the automation editor's script validator + its hidden services
// booter) can react the moment the first editor initializes the services.
// Sourced from the Monaco-free signal module so this barrel re-export does NOT
// drag the `@codingame/*` stack onto pages that never mount an editor.
export {
  onVscodeServicesReady,
  areVscodeServicesReady,
} from "./vscodeServicesSignal";
