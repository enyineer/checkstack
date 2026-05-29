// Stage 2b (monaco-editor -> @typefox/monaco-editor-react migration).
//
// The standalone TS worker calls `getCompletionsAtPosition` with no options
// (tsWorker.js: `getCompletionsAtPosition(fileName, position, void 0)`), so it
// never surfaces object members whose keys are not valid JS identifiers (e.g.
// artifact ids like `integration-jira.issue`). The built-in SuggestAdapter also
// hardcodes `insertText: entry.name` and can't be overridden, so a custom TS
// worker is not viable. Instead we register our own completion provider that
// offers those keys as `["key"]` bracket completions.
//
// To stay TYPE-DRIVEN (and avoid threading a separate `dottedKeyCompletions`
// prop), this module derives the groups straight from the injected
// `context.d.ts`: it finds object members whose property name is a quoted,
// non-identifier string and reports the dotted access path to their parent
// object plus the list of such keys.

/** A parent object plus the non-identifier keys reachable under it. */
export interface BracketKeyGroup {
  /** Member-access expression preceding the dot, e.g. `context.artifacts`. */
  objectExpression: string;
  /** Keys to offer; each is inserted as `["<key>"]`. */
  keys: string[];
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

const isIdentifier = (name: string): boolean => IDENTIFIER_RE.test(name);

const isWhitespace = (ch: string): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/**
 * Extract bracket-notation completion groups from generated TS type
 * definitions. Walks the `declare const <rootName>: { ... }` object literal,
 * tracking the dotted path as it descends, and records every property whose
 * name is a quoted non-identifier string.
 *
 * The walk is a small purpose-built scanner (not a full TS parser): it is only
 * ever fed our own generated `context.d.ts`, whose shape is a plain nested
 * object type. It correctly ignores string-literal type *values* (e.g.
 * `status: "open" | "closed"`), JSDoc/line comments, and the `readonly` /
 * optional (`?`) modifiers. Keys nested under a non-identifier parent are
 * skipped because no dotted `objectExpression` can address them.
 */
export const extractBracketKeyGroups = ({
  typeDefinitions,
  rootName = "context",
}: {
  typeDefinitions: string;
  rootName?: string;
}): BracketKeyGroup[] => {
  const src = typeDefinitions;
  // Locate `declare const <rootName>` then the opening `{` of its type.
  const declMatch = new RegExp(
    String.raw`declare\s+const\s+${rootName}\b`,
  ).exec(src);
  if (!declMatch) {
    return [];
  }
  let i = src.indexOf("{", declMatch.index + declMatch[0].length);
  if (i === -1) {
    return [];
  }

  // Insertion-ordered accumulation so output is stable for tests/snapshots.
  const groups = new Map<string, string[]>();
  const addKey = (objectExpression: string, key: string): void => {
    const existing = groups.get(objectExpression);
    if (existing) {
      if (!existing.includes(key)) {
        existing.push(key);
      }
    } else {
      groups.set(objectExpression, [key]);
    }
  };

  // path[k] / dottable[k] describe the object open at brace depth k+1.
  const path: string[] = [rootName];
  const dottable: boolean[] = [true];
  let depth = 1; // we consume the root `{` below
  i += 1; // step past the root object's opening brace

  // The property name most recently parsed, awaiting its value. Used to label
  // the object we descend into on the next `{`.
  let pendingName: { value: string; identifier: boolean } | null = null;

  const peekNonWs = (from: number): number => {
    let j = from;
    while (j < src.length && isWhitespace(src[j] ?? "")) {
      j += 1;
    }
    return j;
  };

  while (i < src.length && depth > 0) {
    const ch = src[i] ?? "";

    // Comments.
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }

    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    // String token: either a property name (if followed by `:`) or a
    // type-position literal (e.g. a union member) which we ignore.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let str = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") {
          str += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        str += src[j];
        j += 1;
      }
      const afterStr = j + 1; // past closing quote
      // A quoted property name may be optional: `"key"?: ...` (this is exactly
      // how generated artifact keys look, e.g. `"integration-jira.issue"?:`).
      let colon = peekNonWs(afterStr);
      if (src[colon] === "?") {
        colon = peekNonWs(colon + 1);
      }
      if (src[colon] === ":") {
        // Quoted property name. Record under the current object when every
        // ancestor segment is dot-addressable.
        if (dottable.every(Boolean) && !isIdentifier(str)) {
          addKey(path.join("."), str);
        }
        pendingName = { value: str, identifier: isIdentifier(str) };
        i = colon + 1;
      } else {
        // Type-position string literal - not a key.
        i = afterStr;
      }
      continue;
    }

    // Identifier: a property name (if followed by `:`, allowing an optional
    // `?`) or a type keyword / modifier we skip.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j] ?? "")) {
        j += 1;
      }
      const word = src.slice(i, j);
      let after = peekNonWs(j);
      if (src[after] === "?") {
        after = peekNonWs(after + 1);
      }
      if (src[after] === ":") {
        pendingName = { value: word, identifier: true };
        i = after + 1;
      } else {
        // `readonly`, `string`, `interface`, etc. - not a key for us.
        i = j;
      }
      continue;
    }

    if (ch === "{") {
      depth += 1;
      path.push(pendingName?.value ?? "");
      dottable.push(pendingName?.identifier ?? false);
      pendingName = null;
      i += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      path.pop();
      dottable.pop();
      pendingName = null;
      i += 1;
      continue;
    }

    // End of a property's value (e.g. `: string;`) - the pending name had a
    // non-object type, so it never labels a descent.
    if (ch === ";" || ch === ",") {
      pendingName = null;
    }
    i += 1;
  }

  return [...groups].map(([objectExpression, keys]) => ({
    objectExpression,
    keys,
  }));
};
