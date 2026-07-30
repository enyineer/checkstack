/**
 * Pure text transforms behind the markdown toolbar.
 *
 * Kept DOM-free so every edge case (empty selection, multi-line selection,
 * toggling a mark off again) is unit-testable without mounting a textarea. The
 * component only reads the selection off the DOM and writes the result back.
 */

/** A textarea's value plus its selection range. */
export interface EditorSelection {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** The toolbar actions offered. */
export type MarkdownAction =
  | "bold"
  | "italic"
  | "link"
  | "code"
  | "bulletList"
  | "numberedList"
  | "quote";

/** Inline marks that wrap a selection symmetrically. */
const INLINE_MARKS: Partial<Record<MarkdownAction, string>> = {
  bold: "**",
  italic: "*",
  code: "`",
};

/** Line prefixes. `numberedList` renumbers, so it is handled separately. */
const LINE_PREFIXES: Partial<Record<MarkdownAction, string>> = {
  bulletList: "- ",
  quote: "> ",
};

/** Placeholder inserted when a mark is applied to an empty selection. */
export const PLACEHOLDER_TEXT = "text";

export function applyMarkdownAction({
  action,
  selection,
}: {
  action: MarkdownAction;
  selection: EditorSelection;
}): EditorSelection {
  const mark = INLINE_MARKS[action];
  if (mark) return toggleInlineMark({ mark, selection });

  const prefix = LINE_PREFIXES[action];
  if (prefix) return toggleLinePrefix({ prefix, selection });

  if (action === "numberedList") return toggleNumberedList({ selection });
  if (action === "link") return insertLink({ selection });

  return selection;
}

/**
 * Wrap the selection in `mark`, or UNWRAP it when it is already wrapped.
 *
 * Toggling matters: a toolbar that can only add marks turns a mis-click into
 * `****bold****`, and the author has to fix it by hand.
 */
function toggleInlineMark({
  mark,
  selection,
}: {
  mark: string;
  selection: EditorSelection;
}): EditorSelection {
  const { value, selectionStart, selectionEnd } = selection;
  const selected = value.slice(selectionStart, selectionEnd);
  const markChar = mark[0];

  // Already wrapped INSIDE the selection: `**bold**` selected whole.
  //
  // The run lengths must match the mark EXACTLY. `*` is a prefix of `**`, so a
  // plain `startsWith`/`endsWith` check makes italic "unwrap" bold text and
  // silently turn `**word**` into `*word*` - destroying the author's emphasis.
  if (
    selected.length > mark.length * 2 &&
    runLength({ text: selected, index: 0, step: 1, markChar }) ===
      mark.length &&
    runLength({
      text: selected,
      index: selected.length - 1,
      step: -1,
      markChar,
    }) === mark.length
  ) {
    const unwrapped = selected.slice(mark.length, -mark.length);
    return {
      value: value.slice(0, selectionStart) + unwrapped + value.slice(selectionEnd),
      selectionStart,
      selectionEnd: selectionStart + unwrapped.length,
    };
  }

  // Already wrapped OUTSIDE the selection: `**bold**` with only `bold` selected.
  // Same exact-run requirement, for the same reason.
  const runBefore = runLength({
    text: value,
    index: selectionStart - 1,
    step: -1,
    markChar,
  });
  const runAfter = runLength({
    text: value,
    index: selectionEnd,
    step: 1,
    markChar,
  });
  if (runBefore === mark.length && runAfter === mark.length) {
    return {
      value:
        value.slice(0, selectionStart - mark.length) +
        selected +
        value.slice(selectionEnd + mark.length),
      selectionStart: selectionStart - mark.length,
      selectionEnd: selectionEnd - mark.length,
    };
  }

  const body = selected || PLACEHOLDER_TEXT;
  return {
    value:
      value.slice(0, selectionStart) +
      mark +
      body +
      mark +
      value.slice(selectionEnd),
    // Select the BODY, not the marks, so typing replaces the placeholder.
    selectionStart: selectionStart + mark.length,
    selectionEnd: selectionStart + mark.length + body.length,
  };
}

/** Add (or remove) a line prefix on every line the selection touches. */
function toggleLinePrefix({
  prefix,
  selection,
}: {
  prefix: string;
  selection: EditorSelection;
}): EditorSelection {
  const { start, end } = expandToLineBounds(selection);
  const block = selection.value.slice(start, end);
  const lines = block.split("\n");
  const allPrefixed = lines.every((line) => line.startsWith(prefix));

  const nextLines = lines.map((line) =>
    allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`,
  );
  const next = nextLines.join("\n");

  return {
    value: selection.value.slice(0, start) + next + selection.value.slice(end),
    selectionStart: start,
    selectionEnd: start + next.length,
  };
}

/**
 * Number the selected lines `1.`, `2.`, ... or strip existing numbering.
 *
 * Renumbered from 1 on every application rather than preserved, so reordering
 * lines and re-applying always produces a correct sequence.
 */
function toggleNumberedList({
  selection,
}: {
  selection: EditorSelection;
}): EditorSelection {
  const { start, end } = expandToLineBounds(selection);
  const lines = selection.value.slice(start, end).split("\n");
  const numbered = /^\d+\.\s/;
  const allNumbered = lines.every((line) => numbered.test(line));

  const nextLines = lines.map((line, index) =>
    allNumbered ? line.replace(numbered, "") : `${index + 1}. ${line}`,
  );
  const next = nextLines.join("\n");

  return {
    value: selection.value.slice(0, start) + next + selection.value.slice(end),
    selectionStart: start,
    selectionEnd: start + next.length,
  };
}

/** Placeholder URL for an inserted link. */
export const PLACEHOLDER_URL = "https://";

/**
 * Insert `[selected](https://)`, leaving the URL selected so the author types
 * straight into the part they actually need to fill in.
 */
function insertLink({
  selection,
}: {
  selection: EditorSelection;
}): EditorSelection {
  const { value, selectionStart, selectionEnd } = selection;
  const label = value.slice(selectionStart, selectionEnd) || PLACEHOLDER_TEXT;
  const inserted = `[${label}](${PLACEHOLDER_URL})`;
  const urlStart = selectionStart + label.length + 3;

  return {
    value:
      value.slice(0, selectionStart) + inserted + value.slice(selectionEnd),
    selectionStart: urlStart,
    selectionEnd: urlStart + PLACEHOLDER_URL.length,
  };
}

/**
 * Length of the unbroken run of `markChar` starting at `index` and walking in
 * `step` direction. Returns 0 when `index` is out of bounds or does not hold
 * the mark character.
 *
 * Used to distinguish `*` from `**`: matching a mark by prefix alone lets a
 * shorter mark claim a longer one's delimiters.
 */
function runLength({
  text,
  index,
  step,
  markChar,
}: {
  text: string;
  index: number;
  step: 1 | -1;
  markChar: string;
}): number {
  let count = 0;
  let cursor = index;
  while (cursor >= 0 && cursor < text.length && text[cursor] === markChar) {
    count++;
    cursor += step;
  }
  return count;
}

/**
 * Grow a selection to whole lines.
 *
 * A line-level mark applied to a partial selection must still affect the whole
 * line - otherwise `- ` lands in the middle of a word.
 */
function expandToLineBounds(selection: EditorSelection): {
  start: number;
  end: number;
} {
  const { value, selectionStart, selectionEnd } = selection;
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEnd = value.indexOf("\n", selectionEnd);
  return { start, end: lineEnd === -1 ? value.length : lineEnd };
}

// ============================================================================
// Mention (`#`) autocomplete
// ============================================================================

/** An active `#` mention query in the textarea. */
export interface MentionQuery {
  /** Text typed after the `#`, used to search. */
  query: string;
  /** Index of the `#` itself, so the whole trigger can be replaced on accept. */
  triggerStart: number;
  /** Index just past the query (the caret). */
  triggerEnd: number;
}

/** Longest query accepted after `#` before the trigger is abandoned. */
export const MAX_MENTION_QUERY_LENGTH = 60;

/**
 * Detect an in-progress `#` mention at the caret.
 *
 * Returns `undefined` when there is no active trigger, which is the common case
 * on every keystroke, so this must stay cheap and must not fire on ordinary
 * prose. Rules, and why each exists:
 *
 * - The `#` must start a word (document start, or preceded by whitespace or an
 *   opening bracket). Without this, every markdown heading (`## Impact`) and
 *   every `id#fragment` would open the picker.
 * - The query may not contain whitespace or a newline. An author who typed `#`
 *   meaning "number" and kept writing has abandoned the trigger.
 * - The query is length-bounded, so a stray `#` early in a long paragraph does
 *   not keep a search running over the rest of it.
 */
export function findMentionQuery({
  value,
  caret,
}: {
  value: string;
  caret: number;
}): MentionQuery | undefined {
  // Walk back from the caret to the nearest `#`.
  let index = caret - 1;
  while (index >= 0) {
    const char = value[index];
    if (char === "#") break;
    if (char === undefined || /\s/.test(char)) return undefined;
    if (caret - index > MAX_MENTION_QUERY_LENGTH) return undefined;
    index--;
  }
  if (index < 0) return undefined;

  const before = index === 0 ? undefined : value[index - 1];
  const startsWord =
    before === undefined || /\s/.test(before) || before === "(" || before === "[";
  if (!startsWord) return undefined;

  return {
    query: value.slice(index + 1, caret),
    triggerStart: index,
    triggerEnd: caret,
  };
}

/**
 * Replace an active `#` trigger with the chosen mention's markdown.
 *
 * A trailing space is appended so the author keeps typing prose rather than
 * immediately re-triggering the picker on the character after the link.
 */
export function applyMentionSelection({
  selection,
  trigger,
  markdown,
}: {
  selection: EditorSelection;
  trigger: MentionQuery;
  /** The full markdown link to insert (see `buildMentionMarkdown`). */
  markdown: string;
}): EditorSelection {
  const inserted = `${markdown} `;
  const value =
    selection.value.slice(0, trigger.triggerStart) +
    inserted +
    selection.value.slice(trigger.triggerEnd);
  const caret = trigger.triggerStart + inserted.length;

  return { value, selectionStart: caret, selectionEnd: caret };
}

/**
 * Whether two mention-trigger states describe the SAME in-progress query.
 *
 * The editor re-evaluates the trigger on every `keyup`, including the arrow
 * keys an open picker already handled on `keydown`. Treating an unchanged query
 * as a change reset the highlighted option to the first one on every arrow
 * press, so the picker could not be navigated by keyboard at all - Enter always
 * chose the first suggestion no matter how far the user had arrowed down.
 *
 * Comparing the caret positions as well as the text matters: the same typed
 * query at a different caret IS a different trigger.
 */
export function isSameMentionQuery({
  a,
  b,
}: {
  a: MentionQuery | null;
  b: MentionQuery | null;
}): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.query === b.query &&
    a.triggerStart === b.triggerStart &&
    a.triggerEnd === b.triggerEnd
  );
}
