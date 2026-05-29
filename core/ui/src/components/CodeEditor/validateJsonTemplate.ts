// Template-aware JSON validation. See templateValidation.ts for the approach.
// The real VS Code JSON service still provides highlighting + completion; only
// its built-in (raw-text) validation is turned off in favour of this, so `{{ }}`
// is tolerated in any position (including unquoted, e.g. a numeric value).
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import {
  substituteTemplates,
  type TemplateDiagnostic,
} from "./templateValidation";

/** Validate template-bearing JSON. Empty content is allowed (no diagnostics). */
export const validateJsonTemplate = (
  text: string,
): TemplateDiagnostic[] => {
  const errors: ParseError[] = [];
  parse(substituteTemplates(text), errors, {
    allowEmptyContent: true,
    allowTrailingComma: false,
    disallowComments: true,
  });
  return errors.map((parseError) => ({
    offset: parseError.offset,
    length: Math.max(parseError.length, 1),
    message: `JSON: ${printParseErrorCode(parseError.error)}`,
  }));
};
