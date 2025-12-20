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
} from "@checkmate/ui";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

interface DynamicFormProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any) => void;
}

const JsonField: React.FC<{
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  propSchema: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (val: any) => void;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  propSchema: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  isRequired?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (val: any) => void;
}> = ({ id, label, propSchema, value, isRequired, onChange }) => {
  const description = propSchema.description || "";

  // Enum handling
  if (propSchema.enum) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>
          {label} {isRequired && "*"}
        </Label>
        <div className="relative">
          <Select
            value={value || propSchema.default || ""}
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
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    );
  }

  // String
  if (propSchema.type === "string") {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>
          {label} {isRequired && "*"}
        </Label>
        <Input
          id={id}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            propSchema.default ? `Default: ${propSchema.default}` : ""
          }
        />
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    );
  }

  // Number
  if (propSchema.type === "number" || propSchema.type === "integer") {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>
          {label} {isRequired && "*"}
        </Label>
        <Input
          id={id}
          type="number"
          value={value === undefined ? propSchema.default || "" : value}
          onChange={(e) =>
            onChange(
              propSchema.type === "integer"
                ? Number.parseInt(e.target.value, 10)
                : Number.parseFloat(e.target.value)
            )
          }
        />
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    );
  }

  // Dictionary/Record (headers)
  if (propSchema.type === "object" && propSchema.additionalProperties) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>
          {label} (JSON) {isRequired && "*"}
        </Label>
        <JsonField
          id={id}
          value={value}
          propSchema={propSchema}
          onChange={(val) => onChange(val)}
        />
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            propSchema={subSchema as any}
            value={value?.[key]}
            isRequired={propSchema.required?.includes(key)}
            onChange={(val) => onChange({ ...value, [key]: val })}
          />
        ))}
      </div>
    );
  }

  // Array support
  if (propSchema.type === "array") {
    const items = value || [];
    const itemSchema = propSchema.items;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>
            {label} {isRequired && "*"}
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...items, {}])}
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
                    const next = [...items];
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
                    const next = [...items];
                    next[index] = val;
                    onChange(next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    );
  }

  return <></>;
};

export const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  value,
  onChange,
}) => {
  if (!schema || !schema.properties) return <></>;

  return (
    <div className="space-y-6">
      {Object.entries(schema.properties).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ([key, propSchema]: [string, any]) => {
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
        }
      )}
    </div>
  );
};
