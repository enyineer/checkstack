/**
 * Per-stream trace-id / span-id extraction for sources that do not emit W3C ids
 * natively (plain-text native lines, syslog, arbitrary JSON shapes). Applied at
 * flush time (the one seam every ingest path converges on) ONLY when the line
 * does not already carry the id - OTLP ids and the native reserved keys always
 * win. A pure module: no IO, browser-safe (only type imports + `RegExp`).
 *
 * Each field's rule is tried as: attribute paths in order (dot-notation into the
 * line's attributes; the first STRING hit wins), then a body regex whose first
 * capture group is the id. Extracted ids are trimmed, dash-stripped and
 * lowercased; an empty or over-long id is discarded.
 */

import {
  MAX_EXTRACTED_TRACE_ID_LENGTH,
  TRACE_EXTRACTION_BODY_SLICE,
  type TraceExtractionFieldRule,
  type TraceExtractionRules,
} from "../schemas";

/** A field rule with its body regex compiled once (or null if it can't compile). */
interface CompiledFieldRule {
  attributePaths: string[];
  bodyRegex: RegExp | null;
}

/**
 * A stream's extraction rules with every `bodyRegex` compiled ONCE (per config
 * application), so the flush loop never re-compiles per line. `null` when the
 * stream declares no usable rule.
 */
export interface CompiledTraceExtraction {
  traceId: CompiledFieldRule | null;
  spanId: CompiledFieldRule | null;
}

/**
 * Compile a stream's {@link TraceExtractionRules} once. Returns `null` when
 * neither field has a usable rule (no attribute paths and no compilable regex),
 * so a caller can cheaply skip extraction entirely. A `bodyRegex` that fails to
 * compile at apply time is treated as absent (the schema validates it at parse,
 * but a persisted config is still guarded here).
 */
export function compileTraceExtraction(
  rules: TraceExtractionRules | undefined,
): CompiledTraceExtraction | null {
  if (!rules) return null;
  const traceId = compileFieldRule(rules.traceId);
  const spanId = compileFieldRule(rules.spanId);
  if (!traceId && !spanId) return null;
  return { traceId, spanId };
}

function compileFieldRule(
  rule: TraceExtractionFieldRule | undefined,
): CompiledFieldRule | null {
  if (!rule) return null;
  const attributePaths = rule.attributePaths ?? [];
  let bodyRegex: RegExp | null = null;
  if (rule.bodyRegex) {
    try {
      bodyRegex = new RegExp(rule.bodyRegex);
    } catch {
      // A non-compiling rule is treated as absent (defensive; the schema
      // already validates compilation + a capture group at parse time).
      bodyRegex = null;
    }
  }
  if (attributePaths.length === 0 && !bodyRegex) return null;
  return { attributePaths, bodyRegex };
}

/**
 * Resolve a line's trace/span ids, NORMALIZING a natively-carried id and, only
 * when the line lacks a usable one, filling it from the compiled rules.
 *
 * A carried id (from OTLP or the native reserved keys) is normalized the SAME
 * way an extracted id is - so a native `"4BF92F35-7B34-..."` matches the
 * lowercase, dash-stripped W3C id tracestream stores, and both persistence and
 * the exact-match queries agree. A carried id that normalizes to nothing (empty
 * string, all-whitespace/dashes, or over-long) is treated as ABSENT: extraction
 * may then fill it, and it never lands in storage as a `''` that would sit
 * unqueryable in the partial index. Runs for every stored line (even with no
 * rules) precisely so carried ids are always normalized at this one seam.
 */
export function applyTraceExtraction({
  compiled,
  attributes,
  body,
  traceId,
  spanId,
}: {
  compiled: CompiledTraceExtraction | null;
  attributes: Record<string, unknown> | undefined;
  body: string;
  traceId: string | undefined;
  spanId: string | undefined;
}): { traceId: string | undefined; spanId: string | undefined } {
  return {
    traceId: resolveId({
      carried: traceId,
      rule: compiled?.traceId ?? null,
      attributes,
      body,
    }),
    spanId: resolveId({
      carried: spanId,
      rule: compiled?.spanId ?? null,
      attributes,
      body,
    }),
  };
}

function resolveId({
  carried,
  rule,
  attributes,
  body,
}: {
  carried: string | undefined;
  rule: CompiledFieldRule | null;
  attributes: Record<string, unknown> | undefined;
  body: string;
}): string | undefined {
  const normalizedCarried =
    carried === undefined ? undefined : normalizeTraceId(carried);
  // A carried id that survives normalization wins (OTLP / reserved-key ids); a
  // carried id that normalizes to nothing is treated as absent so a rule may
  // still fill it.
  if (normalizedCarried !== undefined) return normalizedCarried;
  return extractField({ rule, attributes, body });
}

function extractField({
  rule,
  attributes,
  body,
}: {
  rule: CompiledFieldRule | null;
  attributes: Record<string, unknown> | undefined;
  body: string;
}): string | undefined {
  if (!rule) return undefined;

  // Attribute paths first: the first path whose value is a string wins.
  for (const path of rule.attributePaths) {
    const value = getByPath({ attributes, path });
    if (typeof value === "string") {
      return normalizeTraceId(value);
    }
  }

  // Then the body regex, run against at most the leading slice. The slice bounds
  // the LINEAR scan cost on a huge line; it does NOT bound catastrophic
  // backtracking (which is exponential in match-attempt length, independent of
  // slice size). Backtracking safety is enforced UPSTREAM when the rule is saved
  // (see `regex-safety.ts` / `assessRegexSafety`); `compileFieldRule`'s
  // try/catch only guards a persisted rule that no longer compiles.
  if (rule.bodyRegex) {
    const slice =
      body.length > TRACE_EXTRACTION_BODY_SLICE
        ? body.slice(0, TRACE_EXTRACTION_BODY_SLICE)
        : body;
    const match = rule.bodyRegex.exec(slice);
    const captured = match?.[1];
    if (typeof captured === "string") {
      return normalizeTraceId(captured);
    }
  }

  return undefined;
}

/**
 * Normalize a trace/span id to its canonical stored form: trim, strip dashes,
 * lowercase. Returns `undefined` (the id is discarded / treated as absent) when
 * it is empty or longer than {@link MAX_EXTRACTED_TRACE_ID_LENGTH} chars after
 * normalization. Applied to BOTH extracted ids and natively-carried ids so
 * storage and the exact-match queries share one canonical form; a query input
 * is normalized through the same function before it is compared.
 */
export function normalizeTraceId(raw: string): string | undefined {
  const normalized = raw.trim().replaceAll("-", "").toLowerCase();
  if (normalized.length === 0) return undefined;
  if (normalized.length > MAX_EXTRACTED_TRACE_ID_LENGTH) return undefined;
  return normalized;
}

/**
 * Resolve a dot-notation path into a line's attributes. A literal flat key is
 * tried first (syslog emits dotted flat keys like `host.name`), then nested
 * object traversal (native JSON keeps nested shapes, e.g. `ctx.trace_id` reaches
 * `attributes.ctx.trace_id`). Returns `undefined` for a missing path.
 */
function getByPath({
  attributes,
  path,
}: {
  attributes: Record<string, unknown> | undefined;
  path: string;
}): unknown {
  if (!attributes) return undefined;
  if (Object.prototype.hasOwnProperty.call(attributes, path)) {
    return attributes[path];
  }
  const parts = path.split(".");
  let current: unknown = attributes;
  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    // The cast is the standard narrowing for a checked plain object: TS cannot
    // narrow `object` to an index-signature type without one (the guard above
    // excludes null/arrays/non-objects).
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, part)) return undefined;
    current = record[part];
  }
  return current;
}
