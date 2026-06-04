import { describe, expect, test } from "bun:test";
import { computeLineDiff, type DiffSegment } from "./line-diff";

/** Join a side's segments back into its full line text. */
function join(segments: DiffSegment[] | null): string | null {
  return segments === null ? null : segments.map((s) => s.text).join("");
}

describe("computeLineDiff", () => {
  test("identical text yields all-equal rows with sequential line numbers", () => {
    const rows = computeLineDiff({ before: "a\nb", after: "a\nb" });
    expect(rows.map((r) => r.kind)).toEqual(["equal", "equal"]);
    expect(rows.map((r) => [r.leftNo, r.rightNo])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    // No intra-line emphasis on unchanged lines.
    expect(rows.every((r) => (r.left ?? []).every((s) => !s.emphasis))).toBe(
      true,
    );
  });

  test("a single-line edit is one changed row with word-level emphasis", () => {
    const rows = computeLineDiff({
      before: "load < 0.6",
      after: "load < threshold",
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe("changed");
    expect([row.leftNo, row.rightNo]).toEqual([1, 1]);
    // Segments reconstruct each side's full line...
    expect(join(row.left)).toBe("load < 0.6");
    expect(join(row.right)).toBe("load < threshold");
    // ...the shared prefix "load < " is NOT emphasised on either side...
    expect(row.left?.[0]).toEqual({ text: "load < ", emphasis: false });
    expect(row.right?.[0]).toEqual({ text: "load < ", emphasis: false });
    // ...and the diverging tokens ARE emphasised on each side.
    expect(row.left?.some((s) => s.emphasis)).toBe(true);
    expect(row.right?.some((s) => s.emphasis)).toBe(true);
  });

  test("a pure insertion is an added row (no left line/number)", () => {
    const rows = computeLineDiff({ before: "a", after: "a\nb" });
    expect(rows.map((r) => r.kind)).toEqual(["equal", "added"]);
    const added = rows[1];
    expect(added.leftNo).toBeNull();
    expect(added.left).toBeNull();
    expect(added.rightNo).toBe(2);
    expect(join(added.right)).toBe("b");
  });

  test("a pure deletion is a removed row (no right line/number)", () => {
    const rows = computeLineDiff({ before: "a\nb", after: "a" });
    expect(rows.map((r) => r.kind)).toEqual(["equal", "removed"]);
    const removed = rows[1];
    expect(removed.rightNo).toBeNull();
    expect(removed.right).toBeNull();
    expect(removed.leftNo).toBe(2);
    expect(join(removed.left)).toBe("b");
  });

  test("an edited block zips dels and inss into changed rows, equals preserved", () => {
    const rows = computeLineDiff({
      before: "keep\nold1\nold2",
      after: "keep\nnew1\nnew2",
    });
    expect(rows.map((r) => r.kind)).toEqual(["equal", "changed", "changed"]);
    expect(rows.map((r) => [join(r.left), join(r.right)])).toEqual([
      ["keep", "keep"],
      ["old1", "new1"],
      ["old2", "new2"],
    ]);
    expect(rows.map((r) => [r.leftNo, r.rightNo])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  test("more insertions than deletions leaves trailing added rows", () => {
    const rows = computeLineDiff({ before: "old1", after: "new1\nnew2" });
    expect(rows.map((r) => r.kind)).toEqual(["changed", "added"]);
    expect(rows[1].leftNo).toBeNull();
    expect(join(rows[1].right)).toBe("new2");
  });
});
