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
  Tooltip,
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
      <div className="min-h-[100px] w-full rounded-md border border-gray-300 bg-white font-mono text-sm focus-within:ring-2 focus-within:ring-indigo-600 focus-within:border-transparent transition-all overflow-hidden box-border">
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
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
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
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
          {cleanDesc && <Tooltip content={cleanDesc} />}
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
    const cleanDesc = getCleanDescription(description);

    if (isTextarea) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={id}>
              {label} {isRequired && "*"}
            </Label>
            {cleanDesc && <Tooltip content={cleanDesc} />}
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

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
          {cleanDesc && <Tooltip content={cleanDesc} />}
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
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
          {cleanDesc && <Tooltip content={cleanDesc} />}
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

  // Dictionary/Record (headers)
  if (propSchema.type === "object" && propSchema.additionalProperties) {
    const cleanDesc = getCleanDescription(description);
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>
            {label} (JSON) {isRequired && "*"}
          </Label>
          {cleanDesc && <Tooltip content={cleanDesc} />}
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
      <div className="space-y-4 p-4 border rounded-lg bg-gray-50/50">
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
          <div className="flex items-center gap-1.5">
            <Label>
              {label} {isRequired && "*"}
            </Label>
            {cleanDesc && <Tooltip content={cleanDesc} />}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([...(items as Record<string, unknown>[]), {}])
            }
            className="h-8 gap-1 transition-all hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200"
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
              <div className="p-4 border rounded-lg bg-white shadow-sm border-gray-200 transition-all hover:border-gray-300">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const next = [...(items as unknown[])];
                    next.splice(index, 1);
                    onChange(next);
                  }}
                  className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-white border shadow-sm text-red-500 hover:text-red-600 hover:bg-red-50"
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

  if (!schema || !schema.properties) return <></>;

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
