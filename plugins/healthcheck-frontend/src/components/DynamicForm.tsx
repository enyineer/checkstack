import React from "react";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import Editor from "react-simple-code-editor";
// @ts-expect-error - prismjs doesn't have types for deep imports in some environments
import { highlight, languages } from "prismjs/components/prism-core";
import "prismjs/components/prism-json";

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
      // Syntax errors are expected while typing, so we show them but don't reset
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
              lastPropValue.current = parsed; // Prevent feedback loop
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

export const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  value,
  onChange,
}) => {
  if (!schema || !schema.properties) return <></>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChange = (key: string, val: any) => {
    onChange({ ...value, [key]: val });
  };

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ([key, propSchema]: [string, any]) => {
          const isRequired = schema.required?.includes(key);
          const label = key.charAt(0).toUpperCase() + key.slice(1);
          const description = propSchema.description || "";

          // Enum handling
          if (propSchema.enum) {
            return (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>
                  {label} {isRequired && "*"}
                </Label>
                <div className="relative">
                  <Select
                    value={value[key] || propSchema.default}
                    onValueChange={(val) => handleChange(key, val)}
                  >
                    <SelectTrigger id={key}>
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
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>
                  {label} {isRequired && "*"}
                </Label>
                <Input
                  id={key}
                  value={value[key] || ""}
                  onChange={(e) => handleChange(key, e.target.value)}
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
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>
                  {label} {isRequired && "*"}
                </Label>
                <Input
                  id={key}
                  type="number"
                  value={value[key] || propSchema.default || ""}
                  onChange={(e) =>
                    handleChange(
                      key,
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

          // Dictionary/Record (headers) - Fixed with local state string
          if (propSchema.type === "object" && propSchema.additionalProperties) {
            return (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>
                  {label} (JSON) {isRequired && "*"}
                </Label>
                <JsonField
                  id={key}
                  value={value[key]}
                  propSchema={propSchema}
                  onChange={(val) => handleChange(key, val)}
                />
                <p className="text-xs text-muted-foreground">
                  Complex configuration object.
                </p>
              </div>
            );
          }

          return;
        }
      )}
    </div>
  );
};
