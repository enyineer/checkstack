import { describe, expect, it } from "bun:test";
import {
  buildValidationSource,
  flattenDiagnosticMessage,
  mapWorkerDiagnostics,
  offsetToPosition,
  type RawTsDiagnostic,
} from "./scriptDiagnostics";

describe("offsetToPosition", () => {
  it("returns 1-based line/column", () => {
    const text = "ab\ncde\nf";
    expect(offsetToPosition(text, 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToPosition(text, 1)).toEqual({ line: 1, column: 2 });
    // offset 3 is the 'c' (first char after the first newline)
    expect(offsetToPosition(text, 3)).toEqual({ line: 2, column: 1 });
    expect(offsetToPosition(text, 7)).toEqual({ line: 3, column: 1 });
  });

  it("clamps an out-of-range offset to the text length", () => {
    expect(offsetToPosition("ab", 999)).toEqual({ line: 1, column: 3 });
  });
});

describe("flattenDiagnosticMessage", () => {
  it("passes through a plain string", () => {
    expect(flattenDiagnosticMessage("boom")).toBe("boom");
  });

  it("flattens a nested chain depth-first", () => {
    expect(
      flattenDiagnosticMessage({
        messageText: "top",
        next: [
          { messageText: "child-a" },
          { messageText: "child-b", next: [{ messageText: "grandchild" }] },
        ],
      }),
    ).toBe("top child-a child-b grandchild");
  });
});

describe("buildValidationSource", () => {
  it("prepends the type defs and reports the prefix line count", () => {
    const { text, prependedLineCount } = buildValidationSource({
      typeDefinitions: "declare const context: { x: number };", // 1 line
      source: "context.x;",
    });
    expect(prependedLineCount).toBe(1);
    expect(text).toBe("declare const context: { x: number };\ncontext.x;");
  });

  it("counts multi-line type defs", () => {
    const { prependedLineCount } = buildValidationSource({
      typeDefinitions: "line1\nline2\nline3",
      source: "x",
    });
    expect(prependedLineCount).toBe(3);
  });
});

describe("mapWorkerDiagnostics", () => {
  // 2 lines of type defs prepended; user source starts at combined line 3.
  const { text, prependedLineCount } = buildValidationSource({
    typeDefinitions: "declare const context: {\n  readonly a: number;\n};",
    source: "const z = context.b;\n", // `b` doesn't exist -> error on user line 1
  });

  const errorOffset = text.indexOf("context.b") + "context.".length; // points at `b`

  it("shifts a real type error back onto the user's source line", () => {
    const diagnostics: RawTsDiagnostic[] = [
      {
        start: errorOffset,
        length: 1,
        category: 1, // Error
        code: 2339,
        messageText: "Property 'b' does not exist on type",
      },
    ];
    const mapped = mapWorkerDiagnostics({
      diagnostics,
      validationText: text,
      prependedLineCount,
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      severity: "error",
      line: 1,
      message: "Property 'b' does not exist on type",
    });
  });

  it("drops ignored codes (lazy-ATA module resolution, top-level return)", () => {
    const diagnostics: RawTsDiagnostic[] = [
      { start: errorOffset, category: 1, code: 2307, messageText: "Cannot find module 'lodash'" },
      { start: errorOffset, category: 1, code: 1108, messageText: "A 'return' statement" },
    ];
    expect(
      mapWorkerDiagnostics({ diagnostics, validationText: text, prependedLineCount }),
    ).toEqual([]);
  });

  it("drops diagnostics that land inside the prepended type-def prefix", () => {
    const diagnostics: RawTsDiagnostic[] = [
      { start: 0, category: 1, code: 2300, messageText: "noise in generated types" },
    ];
    expect(
      mapWorkerDiagnostics({ diagnostics, validationText: text, prependedLineCount }),
    ).toEqual([]);
  });

  it("drops non-error/-warning categories and unpositioned diagnostics", () => {
    const diagnostics: RawTsDiagnostic[] = [
      { start: errorOffset, category: 2, code: 9999, messageText: "suggestion" },
      { category: 1, code: 2339, messageText: "global, no position" },
    ];
    expect(
      mapWorkerDiagnostics({ diagnostics, validationText: text, prependedLineCount }),
    ).toEqual([]);
  });

  it("keeps warnings", () => {
    const diagnostics: RawTsDiagnostic[] = [
      { start: errorOffset, category: 0, code: 6133, messageText: "'z' is declared but never read" },
    ];
    const mapped = mapWorkerDiagnostics({
      diagnostics,
      validationText: text,
      prependedLineCount,
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.severity).toBe("warning");
  });
});
