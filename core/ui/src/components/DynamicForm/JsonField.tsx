import React from "react";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import Editor from "react-simple-code-editor";
// @ts-expect-error - prismjs doesn't have types for deep imports in some environments
import { highlight, languages } from "prismjs/components/prism-core";
import "prismjs/components/prism-json";

import type { JsonFieldProps } from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * A JSON editor field with syntax highlighting and schema validation.
 */
export const JsonField: React.FC<JsonFieldProps> = ({
  id,
  value,
  propSchema,
  onChange,
}) => {
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
