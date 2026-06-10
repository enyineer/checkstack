import { describe, test, expect } from "bun:test";
import { renderRowsForSummary, type SummaryInputRow } from "./summarize-turns";

describe("renderRowsForSummary", () => {
  test("renders role-prefixed lines and flags tool usage", () => {
    const rows: SummaryInputRow[] = [
      { role: "user", content: { text: "What is failing?" } },
      {
        role: "assistant",
        content: { text: "Checked health." },
        modelMessages: [{ role: "assistant", content: [] }],
      },
    ];
    const out = renderRowsForSummary({ rows });
    expect(out).toBe(
      "USER: What is failing?\nASSISTANT: Checked health. [used tools]",
    );
  });

  test("skips empty rows with no tool activity", () => {
    const rows: SummaryInputRow[] = [
      { role: "user", content: { text: "" } },
      { role: "assistant", content: { text: "Reply." } },
    ];
    expect(renderRowsForSummary({ rows })).toBe("ASSISTANT: Reply.");
  });

  test("truncates from the head to the char cap", () => {
    const rows: SummaryInputRow[] = [
      { role: "user", content: { text: "x".repeat(1000) } },
    ];
    const out = renderRowsForSummary({ rows, maxChars: 100 });
    expect(out.length).toBeLessThanOrEqual(100 + "\n...[older content truncated]".length);
    expect(out).toContain("[older content truncated]");
  });
});
