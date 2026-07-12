import React, { useEffect, useMemo } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Input,
} from "@checkstack/ui";
import type {
  JsonSchemaBase,
  JsonSchemaPropertyBase,
} from "@checkstack/common";
import type { CollectorAssertion } from "@checkstack/healthcheck-common";
import { Plus, X } from "lucide-react";
import {
  extractAssertableFields,
  findFieldByPath,
  operatorOptionsForField,
  seedAssertion,
  validateAssertion,
  duplicateAssertionIndexes,
  assertionsAreValid,
  VALUE_LESS_OPERATORS,
  type AssertableField,
} from "./assertion-builder.logic";

type JsonSchema = JsonSchemaBase<JsonSchemaPropertyBase>;

interface AssertionBuilderProps {
  resultSchema: JsonSchema;
  assertions: CollectorAssertion[];
  onChange: (assertions: CollectorAssertion[]) => void;
  /**
   * Reports whether every condition is complete/savable. Incomplete rows
   * (missing value, bad regex, blank JSONPath) block the editor's Save via
   * the same validity plumbing as the collector config form.
   */
  onValidChange?: (isValid: boolean) => void;
}

/** Compact inline control sizing shared by the sentence-row parts. */
const inlineTrigger = "h-8 w-auto min-w-28 gap-1 text-sm";
const inlineInput = "h-8 text-sm";

const renderFieldOptions = (list: AssertableField[]) =>
  list.map((f) => (
    <SelectItem key={f.path} value={f.path}>
      {f.label}
    </SelectItem>
  ));

/**
 * Assertion builder: each condition reads as a sentence with inline
 * controls - `[Response Time ▾] must [be less than ▾] [500] ms`. Field
 * names, units, and boolean phrasing come from the collector's chart
 * annotations (`x-chart-label`, `x-chart-unit`, true/false labels), so the
 * builder speaks the collector's language instead of raw paths. JSONPath
 * conditions are grouped under "Advanced".
 */
export const AssertionBuilder: React.FC<AssertionBuilderProps> = ({
  resultSchema,
  assertions,
  onChange,
  onValidChange,
}) => {
  const fields = useMemo(
    () => extractAssertableFields({ schema: resultSchema }),
    [resultSchema],
  );
  const plainFields = fields.filter((f) => !f.advanced);
  const advancedFields = fields.filter((f) => f.advanced);

  const duplicates = useMemo(
    () => duplicateAssertionIndexes({ assertions }),
    [assertions],
  );

  const allValid = useMemo(
    () => assertionsAreValid({ assertions, fields }),
    [assertions, fields],
  );
  useEffect(() => {
    onValidChange?.(allValid);
  }, [allValid, onValidChange]);

  const handleAdd = () => {
    const seeded = seedAssertion({ fields });
    if (!seeded) return;
    onChange([...assertions, seeded]);
  };

  const handleRemove = (index: number) => {
    const updated = [...assertions];
    updated.splice(index, 1);
    onChange(updated);
  };

  const handleFieldChange = (index: number, fieldPath: string) => {
    const field = findFieldByPath({ fields, path: fieldPath });
    if (!field) return;
    const [firstOperator] = operatorOptionsForField({ field });
    const updated = [...assertions];
    updated[index] = {
      field: fieldPath,
      operator: firstOperator.value,
      value: undefined,
    };
    onChange(updated);
  };

  const handleOperatorChange = (index: number, operator: string) => {
    const updated = [...assertions];
    updated[index] = { ...updated[index], operator };
    if (VALUE_LESS_OPERATORS.has(operator)) {
      updated[index].value = undefined;
    }
    onChange(updated);
  };

  const handleValueChange = (index: number, value: unknown) => {
    const updated = [...assertions];
    updated[index] = { ...updated[index], value };
    onChange(updated);
  };

  const handleJsonPathChange = (index: number, jsonPath: string) => {
    const updated = [...assertions];
    updated[index] = { ...updated[index], jsonPath };
    onChange(updated);
  };

  if (fields.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        This check item does not expose any fields to assert on.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assertions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This check item passes as long as the probe succeeds. Add conditions
          to also assert on the result - for example that the status code
          equals 200 or the response time stays low.
        </p>
      ) : (
        <div className="rounded-md border divide-y">
          {assertions.map((assertion, index) => {
            const field = findFieldByPath({ fields, path: assertion.field });
            const operators = field ? operatorOptionsForField({ field }) : [];
            const needsValue = !VALUE_LESS_OPERATORS.has(assertion.operator);
            const issue = validateAssertion({ assertion, fields });
            const isDuplicate = duplicates.has(index);

            // Guard Radix against values that no longer exist as options
            // (e.g. a field removed from the collector's schema).
            const fieldValueValid = !!field;
            const operatorValueValid = operators.some(
              (op) => op.value === assertion.operator,
            );

            return (
              <div key={index} className="p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Field */}
                  <Select
                    value={fieldValueValid ? assertion.field : undefined}
                    onValueChange={(v) => handleFieldChange(index, v)}
                  >
                    <SelectTrigger
                      className={inlineTrigger}
                      aria-label="Field"
                    >
                      <SelectValue placeholder="Pick a field…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>{renderFieldOptions(plainFields)}</SelectGroup>
                      {advancedFields.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Advanced</SelectLabel>
                          {renderFieldOptions(advancedFields)}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>

                  {/* JSONPath expression (advanced fields only) */}
                  {field?.type === "jsonpath" && (
                    <>
                      <span className="text-sm text-muted-foreground">at</span>
                      <Input
                        value={assertion.jsonPath ?? ""}
                        onChange={(e) =>
                          handleJsonPathChange(index, e.target.value)
                        }
                        placeholder="$.path.to.value"
                        aria-label="JSONPath expression"
                        className={`${inlineInput} w-44 font-mono`}
                      />
                    </>
                  )}

                  <span className="text-sm text-muted-foreground">must</span>

                  {/* Condition */}
                  <Select
                    value={
                      operatorValueValid ? assertion.operator : undefined
                    }
                    onValueChange={(v) => handleOperatorChange(index, v)}
                  >
                    <SelectTrigger
                      className={inlineTrigger}
                      aria-label="Condition"
                    >
                      <SelectValue placeholder="Pick a condition…" />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Expected value */}
                  {needsValue &&
                    (field?.type === "enum" && field.enumValues ? (
                      <Select
                        value={String(assertion.value ?? "")}
                        onValueChange={(v) => handleValueChange(index, v)}
                      >
                        <SelectTrigger
                          className={inlineTrigger}
                          aria-label="Expected value"
                        >
                          <SelectValue placeholder="Pick a value…" />
                        </SelectTrigger>
                        <SelectContent>
                          {field.enumValues.map((v) => (
                            <SelectItem key={String(v)} value={String(v)}>
                              {String(v)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field?.type === "number" ? (
                      <>
                        <Input
                          type="number"
                          value={(assertion.value as number) ?? ""}
                          onChange={(e) =>
                            handleValueChange(
                              index,
                              e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            )
                          }
                          placeholder="0"
                          aria-label="Expected value"
                          className={`${inlineInput} w-24`}
                        />
                        {field.unit && (
                          <span className="text-sm text-muted-foreground">
                            {field.unit}
                          </span>
                        )}
                      </>
                    ) : (
                      <Input
                        value={String(assertion.value ?? "")}
                        onChange={(e) =>
                          handleValueChange(index, e.target.value)
                        }
                        placeholder={
                          assertion.operator === "matches"
                            ? "regex pattern"
                            : "value"
                        }
                        aria-label="Expected value"
                        className={`${inlineInput} w-36 ${
                          assertion.operator === "matches" ? "font-mono" : ""
                        }`}
                      />
                    ))}

                  {/* Remove */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(index)}
                    aria-label="Remove condition"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Row hints */}
                {issue && <p className="text-xs text-destructive">{issue}</p>}
                {!issue && isDuplicate && (
                  <p className="text-xs text-muted-foreground">
                    Duplicate of an earlier condition - it has no extra effect.
                  </p>
                )}
                {!issue && field?.type === "jsonpath" && (
                  <p className="text-xs text-muted-foreground">
                    Reads a value out of {field.label} as JSON, e.g.{" "}
                    <code className="rounded bg-muted px-1">
                      $.data.items[0].status
                    </code>
                  </p>
                )}
                {!issue && assertion.operator === "matches" && (
                  <p className="text-xs text-muted-foreground">
                    Regular expression, e.g.{" "}
                    <code className="rounded bg-muted px-1">^2\d\d$</code>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button type="button" variant="ghost" size="sm" onClick={handleAdd}>
        <Plus className="h-4 w-4 mr-2" />
        Add condition
      </Button>
    </div>
  );
};
