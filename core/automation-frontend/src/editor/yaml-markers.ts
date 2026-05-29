import { parseDocument } from "yaml";
import type { EditorMarker } from "@checkstack/ui";

export interface DefinitionIssue {
  path: Array<string | number>;
  message: string;
}

/**
 * Map definition validation issues (and YAML syntax errors) onto inline
 * Monaco markers so the editor squiggles the exact offending node
 * instead of listing errors in a side panel.
 *
 * For each semantic issue we navigate the YAML document to the node at
 * the issue's `path` and use its source range. When the node doesn't
 * exist (e.g. a missing required field), we walk up the path to the
 * nearest existing ancestor and mark that — so the operator is pointed
 * at the right block even when the key itself is absent.
 *
 * Syntax errors come straight from the parser's own `errors` (which
 * carry source offsets), so malformed YAML is squiggled too.
 */
export function computeYamlMarkers(
  yamlText: string,
  issues: DefinitionIssue[],
): EditorMarker[] {
  const doc = parseDocument(yamlText, { keepSourceTokens: true });
  const markers: EditorMarker[] = [];

  // 1. Syntax errors from the parser.
  for (const error of doc.errors) {
    const [start, end] = error.pos;
    markers.push(rangeToMarker(yamlText, start, end, error.message));
  }

  // 2. Semantic issues mapped to their node's range.
  for (const issue of issues) {
    const range = resolveRange(doc, issue.path);
    if (range) {
      markers.push(
        rangeToMarker(yamlText, range[0], range[1], issue.message),
      );
    } else {
      // No node anywhere along the path — fall back to the document start.
      markers.push({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        severity: "error",
      });
    }
  }

  return markers;
}

type ParsedDocument = ReturnType<typeof parseDocument>;

/**
 * Find a source range for `path`, walking up to the nearest existing
 * ancestor when the exact node is missing.
 */
function resolveRange(
  doc: ParsedDocument,
  path: Array<string | number>,
): [number, number] | null {
  for (let length = path.length; length >= 0; length--) {
    const node =
      length === 0
        ? doc.contents
        : (doc.getIn(path.slice(0, length), true) as
            | { range?: [number, number, number] | null }
            | undefined);
    const range = node?.range;
    if (range) return [range[0], range[1]];
  }
  return null;
}

function rangeToMarker(
  text: string,
  start: number,
  end: number,
  message: string,
): EditorMarker {
  const from = offsetToLineCol(text, start);
  // Guarantee a non-empty highlight even for zero-width ranges.
  const to = offsetToLineCol(text, Math.max(end, start + 1));
  return {
    startLineNumber: from.line,
    startColumn: from.column,
    endLineNumber: to.line,
    endColumn: to.column,
    message,
    severity: "error",
  };
}

/** Convert a 0-based character offset to a 1-based Monaco line/column. */
function offsetToLineCol(
  text: string,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lastLineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line += 1;
      lastLineStart = i + 1;
    }
  }
  return { line, column: clamped - lastLineStart + 1 };
}
