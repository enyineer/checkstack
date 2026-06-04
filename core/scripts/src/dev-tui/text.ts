/**
 * Pure text helpers for the dev runner. DOM-free and dependency-free so they
 * can be unit-tested with `bun:test` and reused by the (thin) ink components.
 */

const ESC = String.fromCodePoint(27); // ASCII 27, start of every ANSI escape sequence.

/**
 * Remove ANSI escape sequences from a string so downstream parsing (log-level
 * detection, width measurement) sees plain text.
 *
 * Implemented as a small scanner rather than a control-character regex: it
 * skips `ESC [ ... <final>` CSI sequences (colors, cursor moves, erases) and
 * the shorter `ESC <byte>` two-character escapes, copying everything else
 * verbatim.
 */
export function stripAnsi(input: string): string {
  if (!input.includes(ESC)) {
    return input;
  }

  let result = "";
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char !== ESC) {
      result += char;
      index += 1;
      continue;
    }

    const next = input[index + 1];
    if (next === "[") {
      // CSI sequence: parameters/intermediates until a final byte in 0x40..0x7E.
      let cursor = index + 2;
      while (cursor < input.length) {
        const code = input.codePointAt(cursor) ?? 0;
        cursor += 1;
        if (code >= 0x40 && code <= 0x7E) {
          // CSI final byte reached.
          break;
        }
      }
      index = cursor;
      continue;
    }

    // Two-character escape (e.g. ESC c). Skip the ESC and the following byte.
    index += next === undefined ? 1 : 2;
  }

  return result;
}

export interface LineSplitter {
  (chunk: string): string[];
  /** Emit any buffered remainder that never terminated with a newline. */
  flush(): string[];
}

/**
 * Create a stateful splitter that turns an arbitrary stream of chunks into
 * whole lines. Partial lines are buffered across chunks and CRLF / lone CR are
 * normalized away so terminal redraw sequences do not produce phantom lines.
 */
export function createLineSplitter(): LineSplitter {
  let buffer = "";

  const split: LineSplitter = (chunk: string): string[] => {
    buffer += chunk;
    const lines: string[] = [];
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex);
      lines.push(normalizeLine(rawLine));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
    return lines;
  };

  split.flush = (): string[] => {
    if (buffer.length === 0) {
      return [];
    }
    const remainder = normalizeLine(buffer);
    buffer = "";
    return [remainder];
  };

  return split;
}

/**
 * Drop carriage returns from a single (already newline-split) line. A trailing
 * CR is the CRLF tail; an interior CR is a redraw cursor-return that we collapse
 * so the visible text is preserved.
 */
function normalizeLine(line: string): string {
  return line.replaceAll("\r", "");
}
