import React from "react";
import { Plus, Trash2 } from "lucide-react";

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
  TemplateEditor,
} from "../../index";

import type { FormFieldProps, JsonSchemaProperty } from "./types";
import { getCleanDescription, NONE_SENTINEL } from "./utils";
import { DynamicOptionsField } from "./DynamicOptionsField";
import { JsonField } from "./JsonField";

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
  onChange,
}) => {
  const description = propSchema.description || "";

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
        formValues={formValues}
        optionsResolvers={optionsResolvers}
        onChange={onChange}
      />
    );
  }

  // Const field handling - auto-set value and hide (value is fixed)
  if (propSchema.const !== undefined) {
    // Silently ensure the value is set, no UI needed
    React.useEffect(() => {
      if (value !== propSchema.const) {
        onChange(propSchema.const);
      }
    }, [value, propSchema.const, onChange]);
    return <></>;
  }

  // Enum handling
  if (propSchema.enum) {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
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
    const isTextarea =
      propSchema.format === "textarea" ||
      propSchema.description?.includes("[textarea]");
    const isSecret = (
      propSchema as JsonSchemaProperty & { "x-secret"?: boolean }
    )["x-secret"];
    const cleanDesc = getCleanDescription(description);

    // Textarea fields - use TemplateEditor if templateProperties available
    if (isTextarea) {
      // If we have template properties, use TemplateEditor
      if (templateProperties && templateProperties.length > 0) {
        return (
          <div className="space-y-2">
            <div>
              <Label htmlFor={id}>
                {label} {isRequired && "*"}
              </Label>
              {cleanDesc && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {cleanDesc}
                </p>
              )}
            </div>
            <TemplateEditor
              value={(value as string) || ""}
              onChange={(val) => onChange(val)}
              availableProperties={templateProperties}
              placeholder={
                propSchema.default
                  ? `Default: ${String(propSchema.default)}`
                  : "Enter template..."
              }
              rows={5}
            />
          </div>
        );
      }

      // No template properties, fall back to regular textarea
      return (
        <div className="space-y-2">
          <div>
            <Label htmlFor={id}>
              {label} {isRequired && "*"}
            </Label>
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
            <Label htmlFor={id}>
              {label} {isRequired && "*"}
            </Label>
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

    // Default string input - use TemplateEditor if templateProperties available
    // If we have template properties, use TemplateEditor with smaller rows
    if (templateProperties && templateProperties.length > 0) {
      return (
        <div className="space-y-2">
          <div>
            <Label htmlFor={id}>
              {label} {isRequired && "*"}
            </Label>
            {cleanDesc && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {cleanDesc}
              </p>
            )}
          </div>
          <TemplateEditor
            value={(value as string) || ""}
            onChange={(val) => onChange(val)}
            availableProperties={templateProperties}
            placeholder={
              propSchema.default
                ? `Default: ${String(propSchema.default)}`
                : undefined
            }
            rows={2}
          />
        </div>
      );
    }

    // No template properties - fallback to regular Input
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        <Input
          id={id}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            propSchema.default ? `Default: ${String(propSchema.default)}` : ""
          }
        />
      </div>
    );
  }

  // Number
  if (propSchema.type === "number" || propSchema.type === "integer") {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
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
              propSchema.type === "integer"
                ? Number.parseInt(e.target.value, 10)
                : Number.parseFloat(e.target.value),
            )
          }
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
          <Label htmlFor={id} className="cursor-pointer">
            {label} {isRequired && "*"}
          </Label>
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
  if (propSchema.type === "object" && propSchema.additionalProperties) {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id}>
            {label} (JSON) {isRequired && "*"}
          </Label>
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
            isRequired={propSchema.required?.includes(key)}
            formValues={formValues}
            optionsResolvers={optionsResolvers}
            templateProperties={templateProperties}
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
    const createNewItem = (): Record<string, unknown> => {
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
            <Label>
              {label} {isRequired && "*"}
            </Label>
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
            onClick={() =>
              onChange([
                ...(items as Record<string, unknown>[]),
                createNewItem(),
              ])
            }
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
          {items.map((item: unknown, index: number) => (
            <div key={index} className="relative group">
              <div className="p-4 border rounded-lg bg-background shadow-sm border-border transition-all hover:border-border/80">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const next = [...(items as unknown[])];
                    next.splice(index, 1);
                    onChange(next);
                  }}
                  className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-background border shadow-sm text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <FormField
                  id={`${id}[${index}]`}
                  label={`${label} #${index + 1}`}
                  propSchema={itemSchema}
                  value={item}
                  formValues={formValues}
                  optionsResolvers={optionsResolvers}
                  templateProperties={templateProperties}
                  onChange={(val) => {
                    const next = [...(items as unknown[])];
                    next[index] = val;
                    onChange(next);
                  }}
                />
              </div>
            </div>
          ))}
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
                onChange={(val) => onChange({ ...currentValue, [key]: val })}
              />
            ))}
      </div>
    );
  }

  return <></>;
};

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
  onChange: (val: unknown) => void;
}> = ({ id, label, description, value, isRequired, onChange }) => {
  const [showPassword, setShowPassword] = React.useState(false);
  const currentValue = value || "";
  const hasExistingValue = currentValue.length > 0;

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={id}>
          {label} {isRequired && "*"}
        </Label>
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
          placeholder={hasExistingValue ? "••••••••" : "Enter secret value"}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showPassword ? (
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
      </div>
      {hasExistingValue && currentValue === "" && (
        <p className="text-xs text-muted-foreground">
          Leave empty to keep existing value
        </p>
      )}
    </div>
  );
};
