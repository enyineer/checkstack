import { describe, it, expect } from "bun:test";
import {
  toQueryLabel,
  projectStatementRow,
  isPgStatStatementsAvailable,
  fetchTopStatements,
  type StatementsQueryable,
} from "./pg-stat-statements";

/**
 * The profiler's risk is twofold: (1) the no-op fallback must be airtight - a
 * missing extension or an unreadable view must yield `false`, never a throw,
 * so a deployment without `pg_stat_statements` is unaffected; (2) the row
 * projection must coerce the string-typed numeric columns and normalize labels
 * so cardinality stays bounded. Both are covered here with a lightweight fake
 * queryable (no real Postgres needed).
 */

/** A fake queryable that returns canned results (or throws) per SQL prefix. */
function fakePool(
  handler: (text: string, values?: unknown[]) => { rows: unknown[]; rowCount: number | null },
): StatementsQueryable {
  return {
    async query<R>(text: string, values?: unknown[]) {
      const result = handler(text, values);
      return { rows: result.rows as R[], rowCount: result.rowCount };
    },
  };
}

describe("toQueryLabel", () => {
  it("collapses whitespace/newlines into single spaces and trims", () => {
    expect(toQueryLabel("  SELECT\n  a,\t b\nFROM   t  ")).toBe(
      "SELECT a, b FROM t",
    );
  });

  it("truncates an over-long statement and appends an ellipsis", () => {
    const long = "SELECT " + "x".repeat(500);
    const label = toQueryLabel(long);
    // 200 chars of content + the single-char ellipsis.
    expect(label.length).toBe(201);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("projectStatementRow", () => {
  it("coerces string numerics and normalizes the query label", () => {
    const stat = projectStatementRow({
      queryid: "12345",
      query: "SELECT  1",
      calls: "42",
      total_exec_time: "123.5",
      mean_exec_time: "2.94",
      rows: "42",
    });
    expect(stat).toEqual({
      queryid: "12345",
      query: "SELECT 1",
      calls: 42,
      totalExecTimeMs: 123.5,
      meanExecTimeMs: 2.94,
      rows: 42,
    });
  });

  it("coalesces a null queryid to \"unknown\" and a null query to empty", () => {
    const stat = projectStatementRow({
      queryid: null,
      query: null,
      calls: 0,
      total_exec_time: 0,
      mean_exec_time: 0,
      rows: 0,
    });
    expect(stat.queryid).toBe("unknown");
    expect(stat.query).toBe("");
  });
});

describe("isPgStatStatementsAvailable (no-op fallback)", () => {
  it("returns false when the extension is not installed", async () => {
    const pool = fakePool((text) => {
      expect(text).toContain("pg_extension");
      return { rows: [], rowCount: 0 };
    });
    expect(await isPgStatStatementsAvailable({ pool })).toBe(false);
  });

  it("returns false when the view is unreadable (permission denied)", async () => {
    const pool = fakePool((text) => {
      if (text.includes("pg_extension")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      // The view probe throws (e.g. the role lacks pg_read_all_stats).
      throw new Error("permission denied for view pg_stat_statements");
    });
    expect(await isPgStatStatementsAvailable({ pool })).toBe(false);
  });

  it("returns true when the extension is present and the view is readable", async () => {
    const pool = fakePool(() => ({ rows: [{ "?column?": 1 }], rowCount: 1 }));
    expect(await isPgStatStatementsAvailable({ pool })).toBe(true);
  });
});

describe("fetchTopStatements", () => {
  it("passes the top-N limit and maps rows through the projector", async () => {
    let capturedValues: unknown[] | undefined;
    const pool = fakePool((_text, values) => {
      capturedValues = values;
      return {
        rows: [
          {
            queryid: "1",
            query: "SELECT 1",
            calls: "3",
            total_exec_time: "30",
            mean_exec_time: "10",
            rows: "3",
          },
        ],
        rowCount: 1,
      };
    });

    const stats = await fetchTopStatements({ pool, topN: 7 });
    expect(capturedValues).toEqual([7]);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      queryid: "1",
      calls: 3,
      totalExecTimeMs: 30,
      meanExecTimeMs: 10,
    });
  });
});
