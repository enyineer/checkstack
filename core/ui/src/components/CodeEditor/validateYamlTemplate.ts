// Template-aware YAML validation. See templateValidation.ts for the approach.
// There is no @codingame standalone YAML language service (only Monarch
// highlighting), so we parse with the `yaml` package after template
// substitution. YAML is permissive (it often parses `{{ }}` as a flow
// collection), but substitution gives accurate structural validation and still
// catches real mistakes (bad indentation, tabs, duplicate keys, ...).
import { parseDocument } from "yaml";
import {
  substituteTemplates,
  type TemplateDiagnostic,
} from "./templateValidation";

/** Validate template-bearing YAML. */
export const validateYamlTemplate = (
  text: string,
): TemplateDiagnostic[] => {
  const doc = parseDocument(substituteTemplates(text), {
    prettyErrors: false,
  });
  return doc.errors.map((error) => {
    const [start, end] = error.pos;
    return {
      offset: start,
      length: Math.max(end - start, 1),
      message: `YAML: ${error.message}`,
    };
  });
};
