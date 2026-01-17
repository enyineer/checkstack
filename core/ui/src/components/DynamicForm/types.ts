import type { TemplateProperty } from "../TemplateEditor";
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
   * Optional list of available template properties for template fields.
   * Passed to TemplateEditor for autocompletion hints.
   */
  templateProperties?: TemplateProperty[];
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
