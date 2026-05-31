// Main component
export { DynamicForm } from "./DynamicForm";

// Sub-components for advanced usage
export { MultiTypeEditorField } from "./MultiTypeEditorField";
export { KeyValueEditor, type KeyValuePair } from "./KeyValueEditor";
export {
  SecretEnvEditor,
  type SecretEnvEditorProps,
} from "./SecretEnvEditor";

// Types for external consumers
export type {
  JsonSchema,
  JsonSchemaProperty,
  DynamicFormProps,
  OptionsResolver,
  ResolverOption,
  EditorType,
  ShellEnvVar,
  EditorStarterTemplates,
  ScriptTestRenderer,
} from "./types";

// Utility functions
export {
  serializeFormData,
  parseFormData,
  detectEditorType,
  EDITOR_TYPE_LABELS,
  findSecretEnvSibling,
} from "./utils";
