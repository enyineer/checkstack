import type { VariableEntry, VariableScope } from "@checkstack/automation-common";
import { toShellEnvKey } from "@checkstack/automation-common";
import type { ShellEnvVar } from "@checkstack/ui";
import type { CompletionField, CompletionFilter } from "./template-completion";

/**
 * Built-in template filters shipped by the engine. Mirrors the registry
 * built in `@checkstack/template-engine` → `createDefaultFilterRegistry`.
 * Drives the "filter" stage of staged completion (after a `|`).
 *
 * Hand-written rather than auto-derived so we can supply human-readable
 * signatures + short descriptions (the engine stores only the function).
 */
export const TEMPLATE_FILTERS: readonly CompletionFilter[] = [
  { name: "default", signature: "fallback", description: "Substitute when null / undefined / empty.", hasArgs: true },
  { name: "upper", description: "Uppercase a string." },
  { name: "lower", description: "Lowercase a string." },
  { name: "capitalize", description: "Capitalise the first letter." },
  { name: "trim", description: "Strip leading + trailing whitespace." },
  { name: "truncate", signature: "length", description: "Truncate to N chars, append …", hasArgs: true },
  { name: "length", description: "Length of a string / array / object." },
  { name: "json", description: "Stringify a value as JSON." },
  { name: "iso", description: "Format a date as ISO-8601." },
  { name: "date", signature: "format", description: 'Format: "ISO" | "date" | "time" | "unix" | "rfc2822".', hasArgs: true },
  { name: "join", signature: "separator", description: 'Join an array (default ", ").', hasArgs: true },
  { name: "replace", signature: "search, replacement", description: "Replace every occurrence.", hasArgs: true },
  { name: "not", description: "Negate truthiness." },
];

/**
 * Map the in-scope completion fields to the `$CHECKSTACK_*` env vars a
 * shell script action receives. Uses the shared {@link toShellEnvKey}
 * rule so the `$` names suggested here are exactly the ones the backend
 * injects at run time.
 */
export function fieldsToShellEnvVars(
  fields: readonly CompletionField[],
): ShellEnvVar[] {
  return fields.map((field) => ({
    name: toShellEnvKey(field.path),
    description: field.type ? `${field.path} (${field.type})` : field.path,
  }));
}

/**
 * Flatten a resolved `VariableScope` to the leaf fields the completion
 * provider offers in its "field" stage. Object-typed parents are
 * skipped — operators interpolate leaf values, not whole objects. Each
 * leaf carries its `enumValues` (when the schema declared an `enum`) so
 * the provider's "value" stage can suggest concrete comparisons.
 */
export function flattenScopeToFields(scope: VariableScope): CompletionField[] {
  const out: CompletionField[] = [];
  const visit = (entries: readonly VariableEntry[]): void => {
    for (const entry of entries) {
      if (entry.children && entry.children.length > 0) {
        visit(entry.children);
        continue;
      }
      out.push({
        path: entry.path,
        type: entry.type,
        description: entry.description,
        enumValues: extractEnum(entry.jsonSchema),
      });
    }
  };
  visit(scope.entries);
  return out;
}

function extractEnum(
  jsonSchema: Record<string, unknown> | undefined,
): Array<string | number | boolean> | undefined {
  const candidate = jsonSchema?.enum;
  if (!Array.isArray(candidate)) return undefined;
  const usable = candidate.filter(
    (v): v is string | number | boolean =>
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean",
  );
  return usable.length > 0 ? usable : undefined;
}
