import React from "react";

import { EmptyState } from "../../index";

import type { DynamicFormProps } from "./types";
import { extractDefaults } from "./utils";
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
  optionsResolvers,
  templateProperties,
}) => {
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
              id={key}
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
