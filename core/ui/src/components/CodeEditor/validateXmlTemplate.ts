// Template-aware XML validation. See templateValidation.ts for the approach.
// There is no @codingame standalone XML language service (only Monarch
// highlighting), so we use fast-xml-parser's validator after template
// substitution. The validator reports the FIRST error only, with 1-based
// line/column, which we convert to an offset/range in the original text.
import { XMLValidator } from "fast-xml-parser";
import {
  lineColumnToOffset,
  substituteTemplates,
  type TemplateDiagnostic,
} from "./templateValidation";

/** Validate template-bearing XML. Empty content is allowed (no diagnostics). */
export const validateXmlTemplate = (
  text: string,
): TemplateDiagnostic[] => {
  const substituted = substituteTemplates(text);
  if (substituted.trim() === "") {
    return [];
  }
  const result = XMLValidator.validate(substituted, {
    allowBooleanAttributes: true,
  });
  if (result === true) {
    return [];
  }
  const { msg, line, col } = result.err;
  return [
    {
      offset: lineColumnToOffset({ text: substituted, line, column: col }),
      length: 1,
      message: `XML: ${msg}`,
    },
  ];
};
