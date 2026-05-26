import type { TemplateProperty, ShellEnvVar } from "../CodeEditor";
import type { EditorType } from "@checkstack/common";

// Re-export types used by multi-type editor
export type { EditorType } from "./utils";
// Re-export `ShellEnvVar` so DynamicForm consumers don't have to import
// from two paths. The canonical definition lives in `../CodeEditor`.
export type { ShellEnvVar } from "../CodeEditor";
import type {
  JsonSchemaPropertyCore,
  JsonSchemaBase,
} from "@checkstack/common";

/**
 * JSON Schema property with DynamicForm-specific x-* extensions for config rendering.
 * Uses the generic core type for proper recursive typing.
 */
export interface JsonSchemaProperty extends JsonSchemaPropertyCore<JsonSchemaProperty> {
  // Config-specific x-* extensions
  "x-secret"?: boolean; // Field contains sensitive data
  "x-color"?: boolean; // Field is a color picker
  "x-options-resolver"?: string; // Name of resolver function for dynamic options
  "x-depends-on"?: string[]; // Field names this field depends on (triggers refetch)
  "x-hidden"?: boolean; // Field should be hidden in form (auto-populated)
  "x-searchable"?: boolean; // Shows search input for filtering dropdown options
  "x-editor-types"?: EditorType[]; // Available editor types for multi-type input
  "x-hidden-when"?: Record<string, string[]>; // Conditionally hide based on sibling field values
}

/** Option returned by an options resolver */
export interface ResolverOption {
  value: string;
  label: string;
}

/** Function that resolves dynamic options, receives form values as context */
export type OptionsResolver = (
  formValues: Record<string, unknown>,
) => Promise<ResolverOption[]>;

/**
 * JSON Schema for config forms with DynamicForm-specific extensions.
 */
export type JsonSchema = JsonSchemaBase<JsonSchemaProperty>;

/**
 * Default starter templates per editor language. Used to populate empty
 * multi-type editor fields so users see a working example instead of a
 * blank canvas. Keyed by `EditorType` (e.g. "typescript", "shell").
 */
export type EditorStarterTemplates = Partial<Record<EditorType, string>>;

export interface DynamicFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /**
   * Optional callback when form validity changes.
   * Reports true if all required fields are filled.
   */
  onValidChange?: (isValid: boolean) => void;
  /**
   * Optional map of resolver names to functions that fetch dynamic options.
   * Referenced by x-options-resolver in schema properties.
   */
  optionsResolvers?: Record<string, OptionsResolver>;
  /**
   * Optional list of available template properties for multi-type editor fields.
   * When provided, fields with x-editor-types get {{ autocomplete suggestions.
   */
  templateProperties?: TemplateProperty[];
  /**
   * Optional TypeScript declarations to inject into Monaco for `typescript`
   * or `javascript` editor-type fields. Typically built from a schema via
   * `generateTypeDefinitions()` so users get autocomplete + type errors
   * against the runtime context they'll see.
   */
  typeDefinitions?: string;
  /**
   * Optional list of environment-variable names that are available to
   * `shell` editor-type fields. When provided, Monaco autocompletes them
   * after `$` and `${`. Use this to surface platform-injected vars like
   * `EVENT_ID`, `PAYLOAD_*` etc. so users don't have to remember the names.
   */
  shellEnvVars?: ShellEnvVar[];
  /**
   * Optional initial content per editor language, used to populate empty
   * fields with a working example. Keyed by `EditorType`.
   */
  starterTemplates?: EditorStarterTemplates;
}

/** Props for the FormField component */
export interface FormFieldProps {
  id: string;
  label: string;
  propSchema: JsonSchemaProperty;
  value: unknown;
  isRequired?: boolean;
  formValues: Record<string, unknown>;
  optionsResolvers?: Record<string, OptionsResolver>;
  templateProperties?: TemplateProperty[];
  typeDefinitions?: string;
  shellEnvVars?: ShellEnvVar[];
  starterTemplates?: EditorStarterTemplates;
  /** Callback when value changes. Omit val to clear the field. */
  onChange: (val?: unknown) => void;
}


/** Props for the DynamicOptionsField component */
export interface DynamicOptionsFieldProps {
  id: string;
  label: string;
  description?: string;
  value: unknown;
  isRequired?: boolean;
  resolverName: string;
  dependsOn?: string[];
  searchable?: boolean;
  formValues: Record<string, unknown>;
  optionsResolvers: Record<string, OptionsResolver>;
  /** Callback when value changes. Omit val to clear the field. */
  onChange: (val?: unknown) => void;
}

/** Props for the JsonField component */
export interface JsonFieldProps {
  id: string;
  value: Record<string, unknown>;
  propSchema: JsonSchemaProperty;
  onChange: (val: Record<string, unknown>) => void;
}
