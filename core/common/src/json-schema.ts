/**
 * Generic base JSON Schema property type.
 * Uses a generic Self parameter for recursive properties to allow proper extension.
 */
export interface JsonSchemaPropertyCore<
  Self = JsonSchemaPropertyCore<unknown>
> {
  type?: string;
  description?: string;
  enum?: string[];
  const?: string | number | boolean;
  properties?: Record<string, Self>;
  items?: Self;
  required?: string[];
  additionalProperties?: boolean | Self;
  format?: string;
  default?: unknown;
  oneOf?: Self[];
  anyOf?: Self[];
}

/**
 * Concrete base JSON Schema property type without extensions.
 */
export type JsonSchemaPropertyBase =
  JsonSchemaPropertyCore<JsonSchemaPropertyBase>;

/**
 * Base JSON Schema type for object schemas.
 */
export interface JsonSchemaBase<TProp = JsonSchemaPropertyBase> {
  type?: string;
  properties?: Record<string, TProp>;
  required?: string[];
}
