// Pure helpers for the headless script validator (`validateScripts.ts`).
//
// Kept free of any `monaco` / browser import so this logic is unit-testable
// under bun. The browser-only worker glue lives in `validateScripts.ts` and
// composes these helpers.
//
// Strategy: to type-check a user script against its generated `context.d.ts`
// WITHOUT polluting the shared TS service's global scope (which would collide
// with any mounted editor's own `declare const context`), we PREPEND the
// generated type declarations onto the user's source and validate that single
// combined file. Inside one module/script file the prepended `declare const
// context` is in scope for the user's code below it, but it never leaks to
// other files. Diagnostics that land in the prepended region are dropped, and
// the rest are shifted back by the number of prepended lines so positions map
// onto the user's original source.

/** A type error/warning located in the user's original (un-prepended) source. */
export interface ScriptDiagnostic {
  severity: "error" | "warning";
  /** Flattened, human-readable message. */
  message: string;
  /** 1-based line in the user's source. */
  line: number;
  /** 1-based column. */
  column: number;
}

/**
 * Diagnostic codes ignored during headless validation because they reflect the
 * sandbox/loading model rather than a real mistake in the user's logic:
 *
 *  - 1108: a top-level `return` is legal (the runtime wraps scripts in an async
 *    IIFE) - same suppression the editor applies.
 *  - 2307 / 2792: "cannot find module 'x'". Type acquisition (ATA) is lazy and
 *    only runs for the editor that is open, so a collapsed-card script's
 *    imports have no fetched types yet. Flagging these would be a false
 *    positive, so module-resolution failures are not surfaced here (the
 *    backend typecheck - deferred - is the place to enforce imports).
 *  - 7016: "could not find a declaration file for module 'x'" - same reason.
 */
export const IGNORED_DIAGNOSTIC_CODES: ReadonlySet<number> = new Set([
  1108, 2307, 2792, 7016,
]);

// `ts.DiagnosticCategory`: Warning = 0, Error = 1, Suggestion = 2, Message = 3.
const CATEGORY_ERROR = 1;
const CATEGORY_WARNING = 0;

/**
 * Minimal shape of a TypeScript worker diagnostic (subset of monaco's
 * `Diagnostic`). `messageText` is either a string or a nested chain.
 */
export interface RawTsDiagnostic {
  start?: number;
  length?: number;
  messageText: string | DiagnosticMessageChain;
  category: number;
  code: number;
}

interface DiagnosticMessageChain {
  messageText: string;
  next?: DiagnosticMessageChain[];
}

/** Flatten a (possibly nested) diagnostic message chain to a single string. */
export function flattenDiagnosticMessage(
  messageText: string | DiagnosticMessageChain,
): string {
  if (typeof messageText === "string") {
    return messageText;
  }
  const parts: string[] = [];
  const walk = (chain: DiagnosticMessageChain): void => {
    parts.push(chain.messageText);
    for (const child of chain.next ?? []) {
      walk(child);
    }
  };
  walk(messageText);
  return parts.join(" ");
}

/** Convert a 0-based character offset into a 1-based {line, column}. */
export function offsetToPosition(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * Build the combined source to validate: the generated `typeDefinitions`
 * (the `declare const context` + any ambient augmentations) prepended to the
 * user's source. Returns the combined text plus the number of lines the prefix
 * occupies, so diagnostics can be shifted back onto the user's source.
 */
export function buildValidationSource({
  typeDefinitions,
  source,
}: {
  typeDefinitions: string;
  source: string;
}): { text: string; prependedLineCount: number } {
  // The prefix occupies one line per line of `typeDefinitions`; the trailing
  // "\n" we add then places the user's source on the next line. So the user's
  // line N maps to combined line N + prependedLineCount.
  const prependedLineCount = typeDefinitions.split("\n").length;
  return {
    text: `${typeDefinitions}\n${source}`,
    prependedLineCount,
  };
}

/**
 * Map raw worker diagnostics onto the user's source: drop ignored codes,
 * non-error/-warning categories, unpositioned (global) diagnostics, and any
 * that fall inside the prepended type-definition prefix; shift the rest back.
 */
export function mapWorkerDiagnostics({
  diagnostics,
  validationText,
  prependedLineCount,
}: {
  diagnostics: RawTsDiagnostic[];
  validationText: string;
  prependedLineCount: number;
}): ScriptDiagnostic[] {
  const result: ScriptDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (IGNORED_DIAGNOSTIC_CODES.has(diagnostic.code)) {
      continue;
    }
    const severity =
      diagnostic.category === CATEGORY_ERROR
        ? "error"
        : diagnostic.category === CATEGORY_WARNING
          ? "warning"
          : undefined;
    if (severity === undefined) {
      continue;
    }
    if (diagnostic.start === undefined) {
      // No position - a whole-file diagnostic. Not attributable to a user line,
      // and the inline strategy shouldn't produce these; skip.
      continue;
    }
    const position = offsetToPosition(validationText, diagnostic.start);
    if (position.line <= prependedLineCount) {
      // Lands in the generated prefix, not the user's code.
      continue;
    }
    result.push({
      severity,
      message: flattenDiagnosticMessage(diagnostic.messageText),
      line: position.line - prependedLineCount,
      column: position.column,
    });
  }
  return result;
}
