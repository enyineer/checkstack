import React from "react";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import Editor from "react-simple-code-editor";
// @ts-expect-error - prismjs doesn't have types for deep imports in some environments
import { highlight, languages } from "prismjs/components/prism-core";
import "prismjs/components/prism-json";
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
  EmptyState,
  Toggle,
} from "../index";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaProperty;
  format?: string;
  default?: unknown;
  "x-secret"?: boolean; // Custom metadata for secret fields
}

export interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface DynamicFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

const JsonField: React.FC<{
  id: string;
  value: Record<string, unknown>;
  propSchema: JsonSchemaProperty;
  onChange: (val: Record<string, unknown>) => void;
}> = ({ id, value, propSchema, onChange }) => {
  const [internalValue, setInternalValue] = React.useState(
    JSON.stringify(value || {}, undefined, 2)
  );
  const [error, setError] = React.useState<string | undefined>();
  const lastPropValue = React.useRef(value);

  const validateFn = React.useMemo(() => {
    try {
      return ajv.compile(propSchema);
    } catch {
      return;
    }
  }, [propSchema]);

  // Sync internal value ONLY when external value changes from outside
  React.useEffect(() => {
    const valueString = JSON.stringify(value);
    const lastValueString = JSON.stringify(lastPropValue.current);

    if (valueString !== lastValueString) {
      setInternalValue(JSON.stringify(value || {}, undefined, 2));
      lastPropValue.current = value;
      setError(undefined);
    }
  }, [value]);

  const validate = (val: string) => {
    try {
      const parsed = JSON.parse(val);
      if (!validateFn) {
        setError(undefined);
        return parsed;
      }

      const valid = validateFn(parsed);
      if (!valid) {
        setError(
          validateFn.errors
            ?.map((e) => `${e.instancePath} ${e.message}`)
            .join(", ")
        );
        return false;
      }
      setError(undefined);
      return parsed;
    } catch (error_: unknown) {
      setError(`Invalid JSON: ${(error_ as Error).message}`);
      return false;
    }
  };

  return (
    <div className="space-y-2">
      <div className="min-h-[100px] w-full rounded-md border border-input bg-background font-mono text-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all overflow-hidden box-border">
        <Editor
          id={id}
          value={internalValue}
          onValueChange={(code) => {
            setInternalValue(code);
            const parsed = validate(code);
            if (parsed !== false) {
              lastPropValue.current = parsed;
              onChange(parsed);
            }
          }}
          highlight={(code) => highlight(code, languages.json)}
          padding={10}
          style={{
            minHeight: "100px",
          }}
        />
      </div>
      {error && <p className="text-xs text-destructive font-medium">{error}</p>}
    </div>
  );
};

// Recursive Field Renderer
const FormField: React.FC<{
  id: string;
  label: string;
  propSchema: JsonSchemaProperty;
  value: unknown;
  isRequired?: boolean;
  onChange: (val: unknown) => void;
}> = ({ id, label, propSchema, value, isRequired, onChange }) => {
  const description = propSchema.description || "";

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
            onValueChange={(val) => onChange(val)}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={`Select ${label}`} />
            </SelectTrigger>
            <SelectContent>
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

    if (isTextarea) {
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
      const [showPassword, setShowPassword] = React.useState(false);
      const currentValue = (value as string) || "";
      const hasExistingValue = currentValue.length > 0;

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
    }

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
                : Number.parseFloat(e.target.value)
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
              onChange([...(items as Record<string, unknown>[]), {}])
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

  return <></>;
};

const getCleanDescription = (description?: string) => {
  if (!description || description === "textarea") return;
  const cleaned = description.replace("[textarea]", "").trim();
  if (!cleaned) return;
  return cleaned;
};

/**
 * Extracts default values from a JSON schema recursively.
 */
const extractDefaults = (schema: JsonSchema): Record<string, unknown> => {
  const defaults: Record<string, unknown> = {};

  if (!schema.properties) return defaults;

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (propSchema.default !== undefined) {
      defaults[key] = propSchema.default;
    } else if (propSchema.type === "object" && propSchema.properties) {
      // Recursively extract defaults for nested objects
      defaults[key] = extractDefaults(propSchema as JsonSchema);
    } else if (propSchema.type === "array") {
      // Arrays default to empty array
      defaults[key] = [];
    }
  }

  return defaults;
};

export const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  value,
  onChange,
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
      {Object.entries(schema.properties).map(([key, propSchema]) => {
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
            onChange={(val) => onChange({ ...value, [key]: val })}
          />
        );
      })}
    </div>
  );
};
