/**
 * Staged, context-aware autocomplete for template / condition
 * expressions.
 *
 * Rather than pre-computing snippets, the provider parses the
 * in-progress expression up to the cursor and decides what the operator
 * most plausibly wants next:
 *
 *   1. **field** — typing an identifier → offer in-scope paths.
 *   2. **operator** — just finished a field (or any operand) → offer
 *      comparators (`==`, `!=`, …), logical connectors (`&&`, `||`) and
 *      the filter pipe (`|`).
 *   3. **value** — just typed a comparator → offer that field's known
 *      values (enum members, or `true` / `false` for booleans).
 *   4. **filter** — just typed `|` → offer the built-in filters.
 *
 * The analyzer (`analyzeExpression`) is a pure function over the
 * expression substring; `createTemplateCompletionProvider` wraps it with
 * the field / filter catalogue and maps offsets back into the full
 * field value. Both are unit-tested.
 */
import type {
  TemplateCompletionItem,
  TemplateCompletionProvider,
  TemplateCompletionResult,
} from "@checkstack/ui";

export interface CompletionField {
  /** Dot path, e.g. `trigger.payload.severity`. */
  path: string;
  /** Type label shown on the right. */
  type: string;
  description?: string;
  /** Known discrete values (enum / boolean) — drives the value stage. */
  enumValues?: Array<string | number | boolean>;
}

export interface CompletionFilter {
  name: string;
  /** Human-readable signature, e.g. `value, fallback`. */
  signature?: string;
  description?: string;
  /** True when the filter takes arguments — drives `name()` + caret-inside insertion. */
  hasArgs?: boolean;
}

/** Comparators offered in the operator stage, longest-first for the tokenizer. */
const COMPARATORS = ["==", "!=", "<=", ">=", "<", ">"] as const;
const LOGICAL = ["&&", "||"] as const;

// ─── Tokenizer ─────────────────────────────────────────────────────────────

type TokenType =
  | "path"
  | "number"
  | "string"
  | "op"
  | "pipe"
  | "lparen"
  | "rparen"
  | "comma"
  | "ws";

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

const OPERATORS_BY_LENGTH = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "!"];

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;

    // Whitespace
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /\s/.test(expr[j]!)) j++;
      tokens.push({ type: "ws", value: expr.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // Strings (single or double quoted). Tolerate an unterminated
    // closing quote — the operator is still typing.
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) {
        if (expr[j] === "\\") j++;
        j++;
      }
      // Include the closing quote when present.
      const end = j < expr.length ? j + 1 : j;
      tokens.push({ type: "string", value: expr.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    // Pipe (must check before logical `||`)
    if (ch === "|" && expr[i + 1] !== "|") {
      tokens.push({ type: "pipe", value: "|", start: i, end: i + 1 });
      i += 1;
      continue;
    }

    // Multi/!single-char operators
    const op = OPERATORS_BY_LENGTH.find((o) => expr.startsWith(o, i));
    if (op) {
      tokens.push({ type: "op", value: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    // Number
    if (/\d/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[\d.]/.test(expr[j]!)) j++;
      tokens.push({ type: "number", value: expr.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // Path / identifier (allow dots + trailing dot while typing)
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_.]/.test(expr[j]!)) j++;
      tokens.push({ type: "path", value: expr.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // Unknown char — skip it as a 1-char ws-like token so we don't loop.
    tokens.push({ type: "ws", value: ch, start: i, end: i + 1 });
    i += 1;
  }
  return tokens;
}

// ─── Analyzer ────────────────────────────────────────────────────────────

export type ExprStage =
  | { kind: "field"; tokenStart: number; query: string }
  | { kind: "operator"; tokenStart: number }
  | {
      kind: "value";
      tokenStart: number;
      fieldPath: string;
      query: string;
      quoted: boolean;
    }
  | { kind: "filter"; tokenStart: number; query: string };

const isComparator = (token: Token | undefined): boolean =>
  token?.type === "op" && (COMPARATORS as readonly string[]).includes(token.value);

/**
 * Classify the completion stage for an expression substring whose end
 * is the cursor. `tokenStart` is the offset (within `expr`) where the
 * text to be replaced begins; the replace-end is always `expr.length`.
 */
export function analyzeExpression(expr: string): ExprStage {
  const tokens = tokenize(expr);
  const cursor = expr.length;
  const nonWs = tokens.filter((t) => t.type !== "ws");
  const trailingWs = expr.length > 0 && /\s$/.test(expr);
  const last = nonWs.at(-1);
  // The partial token actively being typed: the final non-ws token when
  // there's no whitespace between it and the cursor.
  const partial = !trailingWs && last && last.end === cursor ? last : undefined;
  const beforePartial = partial
    ? nonWs[nonWs.indexOf(partial) - 1]
    : last;

  // 1. Filter stage — after a pipe.
  if (partial && partial.type === "path" && beforePartial?.type === "pipe") {
    return { kind: "filter", tokenStart: partial.start, query: partial.value };
  }
  if (!partial && last?.type === "pipe") {
    return { kind: "filter", tokenStart: cursor, query: "" };
  }

  // 2. Value stage — after a comparator.
  if (!partial && isComparator(last)) {
    return {
      kind: "value",
      tokenStart: cursor,
      fieldPath: pathBefore(nonWs, nonWs.length - 1),
      query: "",
      quoted: false,
    };
  }
  if (partial && isComparator(beforePartial)) {
    const quoted = partial.type === "string";
    return {
      kind: "value",
      tokenStart: partial.start,
      fieldPath: pathBefore(nonWs, nonWs.indexOf(partial) - 1),
      query: quoted ? stripQuotes(partial.value) : partial.value,
      quoted,
    };
  }

  // 3. Operator stage — a completed operand followed by whitespace.
  if (
    trailingWs &&
    last &&
    (last.type === "path" ||
      last.type === "string" ||
      last.type === "number" ||
      last.type === "rparen")
  ) {
    return { kind: "operator", tokenStart: cursor };
  }

  // 4. Field stage (default).
  if (partial && partial.type === "path") {
    return { kind: "field", tokenStart: partial.start, query: partial.value };
  }
  return { kind: "field", tokenStart: cursor, query: "" };
}

function pathBefore(nonWs: Token[], index: number): string {
  for (let i = index; i >= 0; i--) {
    if (nonWs[i]!.type === "path") return nonWs[i]!.value;
  }
  return "";
}

function stripQuotes(value: string): string {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return value;
  let inner = value.slice(1);
  if (inner.endsWith(quote)) inner = inner.slice(0, -1);
  return inner;
}

// ─── Provider factory ──────────────────────────────────────────────────────

export interface CreateCompletionProviderArgs {
  fields: CompletionField[];
  filters: CompletionFilter[];
  /**
   * `template` — the value is text with `{{ … }}` blocks; completion
   * only fires inside an (un)closed block. `expression` — the whole
   * value is a single bare expression (used by condition editors).
   */
  mode: "template" | "expression";
}

/**
 * Locate the expression window that the cursor sits in.
 *
 * - expression mode: the whole value, starting at 0.
 * - template mode: the text inside the `{{` that most recently opened
 *   before the cursor and hasn't been closed by a `}}` before the
 *   cursor. Returns null when the cursor isn't inside a `{{ … }}`.
 *
 * `closed` reports whether a `}}` already exists after the cursor for
 * this block (so field insertion can append one when missing).
 */
function locateExpression(
  value: string,
  cursor: number,
  mode: "template" | "expression",
): { exprStart: number; closed: boolean } | null {
  if (mode === "expression") {
    return { exprStart: 0, closed: true };
  }
  const before = value.slice(0, cursor);
  const open = before.lastIndexOf("{{");
  if (open === -1) return null;
  const closeBefore = before.lastIndexOf("}}");
  if (closeBefore > open) return null; // the latest `{{` was already closed
  const exprStart = open + 2;
  const closed = value.includes("}}", cursor);
  return { exprStart, closed };
}

export function createTemplateCompletionProvider(
  args: CreateCompletionProviderArgs,
): TemplateCompletionProvider {
  const { fields, filters, mode } = args;

  return ({ value, cursor }): TemplateCompletionResult | null => {
    const window = locateExpression(value, cursor, mode);
    if (!window) return null;

    const expr = value.slice(window.exprStart, cursor);
    const stage = analyzeExpression(expr);
    const replaceStart = window.exprStart + stage.tokenStart;
    const replaceEnd = cursor;

    switch (stage.kind) {
      case "field": {
        return fieldResult({
          stage,
          fields,
          replaceStart,
          replaceEnd,
          appendClose: mode === "template" && !window.closed,
        });
      }
      case "operator": {
        return operatorResult({ replaceStart, replaceEnd });
      }
      case "value": {
        return valueResult({ stage, fields, replaceStart, replaceEnd });
      }
      case "filter": {
        return filterResult({ stage, filters, replaceStart, replaceEnd });
      }
    }
  };
}

function fieldResult(args: {
  stage: Extract<ExprStage, { kind: "field" }>;
  fields: CompletionField[];
  replaceStart: number;
  replaceEnd: number;
  appendClose: boolean;
}): TemplateCompletionResult | null {
  const { stage, fields, replaceStart, replaceEnd, appendClose } = args;
  const q = stage.query.toLowerCase();
  const matches = fields.filter(
    (f) => q === "" || f.path.toLowerCase().includes(q),
  );
  if (matches.length === 0) return null;
  return {
    heading: "Fields",
    replaceStart,
    replaceEnd,
    items: matches.map((f) => {
      // Always append a trailing space so the caret lands in
      // whitespace after the field — that re-opens completion in the
      // operator stage (comparators / filters) automatically, the same
      // way picking a comparator advances to the value stage.
      if (appendClose) {
        // Unclosed `{{` — also append the closing braces, and land the
        // caret after the space but before `}}` (offset -2 into ` }}`).
        return {
          label: f.path,
          detail: f.type,
          description: f.description,
          insertText: `${f.path} }}`,
          caretOffset: -2,
        } satisfies TemplateCompletionItem;
      }
      return {
        label: f.path,
        detail: f.type,
        description: f.description,
        insertText: `${f.path} `,
        caretOffset: 0,
      } satisfies TemplateCompletionItem;
    }),
  };
}

function operatorResult(args: {
  replaceStart: number;
  replaceEnd: number;
}): TemplateCompletionResult {
  const { replaceStart, replaceEnd } = args;
  const items: TemplateCompletionItem[] = [
    ...COMPARATORS.map((op) => ({
      label: op,
      detail: "comparator",
      insertText: `${op} `,
    })),
    ...LOGICAL.map((op) => ({
      label: op,
      detail: "logical",
      insertText: `${op} `,
    })),
    {
      label: "|",
      detail: "filter pipe",
      description: "Apply a filter to the value.",
      insertText: "| ",
    },
  ];
  return { heading: "Operators", replaceStart, replaceEnd, items };
}

function valueResult(args: {
  stage: Extract<ExprStage, { kind: "value" }>;
  fields: CompletionField[];
  replaceStart: number;
  replaceEnd: number;
}): TemplateCompletionResult | null {
  const { stage, fields, replaceStart, replaceEnd } = args;
  const field = fields.find((f) => f.path === stage.fieldPath);
  const values = possibleValues(field);
  if (!values || values.length === 0) return null;

  const q = stage.query.toLowerCase();
  const matches = values.filter(
    (v) => q === "" || String(v.raw).toLowerCase().includes(q),
  );
  if (matches.length === 0) return null;

  return {
    heading: field ? `Values for ${field.path}` : "Values",
    replaceStart,
    replaceEnd,
    items: matches.map((v) => ({
      label: v.display,
      detail: typeof v.raw,
      insertText: v.insert,
    })),
  };
}

function possibleValues(
  field: CompletionField | undefined,
): Array<{ raw: string | number | boolean; display: string; insert: string }> | null {
  if (!field) return null;
  if (field.enumValues && field.enumValues.length > 0) {
    return field.enumValues.map((raw) => ({
      raw,
      display: typeof raw === "string" ? `"${raw}"` : String(raw),
      insert: typeof raw === "string" ? JSON.stringify(raw) : String(raw),
    }));
  }
  // Boolean fields have a known closed value set even without an enum.
  if (field.type === "boolean") {
    return [
      { raw: true, display: "true", insert: "true" },
      { raw: false, display: "false", insert: "false" },
    ];
  }
  return null;
}

function filterResult(args: {
  stage: Extract<ExprStage, { kind: "filter" }>;
  filters: CompletionFilter[];
  replaceStart: number;
  replaceEnd: number;
}): TemplateCompletionResult | null {
  const { stage, filters, replaceStart, replaceEnd } = args;
  const q = stage.query.toLowerCase();
  const matches = filters.filter(
    (f) => q === "" || f.name.toLowerCase().includes(q),
  );
  if (matches.length === 0) return null;
  return {
    heading: "Filters",
    replaceStart,
    replaceEnd,
    items: matches.map((f) => ({
      label: f.signature ? `${f.name}(${f.signature})` : f.name,
      detail: "filter",
      description: f.description,
      insertText: f.hasArgs ? `${f.name}()` : f.name,
      caretOffset: f.hasArgs ? -1 : 0,
    })),
  };
}
