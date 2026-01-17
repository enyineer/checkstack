import React from "react";

import { EmptyState } from "../../index";

import type { DynamicFormProps } from "./types";
import { extractDefaults, isValueEmpty } from "./utils";
import { FormField } from "./FormField";

/**
 * DynamicForm generates a form from a JSON Schema.
 * Supports all standard JSON Schema types plus custom extensions for
 * secrets, colors, templates, dynamic options, and discriminated unions.
 */
export const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  value,
  onChange,
  onValidChange,
  optionsResolvers,
  templateProperties,
}) => {
  // Track previous validity to avoid redundant callbacks
  const prevValidRef = React.useRef<boolean | undefined>(undefined);

  // Initialize form with default values from schema
  React.useEffect(() => {
    if (!schema || !schema.properties) return;

    const defaults = extractDefaults(schema);
    const merged = { ...defaults, ...value };

    // Only update if there are new defaults to apply
    if (JSON.stringify(merged) !== JSON.stringify(value)) {
      onChange(merged);
    }
  }, [schema]); // Only run when schema changes

  // Compute validity and report changes
  React.useEffect(() => {
    if (!onValidChange || !schema || !schema.properties) return;

    // Check all required fields (including hidden ones like connectionId)
    const requiredKeys = schema.required ?? [];
    let isValid = true;

    for (const key of requiredKeys) {
      const propSchema = schema.properties[key];
      if (!propSchema) continue;

      // Skip hidden fields - they are auto-populated
      if (propSchema["x-hidden"]) continue;

      if (isValueEmpty(value[key], propSchema)) {
        isValid = false;
        break;
      }
    }

    // Only call onValidChange if validity actually changed
    if (prevValidRef.current !== isValid) {
      prevValidRef.current = isValid;
      onValidChange(isValid);
    }
  }, [schema, value, onValidChange]);

  if (
    !schema ||
    !schema.properties ||
    Object.keys(schema.properties).length === 0
  ) {
    return (
      <EmptyState
        title="No Configuration Required"
        description="This component doesn't require any configuration."
      />
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(schema.properties)
        .filter(([, propSchema]) => !propSchema["x-hidden"])
        .map(([key, propSchema]) => {
          const isRequired = schema.required?.includes(key);
          const label = key.charAt(0).toUpperCase() + key.slice(1);

          return (
            <FormField
              key={key}
              // Prefix with 'field-' to prevent DOM clobbering when field names
              // match native DOM properties (e.g., nodeName, tagName, innerHTML)
              id={`field-${key}`}
              label={label}
              propSchema={propSchema}
              value={value[key]}
              isRequired={isRequired}
              formValues={value}
              optionsResolvers={optionsResolvers}
              templateProperties={templateProperties}
              onChange={(val) => onChange({ ...value, [key]: val })}
            />
          );
        })}
    </div>
  );
};
