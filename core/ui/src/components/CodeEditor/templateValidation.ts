// Shared bits for template-aware language validation (monaco -> @typefox
// migration). Markup editors (json / yaml / xml) hold a TEMPLATE that renders
// to the target language, not the language itself: a value can be templated in
// any position, including unquoted ones (e.g. a number `timeout: {{x}}`). So we
// validate "is this valid once the templates are filled in?" - substitute each
// `{{ ... }}` with a same-length neutral value, then parse with a real parser.
//
// Per-language validators live in validate{Json,Yaml,Xml}Template.ts and all
// return TemplateDiagnostic[]; the editor maps offsets to monaco markers.

export interface TemplateDiagnostic {
  /** 0-based character offset into the ORIGINAL text. */
  offset: number;
  /** Length of the offending span (>= 1). */
  length: number;
  /** Human-readable message. */
  message: string;
}

// `[^{}]*` (not `[^}]*`) so an unclosed `{{` can't swallow up to a later `}}`.
const TEMPLATE_PATTERN = /\{\{[^{}]*\}\}/g;

/**
 * Replace each `{{ ... }}` with `0` padded to the same length with spaces - a
 * neutral value token, valid in value positions (a number followed by
 * whitespace) and harmless inside strings/text. Same length keeps byte offsets
 * identical, so parser offsets map 1:1 onto the original text.
 */
export const substituteTemplates = (text: string): string =>
  text.replaceAll(
    TEMPLATE_PATTERN,
    (match) => `0${" ".repeat(match.length - 1)}`,
  );

/** Convert a 1-based line/column (some parsers report this) to a 0-based offset. */
export const lineColumnToOffset = ({
  text,
  line,
  column,
}: {
  text: string;
  line: number;
  column: number;
}): number => {
  const lines = text.split("\n");
  let offset = 0;
  for (let index = 0; index < line - 1 && index < lines.length; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1; // +1 for the newline
  }
  return offset + Math.max(column - 1, 0);
};
