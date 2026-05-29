import type { Expr, TemplateNode } from "./ast";
import {
  TemplateRenderError,
  UnknownFilterError,
} from "./errors";
import {
  createDefaultFilterRegistry,
  isTruthy,
} from "./filters";
import type {
  FilterRegistry,
  ParsedCondition,
  ParsedTemplate,
  SourceRange,
  TemplateContext,
} from "./types";

export interface RenderOptions {
  /**
   * Custom filter registry. Defaults to the built-in registry. Pass a
   * pre-loaded registry when integrating with extra plugin-contributed
   * filters.
   */
  filters?: FilterRegistry;
  /**
   * When true, accessing an undefined path throws instead of resolving to
   * the empty string. Default: false (graceful missing → empty string).
   * The dispatch engine flips this on at certain audit-critical sites.
   */
  strict?: boolean;
}

/**
 * Render a parsed template to a string. Handles literal segments and
 * `{{ expression }}` interpolation. Unknown identifiers resolve to the
 * empty string by default (operators see this as a missing value).
 */
export function render(
  template: ParsedTemplate,
  context: TemplateContext,
  options: RenderOptions = {},
): string {
  const filters = options.filters ?? createDefaultFilterRegistry();
  let out = "";
  const nodes = template.nodes as TemplateNode[];
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.value;
      continue;
    }
    const value = evaluateExpr(
      node.expression,
      context,
      template.source,
      filters,
      options,
    );
    out += stringify(value);
  }
  return out;
}

/**
 * Evaluate a parsed condition expression against context and return the
 * raw value. Use `isTruthy()` to coerce to boolean if needed.
 */
export function evaluate(
  condition: ParsedCondition,
  context: TemplateContext,
  options: RenderOptions = {},
): unknown {
  const filters = options.filters ?? createDefaultFilterRegistry();
  return evaluateExpr(
    condition.root,
    context,
    condition.source,
    filters,
    options,
  );
}

/**
 * Evaluate a condition and coerce to boolean using the engine's truthiness
 * rule. Convenience over `evaluate()` for the common case.
 */
export function evaluateBoolean(
  condition: ParsedCondition,
  context: TemplateContext,
  options: RenderOptions = {},
): boolean {
  return isTruthy(evaluate(condition, context, options));
}

// ─── Internal evaluator ────────────────────────────────────────────────────

function evaluateExpr(
  expr: Expr,
  context: TemplateContext,
  source: string,
  filters: FilterRegistry,
  options: RenderOptions,
): unknown {
  switch (expr.kind) {
    case "literal": {
      return expr.value;
    }

    case "identifier": {
      return resolveIdentifier(expr.name, context, expr.range, source, options);
    }

    case "member": {
      const obj = evaluateExpr(expr.object, context, source, filters, options);
      return resolveMember(obj, expr.property, expr.range, source, options);
    }

    case "index": {
      const obj = evaluateExpr(expr.object, context, source, filters, options);
      const key = evaluateExpr(expr.index, context, source, filters, options);
      return resolveMember(obj, String(key ?? ""), expr.range, source, options);
    }

    case "unary": {
      return !isTruthy(
        evaluateExpr(expr.operand, context, source, filters, options),
      );
    }

    case "binary": {
      const left = evaluateExpr(expr.left, context, source, filters, options);
      // Short-circuit logical operators
      if (expr.op === "&&") {
        if (!isTruthy(left)) return left;
        return evaluateExpr(expr.right, context, source, filters, options);
      }
      if (expr.op === "||") {
        if (isTruthy(left)) return left;
        return evaluateExpr(expr.right, context, source, filters, options);
      }
      const right = evaluateExpr(expr.right, context, source, filters, options);
      return applyComparison(expr.op, left, right);
    }

    case "ternary": {
      return isTruthy(
        evaluateExpr(expr.condition, context, source, filters, options),
      )
        ? evaluateExpr(expr.consequent, context, source, filters, options)
        : evaluateExpr(expr.alternate, context, source, filters, options);
    }

    case "pipe": {
      const value = evaluateExpr(expr.value, context, source, filters, options);
      const filter = filters.get(expr.filter);
      if (!filter) {
        throw new UnknownFilterError({
          filterName: expr.filter,
          source,
          range: expr.range,
        });
      }
      const args = expr.args.map((a) =>
        evaluateExpr(a, context, source, filters, options),
      );
      return filter(value, ...args);
    }
  }
}

function resolveIdentifier(
  name: string,
  context: TemplateContext,
  range: SourceRange,
  source: string,
  options: RenderOptions,
): unknown {
  if (Object.prototype.hasOwnProperty.call(context, name)) {
    return (context as Record<string, unknown>)[name];
  }
  if (options.strict) {
    throw new TemplateRenderError({
      message: `Unknown reference "${name}"`,
      source,
      range,
      path: name,
    });
  }
  return undefined;
}

function resolveMember(
  object: unknown,
  property: string,
  range: SourceRange,
  source: string,
  options: RenderOptions,
): unknown {
  if (object === null || object === undefined) {
    if (options.strict) {
      throw new TemplateRenderError({
        message: `Cannot access "${property}" of ${object === null ? "null" : "undefined"}`,
        source,
        range,
        path: property,
      });
    }
    return undefined;
  }
  if (typeof object !== "object") return undefined;
  return (object as Record<string, unknown>)[property];
}

function applyComparison(
  op: "==" | "!=" | "<" | ">" | "<=" | ">=",
  left: unknown,
  right: unknown,
): boolean {
  switch (op) {
    case "==": {
      return looseEquals(left, right);
    }
    case "!=": {
      return !looseEquals(left, right);
    }
    case "<": {
      return compareNumeric(left, right) < 0;
    }
    case ">": {
      return compareNumeric(left, right) > 0;
    }
    case "<=": {
      return compareNumeric(left, right) <= 0;
    }
    case ">=": {
      return compareNumeric(left, right) >= 0;
    }
  }
}

/**
 * Equality used by `==`. Strings compare by content, numbers by value,
 * and across types coerced to string when one side is a string. Mirrors
 * what operators expect when comparing event ids to literals.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return a === b;
  if (b === null || b === undefined) return false;
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
}

function compareNumeric(a: unknown, b: unknown): number {
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  }
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}
