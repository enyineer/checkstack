import { describe, expect, it } from "bun:test";
import { parsePrList, resolvePrSelection, type PrInfo } from "./gh-prs.ts";

const SAMPLE = JSON.stringify([
  {
    number: 380,
    title: "Edge impact color",
    headRefName: "feat/edge-color",
    isDraft: false,
    author: { login: "enyineer" },
    updatedAt: "2026-07-01T10:00:00Z",
    mergeable: "MERGEABLE",
  },
  {
    number: 388,
    title: "Mass actions",
    headRefName: "feat/mass-actions",
    isDraft: true,
    author: { login: "enyineer" },
    updatedAt: "2026-07-01T12:00:00Z",
    mergeable: "CONFLICTING",
  },
]);

describe("parsePrList", () => {
  it("parses and validates gh output, newest-updated first", () => {
    const prs = parsePrList(SAMPLE);
    expect(prs.map((p) => p.number)).toEqual([388, 380]);
    expect(prs[0]?.isDraft).toBe(true);
    expect(prs[1]?.author?.login).toBe("enyineer");
  });

  it("tolerates a missing author", () => {
    const prs = parsePrList(
      JSON.stringify([
        {
          number: 1,
          title: "x",
          headRefName: "b",
          isDraft: false,
          author: null,
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ]),
    );
    expect(prs[0]?.author).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => parsePrList(JSON.stringify([{ number: "nope" }]))).toThrow();
  });
});

describe("resolvePrSelection", () => {
  const available: PrInfo[] = parsePrList(SAMPLE);

  it("selects requested PRs in requested order, reports invalid", () => {
    const { selected, invalid } = resolvePrSelection({
      requested: [380, 999],
      available,
    });
    expect(selected.map((p) => p.number)).toEqual([380]);
    expect(invalid).toEqual([999]);
  });

  it("dedupes repeated requests", () => {
    const { selected } = resolvePrSelection({
      requested: [388, 388, 380],
      available,
    });
    expect(selected.map((p) => p.number)).toEqual([388, 380]);
  });
});
