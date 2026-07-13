import { useEffect, useState } from "react";
import { Braces, Plus, Trash2 } from "lucide-react";
import { renderTemplatePreview } from "@checkstack/template-engine";
import {
  SECRET_CLEAR_SENTINEL,
  isSecretClearSentinel,
} from "@checkstack/common";

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Textarea,
  Toggle,
  ColorPicker,
  TemplateValueInput,
  DurationInput,
  type DurationValue,
  ConfirmationModal,
} from "../../index";

import type { FormFieldProps, JsonSchemaProperty } from "./types";
import {
  getCleanDescription,
  NONE_SENTINEL,
  findSecretEnvSibling,
  nestedChildrenRequired,
  coerceNumberInput,
  isArrayItemNonTrivial,
  scopeArrayItemFormValues,
} from "./utils";
import { DynamicOptionsField } from "./DynamicOptionsField";
import { JsonField } from "./JsonField";
import { MultiTypeEditorField } from "./MultiTypeEditorField";
import { SecretEnvEditor } from "./SecretEnvEditor";

/**
 * Recursive field renderer that handles all supported JSON Schema types.
 */
export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  propSchema,
  value,
  isRequired,
  formValues,
  optionsResolvers,
  templateProperties,
  templateCompletionProvider,
  templatableFieldsOnly,
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
  siblingSecretEnv,
  storedSecret,
  clearableSecret,
  invalid,
  errorId,
  onChange,
}) => {
  const description = propSchema.description || "";
  const describedBy = invalid && errorId ? errorId : undefined;

  // Const field handling - must be before any early returns (rules-of-hooks)
  const isConstField = propSchema.const !== undefined;
  useEffect(() => {
    if (isConstField && value !== propSchema.const) {
      onChange(propSchema.const);
    }
  }, [isConstField, value, propSchema.const, onChange]);

  // Dynamic options via resolver
  const resolverName = propSchema["x-options-resolver"];
  if (resolverName && optionsResolvers) {
    return (
      <DynamicOptionsField
        id={id}
        label={label}
        description={description}
        value={value}
        isRequired={isRequired}
        resolverName={resolverName}
        dependsOn={propSchema["x-depends-on"]}
        searchable={propSchema["x-searchable"] === true}
        optionsStyle={propSchema["x-options-style"]}
        formValues={formValues}
        optionsResolvers={optionsResolvers}
        onChange={onChange}
      />
    );
  }

  if (isConstField) {
    return <></>;
  }

  // Duration field — render the DurationInput (single-unit duration
  // object). Marked via `x-duration: true` or `format: "duration"`. This
  // branch is intentionally additive and sits before the generic union /
  // object handlers so a `for:` / threshold-window config renders the
  // widget rather than the raw oneOf discriminator picker.
  const isDuration =
    propSchema["x-duration"] === true || propSchema.format === "duration";
  if (isDuration) {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id} required={isRequired}>{label}</Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        <DurationInput
          id={id}
          value={value as DurationValue | undefined}
          onChange={(next) => onChange(next)}
        />
      </div>
    );
  }

  // Enum handling
  if (propSchema.enum) {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id} required={isRequired}>{label}</Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        <div className="relative">
          <Select
            value={(value as string) || (propSchema.default as string) || ""}
            onValueChange={(val) =>
              onChange(val === NONE_SENTINEL ? undefined : val)
            }
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={`Select ${label}`} />
            </SelectTrigger>
            <SelectContent>
              {!isRequired && (
                <SelectItem
                  value={NONE_SENTINEL}
                  className="text-muted-foreground"
                >
                  None
                </SelectItem>
              )}
              {propSchema.enum.map((opt: string) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  // String
  if (propSchema.type === "string") {
    const cleanDesc = getCleanDescription(description);

    // Multi-type editor field (x-editor-types)
    const editorTypes = propSchema["x-editor-types"];
    if (editorTypes && editorTypes.length > 0) {
      return (
        <div className="space-y-2">
          <MultiTypeEditorField
            id={id}
            label={label}
            description={cleanDesc}
            value={value as string | undefined}
            isRequired={isRequired}
            editorTypes={editorTypes}
            templateProperties={templateProperties}
            typeDefinitions={typeDefinitions}
            shellEnvVars={shellEnvVars}
            starterTemplates={starterTemplates}
            scriptTestRenderer={
              propSchema["x-script-testable"] === true
                ? scriptTestRenderer
                : undefined
            }
            acquireTypes={acquireTypes}
            acquireResetKey={acquireResetKey}
            sdkTypes={sdkTypes}
            sdkTypesResetKey={sdkTypesResetKey}
            importablePackages={importablePackages}
            fieldId={id}
            siblingSecretEnv={siblingSecretEnv}
            onChange={onChange as (val: string | undefined) => void}
          />
          {propSchema["x-templatable"] && templatePreviewContext && (
            <TemplatePreviewLine
              value={(value as string) || ""}
              context={templatePreviewContext}
            />
          )}
        </div>
      );
    }

    const isTextarea =
      propSchema.format === "textarea" ||
      propSchema.description?.includes("[textarea]");
    const isSecret = (
      propSchema as JsonSchemaProperty & { "x-secret"?: boolean }
    )["x-secret"];

    // Secret textarea fields (e.g., PEM certificates)
    if (isTextarea && isSecret) {
      return (
        <SecretTextareaField
          id={id}
          label={label}
          description={cleanDesc}
          value={value as string}
          isRequired={isRequired}
          storedSecret={storedSecret}
          clearableSecret={clearableSecret}
          onChange={onChange}
        />
      );
    }

    // Textarea fields
    if (isTextarea) {
      return (
        <div className="space-y-2">
          <div>
            <Label htmlFor={id} required={isRequired}>{label}</Label>
            {cleanDesc && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {cleanDesc}
              </p>
            )}
          </div>
          <Textarea
            id={id}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              propSchema.default ? `Default: ${String(propSchema.default)}` : ""
            }
            rows={5}
          />
        </div>
      );
    }

    // Secret field (password input)
    if (isSecret) {
      return (
        <SecretField
          id={id}
          label={label}
          description={cleanDesc}
          value={value as string}
          isRequired={isRequired}
          storedSecret={storedSecret}
          clearableSecret={clearableSecret}
          onChange={onChange}
        />
      );
    }

    // Color picker field
    const isColor = (
      propSchema as JsonSchemaProperty & { "x-color"?: boolean }
    )["x-color"];

    if (isColor) {
      return (
        <div className="space-y-2">
          <div>
            <Label htmlFor={id} required={isRequired}>{label}</Label>
            {cleanDesc && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {cleanDesc}
              </p>
            )}
          </div>
          <ColorPicker
            id={id}
            value={(value as string) || ""}
            onChange={(val) => onChange(val)}
            placeholder={
              propSchema.default ? String(propSchema.default) : "#000000"
            }
          />
        </div>
      );
    }

    // Default string input. When a completion provider is supplied the field
    // gets a TemplateValueInput wired to it for `{{ … }}` autocomplete; without
    // one, keep the bare Input so other DynamicForm consumers are unaffected.
    // `templatableFieldsOnly` restricts the provider to fields explicitly
    // marked `x-templatable` (the health-check editor, where only some fields
    // template); the default (false) applies it to every string field (the
    // automation editor, where all config is templatable).
    const isTemplatable = propSchema["x-templatable"] === true;
    const useTemplateInput =
      Boolean(templateCompletionProvider) &&
      (!templatableFieldsOnly || isTemplatable);
    const placeholder = propSchema.default
      ? `Default: ${String(propSchema.default)}`
      : "";
    return (
      <div className="space-y-2">
        <div>
          <div className="flex items-center gap-2">
            <Label htmlFor={id} required={isRequired}>{label}</Label>
            {isTemplatable && <TemplatableBadge />}
          </div>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        {useTemplateInput && templateCompletionProvider ? (
          <TemplateValueInput
            id={id}
            value={(value as string) || ""}
            onChange={(next) => onChange(next)}
            placeholder={placeholder}
            completionProvider={templateCompletionProvider}
          />
        ) : (
          <Input
            id={id}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
        {isTemplatable && templatePreviewContext && (
          <TemplatePreviewLine
            value={(value as string) || ""}
            context={templatePreviewContext}
          />
        )}
      </div>
    );
  }

  // Number
  if (propSchema.type === "number" || propSchema.type === "integer") {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id} required={isRequired}>{label}</Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        <Input
          id={id}
          type="number"
          value={
            value === undefined
              ? (propSchema.default as number | string) || ""
              : (value as number | string)
          }
          onChange={(e) =>
            onChange(
              coerceNumberInput({
                raw: e.target.value,
                isInteger: propSchema.type === "integer",
              }),
            )
          }
          invalid={invalid}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  // Boolean
  if (propSchema.type === "boolean") {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 space-y-1">
          <Label htmlFor={id} className="cursor-pointer" required={isRequired}>{label}</Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground">{cleanDesc}</p>
          )}
        </div>
        <Toggle
          checked={
            value === undefined
              ? (propSchema.default as boolean) || false
              : (value as boolean)
          }
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  // Dictionary/Record (headers)
  // Secret -> env mapping: a dedicated editor (env name + secret-name
  // picker) instead of the raw JSON record fallback.
  if (
    propSchema.type === "object" &&
    propSchema.additionalProperties &&
    propSchema["x-secret-env"]
  ) {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id} required={isRequired}>{label}</Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        <SecretEnvEditor
          id={id}
          value={(value as Record<string, string> | undefined) ?? {}}
          secretNames={secretNames}
          onChange={(next) => onChange(next)}
        />
      </div>
    );
  }

  if (propSchema.type === "object" && propSchema.additionalProperties) {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id} required={isRequired}>{label} (JSON)</Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        <JsonField
          id={id}
          value={value as Record<string, unknown>}
          propSchema={propSchema}
          onChange={(val) => onChange(val)}
        />
      </div>
    );
  }

  // Object (Nested Form)
  if (propSchema.type === "object" && propSchema.properties) {
    // Resolve the secret→env sibling within THIS object so a nested
    // testable script field forwards the right mapping to the test panel.
    const nestedSecretEnv = findSecretEnvSibling({
      properties: propSchema.properties,
      values: value as Record<string, unknown> | undefined,
    });
    // An OPTIONAL nested object (e.g. an opt-in spend cap) only marks its
    // schema-required children with `*` once the operator starts providing the
    // object; while empty, supplying it is optional. A required object always
    // marks them. (See nestedChildrenRequired.)
    const childrenRequired = nestedChildrenRequired({
      objectRequired: isRequired ?? false,
      objectValue: value,
    });
    return (
      <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
        <p className="text-sm font-semibold">{label}</p>
        {Object.entries(propSchema.properties).map(([key, subSchema]) => (
          <FormField
            key={key}
            id={`${id}.${key}`}
            label={key.charAt(0).toUpperCase() + key.slice(1)}
            propSchema={subSchema}
            value={(value as Record<string, unknown>)?.[key]}
            isRequired={childrenRequired && (propSchema.required?.includes(key) ?? false)}
            formValues={formValues}
            optionsResolvers={optionsResolvers}
            templateProperties={templateProperties}
            templateCompletionProvider={templateCompletionProvider}
            templatableFieldsOnly={templatableFieldsOnly}
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
            siblingSecretEnv={nestedSecretEnv}
            onChange={(val) =>
              onChange({ ...(value as Record<string, unknown>), [key]: val })
            }
          />
        ))}
      </div>
    );
  }

  // Array support
  if (propSchema.type === "array") {
    const items = (value as unknown[]) || [];
    const itemSchema = propSchema.items;
    const cleanDesc = getCleanDescription(description);

    if (!itemSchema) return <></>;

    // Helper to create initial value for new array items
    const createNewItem = (): unknown => {
      // Handle primitive types
      if (itemSchema.type === "string") {
        return itemSchema.default ?? "";
      }
      if (itemSchema.type === "number" || itemSchema.type === "integer") {
        return itemSchema.default ?? 0;
      }
      if (itemSchema.type === "boolean") {
        return itemSchema.default ?? false;
      }

      // Check if itemSchema is a discriminated union
      const variants = itemSchema.oneOf || itemSchema.anyOf;
      if (variants && variants.length > 0) {
        const firstVariant = variants[0];
        if (firstVariant.properties) {
          const newItem: Record<string, unknown> = {};
          // Find discriminator and set all properties with defaults
          for (const [propKey, propDef] of Object.entries(
            firstVariant.properties,
          )) {
            if (propDef.const !== undefined) {
              // This is the discriminator field
              newItem[propKey] = propDef.const;
            } else if (propDef.default !== undefined) {
              newItem[propKey] = propDef.default;
            }
          }
          return newItem;
        }
      }
      // Fallback to empty object for regular object items
      return {};
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label required={isRequired}>{label}</Label>
            {cleanDesc && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {cleanDesc}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...items, createNewItem()])}
            className="h-8 gap-1 transition-all hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No items added yet.
          </p>
        )}
        <div className="space-y-4">
          {items.map((item: unknown, index: number) => {
            // Row-scope the form values so a resolver inside this item can read
            // its OWN row's siblings (e.g. a `{key,value}` filter row's value
            // dropdown depending on that row's `key`) alongside the whole-form
            // values. The object branch forwards this unchanged to child fields.
            const itemFormValues = scopeArrayItemFormValues({ formValues, item });
            return (
            <ArrayItemRow
              key={index}
              item={item}
              label={`${label} #${index + 1}`}
              onRemove={() => {
                const next = [...(items as unknown[])];
                next.splice(index, 1);
                onChange(next);
              }}
            >
              <FormField
                id={`${id}[${index}]`}
                label={`${label} #${index + 1}`}
                propSchema={itemSchema}
                value={item}
                formValues={itemFormValues}
                optionsResolvers={optionsResolvers}
                templateProperties={templateProperties}
                templateCompletionProvider={templateCompletionProvider}
                templatableFieldsOnly={templatableFieldsOnly}
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
                onChange={(val) => {
                  const next = [...(items as unknown[])];
                  next[index] = val;
                  onChange(next);
                }}
              />
            </ArrayItemRow>
            );
          })}
        </div>
      </div>
    );
  }

  // Discriminated Union (oneOf/anyOf) with object variants
  const unionVariants = propSchema.oneOf || propSchema.anyOf;
  if (unionVariants && unionVariants.length > 0) {
    // Find the discriminator field by looking for a property with "const" in each variant
    const firstVariant = unionVariants[0];
    if (!firstVariant.properties) return <></>;

    // Find discriminator: the field that has "const" in each variant
    let discriminatorField: string | undefined;
    for (const [fieldName, fieldSchema] of Object.entries(
      firstVariant.properties,
    )) {
      if (fieldSchema.const !== undefined) {
        discriminatorField = fieldName;
        break;
      }
    }

    if (!discriminatorField) return <></>;

    // Get current discriminator value and find matching variant
    const currentValue = value as Record<string, unknown> | undefined;
    const currentDiscriminatorValue = currentValue?.[discriminatorField];

    // Extract variant options from all variants
    const variantOptions = unionVariants
      .map((variant) => {
        const discProp = variant.properties?.[discriminatorField];
        const constValue = discProp?.const;
        if (constValue === undefined) return;
        return String(constValue);
      })
      .filter((v): v is string => v !== undefined);

    // Find the currently selected variant
    const selectedVariant =
      unionVariants.find((variant) => {
        const discProp = variant.properties?.[discriminatorField];
        return discProp?.const === currentDiscriminatorValue;
      }) || unionVariants[0];

    const displayDiscriminatorField =
      discriminatorField.charAt(0).toUpperCase() + discriminatorField.slice(1);

    // Secret→env sibling within the selected variant's object.
    const variantSecretEnv = findSecretEnvSibling({
      properties: selectedVariant.properties,
      values: currentValue,
    });

    return (
      <div className="space-y-3 p-3 border rounded-lg bg-background">
        {/* Discriminator selector */}
        <div className="space-y-2">
          <div>
            <Label htmlFor={`${id}.${discriminatorField}`}>
              {displayDiscriminatorField}
            </Label>
          </div>
          <Select
            value={String(currentDiscriminatorValue || variantOptions[0] || "")}
            onValueChange={(newValue) => {
              // When discriminator changes, reset to new variant with only discriminator set
              const newVariant = unionVariants.find((v) => {
                const discProp = v.properties?.[discriminatorField];
                return String(discProp?.const) === newValue;
              });
              if (newVariant) {
                // Initialize with defaults for the new variant
                const newObj: Record<string, unknown> = {
                  [discriminatorField]: newValue,
                };
                // Set defaults for other properties
                for (const [propKey, propDef] of Object.entries(
                  newVariant.properties || {},
                )) {
                  if (
                    propKey !== discriminatorField &&
                    propDef.default !== undefined
                  ) {
                    newObj[propKey] = propDef.default;
                  }
                }
                onChange(newObj);
              }
            }}
          >
            <SelectTrigger id={`${id}.${discriminatorField}`}>
              <SelectValue
                placeholder={`Select ${displayDiscriminatorField}`}
              />
            </SelectTrigger>
            <SelectContent>
              {variantOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Render other fields from selected variant */}
        {selectedVariant.properties &&
          Object.entries(selectedVariant.properties)
            .filter(([key]) => key !== discriminatorField)
            .map(([key, subSchema]) => (
              <FormField
                key={`${id}.${key}`}
                id={`${id}.${key}`}
                label={
                  key.charAt(0).toUpperCase() +
                  key.slice(1).replaceAll(/([A-Z])/g, " $1")
                }
                propSchema={subSchema}
                value={currentValue?.[key]}
                isRequired={selectedVariant.required?.includes(key)}
                formValues={formValues}
                optionsResolvers={optionsResolvers}
                templateProperties={templateProperties}
                templateCompletionProvider={templateCompletionProvider}
                templatableFieldsOnly={templatableFieldsOnly}
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
                siblingSecretEnv={variantSecretEnv}
                onChange={(val) => onChange({ ...currentValue, [key]: val })}
              />
            ))}
      </div>
    );
  }

  return <></>;
};

/**
 * A single editable row in the array editor. Wraps the rendered item field with
 * a remove button. Removal of a NON-trivial item (one that holds any
 * user-entered value) is gated behind the shared accessible
 * {@link ConfirmationModal}; empty / just-added rows are removed immediately so
 * the common "add then change my mind" flow stays frictionless.
 */
const ArrayItemRow: React.FC<{
  item: unknown;
  label: string;
  onRemove: () => void;
  children: React.ReactNode;
}> = ({ item, label, onRemove, children }) => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleRemoveClick = () => {
    if (isArrayItemNonTrivial(item)) {
      setConfirmOpen(true);
      return;
    }
    onRemove();
  };

  return (
    <div className="relative group">
      <div className="p-4 border rounded-lg bg-background shadow-sm border-border transition-all hover:border-border/80">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleRemoveClick}
          className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-background border shadow-sm text-destructive hover:text-destructive/90 hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        {children}
      </div>
      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onRemove();
        }}
        title="Remove item?"
        message={`This will remove "${label}" and its values. This cannot be undone.`}
        confirmText="Remove"
        variant="danger"
      />
    </div>
  );
};

/**
 * Small discoverability badge shown next to a single-line `x-templatable`
 * field's label. Signals that the field accepts `{{ … }}` templating
 * (`{{ environment.* }}`, `{{ check.* }}`, `{{ system.* }}`) without relying on
 * the field's `.describe()` prose. Kept quiet (muted, bordered) so it reads as
 * an affordance, not a warning.
 */
const TemplatableBadge: React.FC = () => (
  <span
    className="inline-flex items-center gap-1 rounded border border-border/60 bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
    title="Supports {{ }} templating: {{ environment.* }}, {{ check.* }}, {{ system.* }}"
  >
    <Braces className="h-3 w-3" />
    Templating
  </span>
);

/**
 * Inline preview of a templatable field's rendered output against a sample
 * context. Shown below `x-templatable` string fields when the owning form
 * supplies a `templatePreviewContext`. Pure render (no DOM/Monaco), so it
 * matches the run-time `x-templatable` pass exactly.
 */
const TemplatePreviewLine: React.FC<{
  value: string;
  context: Record<string, unknown>;
}> = ({ value, context }) => {
  if (!value || !value.includes("{{")) return null;
  const rendered = renderTemplatePreview({ value, context });
  return (
    <p className="text-xs text-muted-foreground">
      Preview:{" "}
      <span className="font-mono break-all text-foreground">
        {rendered || "(empty)"}
      </span>
    </p>
  );
};

/**
 * Shared visibility toggle button for secret fields.
 */
const VisibilityToggle: React.FC<{
  visible: boolean;
  onToggle: () => void;
}> = ({ visible, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className="absolute right-2 top-3 text-muted-foreground hover:text-foreground"
  >
    {visible ? (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
        />
      </svg>
    ) : (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    )}
  </button>
);

/**
 * Secret field component with password visibility toggle.
 * Extracted to keep hooks at component top level.
 */
const SecretField: React.FC<{
  id: string;
  label: string;
  description?: string;
  value: string;
  isRequired?: boolean;
  storedSecret?: boolean;
  clearableSecret?: boolean;
  onChange: (val: unknown) => void;
}> = ({
  id,
  label,
  description,
  value,
  isRequired,
  storedSecret,
  clearableSecret,
  onChange,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isCleared = isSecretClearSentinel(value);
  // While flagged for clearing, the sentinel is the field value - never show
  // it in the input.
  const currentValue = isCleared ? "" : value || "";
  const hasExistingValue = currentValue.length > 0;

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={id} required={isRequired}>{label}</Label>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={showPassword ? "text" : "password"}
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            isCleared
              ? "Secret will be cleared on save"
              : storedSecret
                ? "••••••••  (stored - leave empty to keep)"
                : "Enter secret value"
          }
          className="pr-10"
        />
        <VisibilityToggle
          visible={showPassword}
          onToggle={() => setShowPassword(!showPassword)}
        />
      </div>
      <StoredSecretControls
        storedSecret={storedSecret}
        clearableSecret={clearableSecret}
        isCleared={isCleared}
        hasInput={hasExistingValue}
        onClear={() => onChange(SECRET_CLEAR_SENTINEL)}
        onUndoClear={() => onChange("")}
      />
    </div>
  );
};

/**
 * Sub-line beneath a secret input that explains the EDIT-mode "keep existing"
 * behavior and, for an optional stored secret, offers Clear / Undo. Renders
 * nothing in create mode or when the operator is actively typing a new value.
 */
const StoredSecretControls: React.FC<{
  storedSecret?: boolean;
  clearableSecret?: boolean;
  isCleared: boolean;
  hasInput: boolean;
  onClear: () => void;
  onUndoClear: () => void;
}> = ({
  storedSecret,
  clearableSecret,
  isCleared,
  hasInput,
  onClear,
  onUndoClear,
}) => {
  if (isCleared) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-destructive">
          Stored secret will be removed on save.
        </p>
        <button
          type="button"
          onClick={onUndoClear}
          className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
        >
          Undo
        </button>
      </div>
    );
  }
  // Only relevant for a stored secret the operator has not started replacing.
  if (!storedSecret || hasInput) return null;
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs text-muted-foreground">
        A secret is stored. Leave empty to keep it.
      </p>
      {clearableSecret && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-destructive underline hover:text-destructive/80"
        >
          Clear
        </button>
      )}
    </div>
  );
};

/**
 * Secret textarea field for multi-line secrets (e.g., PEM certificates).
 * Renders a textarea with a visibility toggle and secret-like behavior.
 */
const SecretTextareaField: React.FC<{
  id: string;
  label: string;
  description?: string;
  value: string;
  isRequired?: boolean;
  storedSecret?: boolean;
  clearableSecret?: boolean;
  onChange: (val: unknown) => void;
}> = ({
  id,
  label,
  description,
  value,
  isRequired,
  storedSecret,
  clearableSecret,
  onChange,
}) => {
  const [showContent, setShowContent] = useState(false);
  const isCleared = isSecretClearSentinel(value);
  const currentValue = isCleared ? "" : value || "";
  const hasExistingValue = currentValue.length > 0;
  const placeholder = isCleared
    ? "Secret will be cleared on save"
    : storedSecret
      ? "Leave empty to keep the stored value"
      : "Paste content here";

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={id} required={isRequired}>{label}</Label>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="relative">
        {showContent ? (
          <Textarea
            id={id}
            value={currentValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={5}
            className="pr-10 font-mono text-xs"
          />
        ) : (
          <Textarea
            id={id}
            value={currentValue ? "••••••••••••••••••••" : ""}
            onChange={(e) => {
              // If user types/pastes into masked field, switch to visible mode
              const newVal = e.target.value.replaceAll("•", "");
              if (newVal) {
                setShowContent(true);
                onChange(newVal);
              }
            }}
            onPaste={(e) => {
              // On paste, switch to visible mode and use pasted content
              e.preventDefault();
              const pastedText = e.clipboardData.getData("text");
              if (pastedText) {
                setShowContent(true);
                onChange(pastedText);
              }
            }}
            placeholder={placeholder}
            rows={3}
            className="pr-10"
            readOnly={!!currentValue}
          />
        )}
        <VisibilityToggle
          visible={showContent}
          onToggle={() => setShowContent(!showContent)}
        />
      </div>
      <StoredSecretControls
        storedSecret={storedSecret}
        clearableSecret={clearableSecret}
        isCleared={isCleared}
        hasInput={hasExistingValue}
        onClear={() => onChange(SECRET_CLEAR_SENTINEL)}
        onUndoClear={() => onChange("")}
      />
    </div>
  );
};
