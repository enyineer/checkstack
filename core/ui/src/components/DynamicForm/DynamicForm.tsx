import React from "react";

import { EmptyState, FormError } from "../../index";

import type { DynamicFormProps } from "./types";
import {
  extractDefaults,
  isFieldHiddenByCondition,
  findSecretEnvSibling,
} from "./utils";
import { deriveClientFieldErrors } from "./validation.logic";
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
  templateCompletionProvider,
  typeDefinitions,
  shellEnvVars,
  starterTemplates,
  scriptTestRenderer,
  secretNames,
  acquireTypes,
  acquireResetKey,
  sdkTypes,
  sdkTypesResetKey,
  importablePackages,
  templatePreviewContext,
  showInlineErrors = false,
  fieldErrors,
  keepExistingSecretFields,
}) => {
  // Track previous validity to avoid redundant callbacks
  const prevValidRef = React.useRef<boolean | undefined>(undefined);

  // Top-level field keys the user has interacted with (touched + blurred).
  // Client-side inline errors only show for touched fields so the form does
  // not nag while the user is still filling it in for the first time.
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  // Initialize form with default values from schema
  React.useEffect(() => {
    if (!schema || !schema.properties) return;

    const defaults = extractDefaults(schema);
    const merged = { ...defaults, ...value };

    // Only update if there are new defaults to apply
    if (JSON.stringify(merged) !== JSON.stringify(value)) {
      onChange(merged);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: runs only on schema change. Including onChange would re-fire on parent re-renders; including value would cause an infinite loop since this effect calls onChange(merged)
  }, [schema]);

  // Single source of truth for client-side validation: the same per-field
  // error map drives both the inline messages and the validity boolean
  // (valid iff the map is empty), so what disables the submit button and
  // what the user sees can never disagree. Honors keep-existing secrets.
  const clientErrors = React.useMemo(() => {
    if (!schema || !schema.properties) return {};
    return deriveClientFieldErrors({ schema, value, keepExistingSecretFields });
  }, [schema, value, keepExistingSecretFields]);

  // Report validity changes.
  React.useEffect(() => {
    if (!onValidChange || !schema || !schema.properties) return;
    const isValid = Object.keys(clientErrors).length === 0;
    if (prevValidRef.current !== isValid) {
      prevValidRef.current = isValid;
      onValidChange(isValid);
    }
  }, [schema, clientErrors, onValidChange]);

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

  // The script field and its `x-secret-env` field are top-level siblings in
  // an action config, so resolve the mapping once at the root and forward it
  // to every field; a testable script field passes it to the test panel.
  const rootSecretEnv = findSecretEnvSibling({
    properties: schema.properties,
    values: value,
  });

  return (
    <div className="space-y-6">
      {Object.entries(schema.properties)
        .filter(([, propSchema]) => {
          if (propSchema["x-hidden"]) return false;
          if (
            propSchema["x-hidden-when"] &&
            isFieldHiddenByCondition(propSchema["x-hidden-when"], value)
          )
            return false;
          return true;
        })
        .map(([key, propSchema]) => {
          const isRequired = schema.required?.includes(key);
          const label = key.charAt(0).toUpperCase() + key.slice(1);

          // Resolve the inline message for this field. Server-supplied
          // `fieldErrors` (keyed by exact key or a nested `key.*` path) take
          // precedence and show whenever present; client errors only show
          // when inline errors are enabled AND the field has been touched.
          // Either way the message renders below the field without changing
          // the field's own markup.
          const clientError =
            showInlineErrors && touched[key] ? clientErrors[key] : undefined;
          const fieldError = resolveFieldError({
            key,
            fieldErrors,
            clientError,
          });

          const errorId = fieldError ? `field-${key}-error` : undefined;

          return (
            <div key={key} className="space-y-1.5">
              <FormField
                // Prefix with 'field-' to prevent DOM clobbering when field
                // names match native DOM properties (e.g. nodeName, tagName)
                id={`field-${key}`}
                label={label}
                invalid={Boolean(fieldError)}
                errorId={errorId}
                propSchema={propSchema}
                value={value[key]}
                isRequired={isRequired}
                formValues={value}
                optionsResolvers={optionsResolvers}
                templateProperties={templateProperties}
                templateCompletionProvider={templateCompletionProvider}
                typeDefinitions={typeDefinitions}
                shellEnvVars={shellEnvVars}
                starterTemplates={starterTemplates}
                scriptTestRenderer={scriptTestRenderer}
                secretNames={secretNames}
                acquireTypes={acquireTypes}
                acquireResetKey={acquireResetKey}
                sdkTypes={sdkTypes}
                sdkTypesResetKey={sdkTypesResetKey}
                importablePackages={importablePackages}
                templatePreviewContext={templatePreviewContext}
                siblingSecretEnv={rootSecretEnv}
                onChange={(val) => {
                  // First interaction marks the field touched so its inline
                  // required error can appear (covers touched-then-blanked).
                  if (showInlineErrors && !touched[key]) {
                    setTouched((prev) => ({ ...prev, [key]: true }));
                  }
                  onChange({ ...value, [key]: val });
                }}
              />
              {fieldError && (
                <FormError id={errorId} className="text-xs">
                  {fieldError}
                </FormError>
              )}
            </div>
          );
        })}
    </div>
  );
};

/**
 * Pick the inline error message to render under a top-level field. Server
 * errors (`fieldErrors`) win over the client error and may be keyed either
 * by the exact field key or by a nested path (`key.child`); the first nested
 * match is surfaced so a sub-field problem still flags its parent field.
 */
function resolveFieldError({
  key,
  fieldErrors,
  clientError,
}: {
  key: string;
  fieldErrors: Record<string, string> | undefined;
  clientError: string | undefined;
}): string | undefined {
  if (fieldErrors) {
    if (fieldErrors[key] !== undefined) return fieldErrors[key];
    const nestedKey = Object.keys(fieldErrors).find((path) =>
      path.startsWith(`${key}.`),
    );
    if (nestedKey !== undefined) return fieldErrors[nestedKey];
  }
  return clientError;
}
