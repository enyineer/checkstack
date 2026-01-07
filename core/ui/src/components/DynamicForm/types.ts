import type { TemplateProperty } from "../TemplateEditor";

export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  const?: string | number | boolean; // For discriminator values
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaProperty;
  format?: string;
  default?: unknown;
  oneOf?: JsonSchemaProperty[]; // Discriminated union variants
  anyOf?: JsonSchemaProperty[]; // Union variants
  "x-secret"?: boolean; // Custom metadata for secret fields
  "x-color"?: boolean; // Custom metadata for color fields
  "x-options-resolver"?: string; // Name of a resolver function for dynamic options
  "x-depends-on"?: string[]; // Field names this field depends on (triggers refetch when they change)
  "x-hidden"?: boolean; // Field should be hidden in form (auto-populated)
  "x-searchable"?: boolean; // Shows a search input for filtering dropdown options
}

/** Option returned by an options resolver */
export interface ResolverOption {
  value: string;
  label: string;
}

/** Function that resolves dynamic options, receives form values as context */
export type OptionsResolver = (
  formValues: Record<string, unknown>
) => Promise<ResolverOption[]>;

export interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface DynamicFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
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
  onChange: (val: unknown) => void;
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
  onChange: (val: unknown) => void;
}

/** Props for the JsonField component */
export interface JsonFieldProps {
  id: string;
  value: Record<string, unknown>;
  propSchema: JsonSchemaProperty;
  onChange: (val: Record<string, unknown>) => void;
}
