import type { SourcePosition, SourceRange } from "./types";

/**
 * Base error for all template-engine failures. Always carries a source
 * range so editors can render an inline marker.
 */
export class TemplateError extends Error {
  readonly range: SourceRange;
  readonly source: string;

  constructor(args: {
    message: string;
    source: string;
    range: SourceRange;
  }) {
    super(args.message);
    this.name = "TemplateError";
    this.range = args.range;
    this.source = args.source;
  }
}

export class TemplateParseError extends TemplateError {
  constructor(args: {
    message: string;
    source: string;
    range: SourceRange;
  }) {
    super(args);
    this.name = "TemplateParseError";
  }
}

export class TemplateRenderError extends TemplateError {
  /** Path of access that failed, when the failure was a missing reference. */
  readonly path?: string;

  constructor(args: {
    message: string;
    source: string;
    range: SourceRange;
    path?: string;
  }) {
    super(args);
    this.name = "TemplateRenderError";
    this.path = args.path;
  }
}

export class UnknownFilterError extends TemplateRenderError {
  readonly filterName: string;

  constructor(args: {
    filterName: string;
    source: string;
    range: SourceRange;
  }) {
    super({
      message: `Unknown filter "${args.filterName}"`,
      source: args.source,
      range: args.range,
    });
    this.name = "UnknownFilterError";
    this.filterName = args.filterName;
  }
}

/**
 * Construct a single-point range — useful when the parser knows where
 * something went wrong but not where the offending construct ended.
 */
export function pointRange(pos: SourcePosition): SourceRange {
  return { start: pos, end: pos };
}
