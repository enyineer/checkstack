import { describe, it, expect } from "bun:test";
import {
  parseSecretName,
  toSecretTemplate,
  objectToRows,
  rowsToObject,
} from "./secretEnv.logic";

describe("parseSecretName", () => {
  it("extracts the name from a ${{ secrets.NAME }} template", () => {
    expect(parseSecretName("${{ secrets.jira_token }}")).toBe("jira_token");
    expect(parseSecretName("${{secrets.x}}")).toBe("x");
  });

  it("returns empty for a non-template / inline value", () => {
    expect(parseSecretName("plain")).toBe("");
    // Only a whole-value template is treated as a single secret reference.
    expect(parseSecretName("u:${{ secrets.pw }}@host")).toBe("");
  });
});

describe("toSecretTemplate", () => {
  it("wraps a name in the canonical template", () => {
    expect(toSecretTemplate("api")).toBe("${{ secrets.api }}");
  });
  it("returns empty for an empty name", () => {
    expect(toSecretTemplate("")).toBe("");
  });
});

describe("objectToRows / rowsToObject round-trip", () => {
  it("converts a mapping to rows and back", () => {
    const mapping = {
      API_TOKEN: "${{ secrets.jira_token }}",
      DB: "${{ secrets.db_pass }}",
    };
    const rows = objectToRows(mapping);
    expect(rows).toEqual([
      { envName: "API_TOKEN", secretName: "jira_token" },
      { envName: "DB", secretName: "db_pass" },
    ]);
    expect(rowsToObject(rows)).toEqual(mapping);
  });

  it("drops incomplete rows (empty env name or secret) on serialize", () => {
    const rows = [
      { envName: "A", secretName: "alpha" },
      { envName: "", secretName: "beta" },
      { envName: "C", secretName: "" },
    ];
    expect(rowsToObject(rows)).toEqual({ A: "${{ secrets.alpha }}" });
  });

  it("trims whitespace in env and secret names", () => {
    const rows = [{ envName: "  TOKEN ", secretName: " tok " }];
    expect(rowsToObject(rows)).toEqual({ TOKEN: "${{ secrets.tok }}" });
  });
});
