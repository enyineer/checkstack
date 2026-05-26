// Main component
export { DynamicForm } from "./DynamicForm";

// Sub-components for advanced usage
export { MultiTypeEditorField } from "./MultiTypeEditorField";
export { KeyValueEditor, type KeyValuePair } from "./KeyValueEditor";

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
} from "./types";

// Utility functions
export {
  serializeFormData,
  parseFormData,
  detectEditorType,
  EDITOR_TYPE_LABELS,
} from "./utils";
