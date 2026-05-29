/**
 * Public types for the template engine.
 *
 * The template engine is used in two contexts:
 *
 *   1. Server-side at automation dispatch time — render the actual values
 *      for provider config fields, choose conditions, condition guards, etc.
 *   2. Client-side at edit time — preview the rendered output against a
 *      sample context for UX validation.
 *
 * Both contexts share this surface.
 */

/**
 * The context object an expression is rendered against.
 *
 * Keys typically include `trigger`, `nodes`, `config`, `variables`, plus
 * platform helpers like `now()`.
 *
 * Unknown is used at the value level because the shape depends on the
 * automation's topology (which triggers / upstream artifacts are in scope).
 */
export type TemplateContext = Record<string, unknown>;

/**
 * A parsed template program — opaque to consumers. Pass it to `render()`.
 */
export interface ParsedTemplate {
  /** Discriminator so future versions can detect mismatch. */
  readonly version: 1;
  /** Internal AST nodes (kept as `unknown` to avoid exposing internals). */
  readonly nodes: ReadonlyArray<unknown>;
  /** Original source text — kept for error message context. */
  readonly source: string;
}

/**
 * A parsed condition expression — opaque to consumers. Pass it to `evaluate()`.
 *
 * Conditions are pure expressions (no surrounding literal text), unlike
 * full templates which interleave text and `{{ ... }}` segments.
 */
export interface ParsedCondition {
  readonly version: 1;
  readonly root: import("./ast").Expr;
  readonly source: string;
}

/**
 * A position in source text. 1-indexed line and column, matching what
 * editors expect.
 */
export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * A source range — start and end position pair.
 */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/**
 * Built-in filter signature.
 *
 * A filter is invoked as `value | name` or `value | name(arg1, arg2)`. The
 * first argument is always the piped value; remaining are literal args
 * from the call site.
 */
export type Filter = (value: unknown, ...args: unknown[]) => unknown;

/**
 * Filter registry — name → implementation mapping.
 */
export interface FilterRegistry {
  register(name: string, filter: Filter): void;
  get(name: string): Filter | undefined;
  has(name: string): boolean;
  list(): string[];
}
