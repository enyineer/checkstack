import { describe, expect, test } from "bun:test";
import {
  applyMarkdownAction,
  applyMentionSelection,
  findMentionQuery,
  isSameMentionQuery,
  MAX_MENTION_QUERY_LENGTH,
  PLACEHOLDER_TEXT,
  PLACEHOLDER_URL,
  type EditorSelection,
  type MarkdownAction,
} from "./MarkdownEditor.logic";

/** Build a selection from a string with `|` marking the caret / `[]` the range. */
function sel(value: string, start: number, end = start): EditorSelection {
  return { value, selectionStart: start, selectionEnd: end };
}

function apply(action: MarkdownAction, selection: EditorSelection) {
  return applyMarkdownAction({ action, selection });
}

describe("inline marks", () => {
  test("wraps the selection", () => {
    const result = apply("bold", sel("hello world", 6, 11));

    expect(result.value).toBe("hello **world**");
  });

  test("selects the body, not the marks, so typing replaces it", () => {
    const result = apply("bold", sel("hello world", 6, 11));

    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      "world",
    );
  });

  test("inserts a placeholder when nothing is selected", () => {
    const result = apply("italic", sel("", 0));

    expect(result.value).toBe(`*${PLACEHOLDER_TEXT}*`);
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      PLACEHOLDER_TEXT,
    );
  });

  test("unwraps when the marks are INSIDE the selection", () => {
    // A toolbar that only ever adds marks turns a mis-click into ****bold****.
    const result = apply("bold", sel("**word**", 0, 8));

    expect(result.value).toBe("word");
  });

  test("unwraps when the marks are OUTSIDE the selection", () => {
    const result = apply("bold", sel("**word**", 2, 6));

    expect(result.value).toBe("word");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      "word",
    );
  });

  test("round-trips: wrap then unwrap returns the original", () => {
    const original = sel("hello", 0, 5);
    const wrapped = apply("code", original);
    const unwrapped = apply("code", {
      value: wrapped.value,
      selectionStart: wrapped.selectionStart,
      selectionEnd: wrapped.selectionEnd,
    });

    expect(unwrapped.value).toBe(original.value);
  });

  test("italic does not mistake a bold marker for its own", () => {
    // `*` is a prefix of `**`; unwrapping naively would corrupt bold text.
    const result = apply("italic", sel("**word**", 2, 6));

    expect(result.value).toBe("***word***");
  });
});

describe("line prefixes", () => {
  test("prefixes every line the selection touches", () => {
    const result = apply("bulletList", sel("one\ntwo\nthree", 0, 7));

    expect(result.value).toBe("- one\n- two\nthree");
  });

  test("expands a partial selection to whole lines", () => {
    // Without expansion the `- ` would land mid-word.
    const result = apply("bulletList", sel("hello world", 6, 8));

    expect(result.value).toBe("- hello world");
  });

  test("removes the prefix when every line already has it", () => {
    const result = apply("bulletList", sel("- one\n- two", 0, 11));

    expect(result.value).toBe("one\ntwo");
  });

  test("adds rather than removes when only SOME lines have it", () => {
    const result = apply("bulletList", sel("- one\ntwo", 0, 9));

    expect(result.value).toBe("- - one\n- two");
  });

  test("quote uses its own prefix", () => {
    expect(apply("quote", sel("cited", 0, 5)).value).toBe("> cited");
  });

  test("leaves surrounding lines untouched", () => {
    const value = "keep\ntarget\nkeep";
    const result = apply("quote", sel(value, 5, 11));

    expect(result.value).toBe("keep\n> target\nkeep");
  });
});

describe("numbered list", () => {
  test("numbers the selected lines from 1", () => {
    const result = apply("numberedList", sel("one\ntwo\nthree", 0, 13));

    expect(result.value).toBe("1. one\n2. two\n3. three");
  });

  test("strips numbering when every line is already numbered", () => {
    const result = apply("numberedList", sel("1. one\n2. two", 0, 13));

    expect(result.value).toBe("one\ntwo");
  });

  test("renumbers from 1 rather than preserving stale numbers", () => {
    // Reordering lines then re-applying must produce a correct sequence.
    const stripped = apply("numberedList", sel("5. one\n9. two", 0, 13));
    const renumbered = apply("numberedList", {
      value: stripped.value,
      selectionStart: stripped.selectionStart,
      selectionEnd: stripped.selectionEnd,
    });

    expect(renumbered.value).toBe("1. one\n2. two");
  });
});

describe("link", () => {
  test("wraps the selection as the label and selects the URL", () => {
    const result = apply("link", sel("see docs", 4, 8));

    expect(result.value).toBe(`see [docs](${PLACEHOLDER_URL})`);
    // The URL is what the author still has to type, so it must be selected.
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      PLACEHOLDER_URL,
    );
  });

  test("uses a placeholder label when nothing is selected", () => {
    const result = apply("link", sel("", 0));

    expect(result.value).toBe(`[${PLACEHOLDER_TEXT}](${PLACEHOLDER_URL})`);
  });
});

describe("general invariants", () => {
  const actions: MarkdownAction[] = [
    "bold",
    "italic",
    "link",
    "code",
    "bulletList",
    "numberedList",
    "quote",
  ];

  test("every action returns a selection inside its own value", () => {
    for (const action of actions) {
      const result = apply(action, sel("sample text", 0, 6));

      expect(result.selectionStart).toBeGreaterThanOrEqual(0);
      expect(result.selectionEnd).toBeLessThanOrEqual(result.value.length);
      expect(result.selectionStart).toBeLessThanOrEqual(result.selectionEnd);
    }
  });

  test("no action ever loses text outside the selection", () => {
    for (const action of actions) {
      const result = apply(action, sel("prefix MIDDLE suffix", 7, 13));

      expect(result.value).toContain("prefix");
      expect(result.value).toContain("suffix");
    }
  });

  test("every action handles an empty document without throwing", () => {
    for (const action of actions) {
      expect(() => apply(action, sel("", 0))).not.toThrow();
    }
  });
});

describe("findMentionQuery", () => {
  const find = (value: string, caret = value.length) =>
    findMentionQuery({ value, caret });

  test("detects a trigger at the start of the document", () => {
    expect(find("#data")).toEqual({
      query: "data",
      triggerStart: 0,
      triggerEnd: 5,
    });
  });

  test("detects a trigger after whitespace", () => {
    expect(find("see also #db")?.query).toBe("db");
  });

  test("detects a bare `#` with no query yet", () => {
    expect(find("see #")?.query).toBe("");
  });

  test("does NOT fire on a markdown heading", () => {
    // Without the word-boundary rule every `## Impact` would open the picker.
    expect(find("## Impact")).toBeUndefined();
  });

  test("does NOT fire mid-word", () => {
    expect(find("issue#42")).toBeUndefined();
  });

  test("abandons the trigger once whitespace is typed", () => {
    // "#3 servers" is prose, not a mention.
    expect(find("#3 servers")).toBeUndefined();
  });

  test("does not span a newline", () => {
    expect(find("#one\ntwo")).toBeUndefined();
  });

  test("returns nothing when there is no `#` at all", () => {
    expect(find("plain prose")).toBeUndefined();
  });

  test("uses the caret, not the end of the document", () => {
    const value = "#db and more text";
    expect(findMentionQuery({ value, caret: 3 })?.query).toBe("db");
  });

  test("gives up on an over-long query", () => {
    const value = `#${"x".repeat(MAX_MENTION_QUERY_LENGTH + 5)}`;
    expect(find(value)).toBeUndefined();
  });

  test("fires after an opening bracket", () => {
    expect(find("(#db")?.query).toBe("db");
  });
});

describe("applyMentionSelection", () => {
  test("replaces the whole trigger with the mention markdown", () => {
    const value = "See also #db";
    const trigger = findMentionQuery({ value, caret: value.length });

    const result = applyMentionSelection({
      selection: { value, selectionStart: value.length, selectionEnd: value.length },
      trigger: trigger!,
      markdown: "[Database upgrade](checkstack:maintenance/m1)",
    });

    expect(result.value).toBe(
      "See also [Database upgrade](checkstack:maintenance/m1) ",
    );
  });

  test("leaves the caret after a trailing space, not back in the picker", () => {
    // Without the space the very next character would re-trigger the picker.
    const value = "#db";
    const trigger = findMentionQuery({ value, caret: 3 });

    const result = applyMentionSelection({
      selection: { value, selectionStart: 3, selectionEnd: 3 },
      trigger: trigger!,
      markdown: "[X](checkstack:incident/i1)",
    });

    expect(result.value.endsWith(" ")).toBe(true);
    expect(result.selectionStart).toBe(result.value.length);
    expect(result.selectionStart).toBe(result.selectionEnd);
  });

  test("preserves text after the trigger", () => {
    const value = "#db tail";
    const trigger = { query: "db", triggerStart: 0, triggerEnd: 3 };

    const result = applyMentionSelection({
      selection: { value, selectionStart: 3, selectionEnd: 3 },
      trigger,
      markdown: "[X](checkstack:incident/i1)",
    });

    expect(result.value).toBe("[X](checkstack:incident/i1)  tail");
  });
});

describe("isSameMentionQuery - keyboard navigation depends on this", () => {
  /**
   * REGRESSION GUARD. The editor re-runs trigger detection on every `keyup`,
   * including the arrow keys the open picker already consumed on `keydown`. It
   * used to treat every one of those as a change and reset the highlighted
   * option to the first, so the mention picker could not be navigated with the
   * keyboard at all: ArrowDown moved the highlight and the matching keyup put it
   * straight back, and Enter always inserted the first suggestion.
   *
   * Arrow keys are `preventDefault`ed while the picker is open, so the caret
   * does NOT move - which is exactly why "unchanged" has to be recognised.
   */
  const trigger = { query: "db", triggerStart: 4, triggerEnd: 7 };

  test("an identical trigger is the same (the arrow-key case)", () => {
    expect(isSameMentionQuery({ a: trigger, b: { ...trigger } })).toBe(true);
  });

  test("a longer query is a change", () => {
    expect(
      isSameMentionQuery({ a: trigger, b: { ...trigger, query: "dba" } }),
    ).toBe(false);
  });

  test("the same text at a different caret is a change", () => {
    // Two `#db` triggers in one document are different triggers.
    expect(
      isSameMentionQuery({
        a: trigger,
        b: { query: "db", triggerStart: 20, triggerEnd: 23 },
      }),
    ).toBe(false);
    expect(
      isSameMentionQuery({ a: trigger, b: { ...trigger, triggerEnd: 8 } }),
    ).toBe(false);
  });

  test("opening and closing the picker are changes", () => {
    expect(isSameMentionQuery({ a: null, b: trigger })).toBe(false);
    expect(isSameMentionQuery({ a: trigger, b: null })).toBe(false);
  });

  test("no trigger on either side is unchanged", () => {
    // Typing ordinary prose must not churn the picker state on every keystroke.
    expect(isSameMentionQuery({ a: null, b: null })).toBe(true);
  });
});
