/**
 * Pure, DOM-free line diff for the chat confirm/applied cards, modelled on the
 * GitHub split (side-by-side) diff. Produces aligned rows carrying:
 *  - old/new LINE NUMBERS (gutters),
 *  - the per-side text split into SEGMENTS, where the exact changed tokens of an
 *    edited line are flagged `emphasis: true` (GitHub's intra-line word highlight,
 *    the thing that makes a one-character change actually readable).
 *
 * Lightweight on purpose: an LCS over lines, and a second LCS over word-tokens
 * for the changed pairs - no Monaco/editor stack pulled into the chat.
 * Unit-testable under `bun test` (no DOM).
 */

/** A run of text on one side of a line; `emphasis` marks the changed tokens. */
export interface DiffSegment {
  text: string;
  emphasis: boolean;
}

/** One rendered row of a side-by-side diff. `null` means "no line on this side". */
export interface DiffLine {
  /** 1-based old-file line number, or null when this row has no left line. */
  leftNo: number | null;
  /** 1-based new-file line number, or null when this row has no right line. */
  rightNo: number | null;
  left: DiffSegment[] | null;
  right: DiffSegment[] | null;
  /**
   * - `equal`: unchanged line (both sides identical)
   * - `changed`: a removed line paired with an added line (an edit)
   * - `removed`: a line only on the left (deleted)
   * - `added`: a line only on the right (inserted)
   */
  kind: "equal" | "changed" | "removed" | "added";
}

type Op = { type: "equal" | "del" | "ins"; text: string };

/** LCS suffix-DP over two token arrays: `dp[i][j]` = LCS length of a[i:], b[j:]. */
function lcsLengths(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/** Walk the LCS table into an ordered equal/del/ins op list over two sequences. */
function sequenceOps(a: string[], b: string[]): Op[] {
  const dp = lcsLengths(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      ops.push({ type: "ins", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ type: "ins", text: b[j] });
    j += 1;
  }
  return ops;
}

/** Split a line into word / whitespace / punctuation tokens for the word diff. */
function tokenize(line: string): string[] {
  return line.match(/\w+|\s+|[^\s\w]+/g) ?? [];
}

/** Append text to a side, merging into the previous run when emphasis matches. */
function pushSegment(target: DiffSegment[], text: string, emphasis: boolean): void {
  const last = target.at(-1);
  if (last && last.emphasis === emphasis) {
    last.text += text;
  } else {
    target.push({ text, emphasis });
  }
}

/**
 * Word-level diff of one edited line: returns the left (before) and right (after)
 * segment runs, with the tokens unique to each side flagged `emphasis: true`.
 */
function wordSegments(
  before: string,
  after: string,
): { left: DiffSegment[]; right: DiffSegment[] } {
  const ops = sequenceOps(tokenize(before), tokenize(after));
  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];
  for (const op of ops) {
    if (op.type === "equal") {
      pushSegment(left, op.text, false);
      pushSegment(right, op.text, false);
    } else if (op.type === "del") {
      pushSegment(left, op.text, true);
    } else {
      pushSegment(right, op.text, true);
    }
  }
  return { left, right };
}

/** A whole line with no intra-line emphasis (equal/added/removed rows). */
function plain(text: string): DiffSegment[] {
  return [{ text, emphasis: false }];
}

/**
 * Compute the side-by-side rows for a before -> after text change. A run of
 * deletions immediately followed by insertions is zipped index-by-index into
 * `changed` rows (old line left, new line right, with word-level emphasis);
 * leftover deletions/insertions become `removed`/`added` rows. Old/new line
 * numbers are tracked across the walk for the gutters.
 */
export function computeLineDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}): DiffLine[] {
  const ops = sequenceOps(before.split("\n"), after.split("\n"));
  const rows: DiffLine[] = [];
  let leftNo = 0;
  let rightNo = 0;
  let dels: string[] = [];
  let inss: string[] = [];

  const flush = (): void => {
    const pairs = Math.max(dels.length, inss.length);
    for (let k = 0; k < pairs; k += 1) {
      const l = k < dels.length ? dels[k] : null;
      const r = k < inss.length ? inss[k] : null;
      if (l === null) {
        rightNo += 1;
        rows.push({
          leftNo: null,
          rightNo,
          left: null,
          right: plain(r ?? ""),
          kind: "added",
        });
      } else if (r === null) {
        leftNo += 1;
        rows.push({
          leftNo,
          rightNo: null,
          left: plain(l),
          right: null,
          kind: "removed",
        });
      } else {
        leftNo += 1;
        rightNo += 1;
        const { left, right } = wordSegments(l, r);
        rows.push({ leftNo, rightNo, left, right, kind: "changed" });
      }
    }
    dels = [];
    inss = [];
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flush();
      leftNo += 1;
      rightNo += 1;
      rows.push({
        leftNo,
        rightNo,
        left: plain(op.text),
        right: plain(op.text),
        kind: "equal",
      });
    } else if (op.type === "del") {
      dels.push(op.text);
    } else {
      inss.push(op.text);
    }
  }
  flush();
  return rows;
}
