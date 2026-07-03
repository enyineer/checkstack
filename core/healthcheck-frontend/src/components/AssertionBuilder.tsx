import React, { useMemo } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
} from "@checkstack/ui";
import type {
  JsonSchemaBase,
  JsonSchemaPropertyBase,
} from "@checkstack/common";
import { Plus, Trash2 } from "lucide-react";
import { OPERATOR_LABELS } from "./assertion-display.logic";

// ============================================================================
// TYPES
// ============================================================================

// Use base types for assertion building - works with any JSON Schema
type JsonSchema = JsonSchemaBase<JsonSchemaPropertyBase>;
type JsonSchemaProperty = JsonSchemaPropertyBase;

type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "array"
  | "jsonpath";

export interface AssertableField {
  path: string;
  displayName: string;
  type: FieldType;
  enumValues?: unknown[];
  /** For jsonpath fields, the original field path (e.g., "body") */
  sourceField?: string;
}

export interface Assertion {
  field: string;
  operator: string;
  value?: unknown;
  /** JSONPath expression for jsonpath-type fields */
  jsonPath?: string;
}

interface AssertionBuilderProps {
  resultSchema: JsonSchema;
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
}

// ============================================================================
// OPERATORS BY FIELD TYPE
// ============================================================================

// Labels come from the shared map so the builder's dropdowns and the
// run-detail Assertions view always describe operators identically.
const op = (value: string) => ({
  value,
  label: OPERATOR_LABELS[value] ?? value,
});

const OPERATORS: Record<FieldType, { value: string; label: string }[]> = {
  string: [
    op("equals"),
    op("notEquals"),
    op("contains"),
    op("startsWith"),
    op("endsWith"),
    op("matches"),
    op("isEmpty"),
  ],
  number: [
    op("equals"),
    op("notEquals"),
    op("lessThan"),
    op("lessThanOrEqual"),
    op("greaterThan"),
    op("greaterThanOrEqual"),
  ],
  boolean: [op("isTrue"), op("isFalse")],
  enum: [op("equals")],
  array: [
    op("includes"),
    op("notIncludes"),
    op("lengthEquals"),
    op("lengthGreaterThan"),
    op("lengthLessThan"),
    op("isEmpty"),
    op("isNotEmpty"),
    op("exists"),
    op("notExists"),
  ],
  jsonpath: [
    op("exists"),
    op("notExists"),
    // Empty = [] / {} / "". A missing path is also "empty": combine with an
    // `exists` assertion on the same path to require "present but empty".
    op("isEmpty"),
    op("isNotEmpty"),
    op("equals"),
    op("notEquals"),
    op("contains"),
    op("greaterThan"),
    op("lessThan"),
  ],
};

// Operators that don't need a value input
const VALUE_LESS_OPERATORS = new Set([
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
  "exists",
  "notExists",
]);

// ============================================================================
// SCHEMA EXTRACTION
// ============================================================================

/**
 * Extract assertable fields from a JSON Schema, supporting nested objects.
 * Reuses the JsonSchemaProperty type from @checkstack/ui DynamicForm.
 */
export function extractAssertableFields(
  schema: JsonSchema,
  prefix = ""
): AssertableField[] {
  const fields: AssertableField[] = [];

  if (!schema.properties) return fields;

  for (const [key, prop] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const displayName = path
      .split(".")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" → ");

    // Handle enum type
    if (prop.enum && prop.enum.length > 0) {
      fields.push({
        path,
        displayName,
        type: "enum",
        enumValues: prop.enum,
      });
      continue;
    }

    // Determine type (handle type arrays like ["string", "null"] if present)
    const type = prop.type;

    switch (type) {
      case "string": {
        // Check for x-jsonpath metadata
        const hasJsonPath =
          (prop as Record<string, unknown>)["x-jsonpath"] === true;
        if (hasJsonPath) {
          fields.push({
            path: `${path}.$`,
            displayName: `${displayName} (JSONPath)`,
            type: "jsonpath",
            sourceField: path,
          });
        }
        fields.push({ path, displayName, type: "string" });
        break;
      }
      case "number":
      case "integer": {
        fields.push({ path, displayName, type: "number" });
        break;
      }
      case "boolean": {
        fields.push({ path, displayName, type: "boolean" });
        break;
      }
      case "array": {
        // Add array-level assertions
        fields.push({ path, displayName, type: "array" });
        // If array has typed items with properties, add item-level fields
        if (
          prop.items &&
          typeof prop.items === "object" &&
          "properties" in prop.items
        ) {
          const itemsWithProps = prop.items as JsonSchemaProperty;
          if (itemsWithProps.properties) {
            const itemFields = extractAssertableFields(
              { properties: itemsWithProps.properties },
              `${path}[*]`
            );
            fields.push(...itemFields);
          }
        }
        break;
      }
      case "object": {
        // Recurse into nested objects
        if (prop.properties) {
          const nestedFields = extractAssertableFields(
            { properties: prop.properties },
            path
          );
          fields.push(...nestedFields);
        }
        break;
      }
      default: {
        // Unknown type - treat as string for flexibility
        if (type) {
          fields.push({ path, displayName, type: "string" });
        }
      }
    }
  }

  return fields;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * AssertionBuilder component for creating assertions based on JSON Schema.
 * Automatically derives available fields and operators from the result schema.
 */
export const AssertionBuilder: React.FC<AssertionBuilderProps> = ({
  resultSchema,
  assertions,
  onChange,
}) => {
  // Extract assertable fields from schema
  const fields = useMemo(
    () => extractAssertableFields(resultSchema),
    [resultSchema]
  );

  const getFieldByPath = (path: string) => {
    return fields.find((f) => f.path === path);
  };

  const handleAddAssertion = () => {
    if (fields.length === 0) return;

    const firstField = fields[0];
    const operators = OPERATORS[firstField.type];

    onChange([
      ...assertions,
      {
        field: firstField.path,
        operator: operators[0].value,
        value: undefined,
      },
    ]);
  };

  const handleRemoveAssertion = (index: number) => {
    const updated = [...assertions];
    updated.splice(index, 1);
    onChange(updated);
  };

  const handleFieldChange = (index: number, fieldPath: string) => {
    const field = getFieldByPath(fieldPath);
    if (!field) return;

    const operators = OPERATORS[field.type];
    const updated = [...assertions];
    updated[index] = {
      field: fieldPath,
      operator: operators[0].value,
      value: undefined,
    };
    onChange(updated);
  };

  const handleOperatorChange = (index: number, operator: string) => {
    const updated = [...assertions];
    updated[index] = { ...updated[index], operator };
    // Clear value if operator doesn't need one
    if (VALUE_LESS_OPERATORS.has(operator)) {
      updated[index].value = undefined;
    }
    onChange(updated);
  };

  const handleValueChange = (index: number, value: unknown) => {
    const updated = [...assertions];
    updated[index] = { ...updated[index], value };
    onChange(updated);
  };

  const handleJsonPathChange = (index: number, jsonPath: string) => {
    const updated = [...assertions];
    updated[index] = { ...updated[index], jsonPath };
    onChange(updated);
  };

  if (fields.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No assertable fields available in result schema.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {assertions.map((assertion, index) => {
        const field = getFieldByPath(assertion.field);
        // Safely get operators with fallback to empty array
        const operators = field ? OPERATORS[field.type] ?? [] : [];
        const needsValue = !VALUE_LESS_OPERATORS.has(assertion.operator);

        // Check if current values match available options (prevents Radix UI crash)
        const fieldValueValid = fields.some((f) => f.path === assertion.field);
        const operatorValueValid = operators.some(
          (op) => op.value === assertion.operator
        );

        return (
          <div key={index} className="flex items-start gap-2 flex-wrap">
            {/* Field selector */}
            <div className="flex-1 min-w-[120px]">
              <Select
                value={fieldValueValid ? assertion.field : undefined}
                onValueChange={(v) => handleFieldChange(index, v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.path} value={f.path}>
                      {f.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* JSONPath input (for jsonpath fields) */}
            {field?.type === "jsonpath" && (
              <div className="flex-1 min-w-[120px]">
                <Input
                  value={assertion.jsonPath ?? ""}
                  onChange={(e) => handleJsonPathChange(index, e.target.value)}
                  placeholder="$.path.to.value"
                />
              </div>
            )}

            {/* Operator selector */}
            <div className="flex-1 min-w-[100px]">
              <Select
                value={operatorValueValid ? assertion.operator : undefined}
                onValueChange={(v) => handleOperatorChange(index, v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select operator..." />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Value input */}
            {needsValue && (
              <div className="flex-1 min-w-[120px]">
                {field?.type === "enum" && field.enumValues ? (
                  <Select
                    value={String(assertion.value ?? "")}
                    onValueChange={(v) => handleValueChange(index, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select value..." />
                    </SelectTrigger>
                    <SelectContent>
                      {field.enumValues.map((v) => (
                        <SelectItem key={String(v)} value={String(v)}>
                          {String(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field?.type === "number" ? (
                  <Input
                    type="number"
                    value={(assertion.value as number) ?? ""}
                    onChange={(e) =>
                      handleValueChange(
                        index,
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                    placeholder="Value"
                  />
                ) : (
                  <Input
                    value={String(assertion.value ?? "")}
                    onChange={(e) => handleValueChange(index, e.target.value)}
                    placeholder="Value"
                  />
                )}
              </div>
            )}

            {/* Remove button */}
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => handleRemoveAssertion(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      {/* Add assertion button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddAssertion}
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Assertion
      </Button>
    </div>
  );
};
