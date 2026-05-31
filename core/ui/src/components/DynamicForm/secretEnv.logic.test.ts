import { describe, it, expect } from "bun:test";
import {
  parseSecretName,
  toSecretTemplate,
  objectToRows,
  rowsToObject,
  unknownSecretNames,
  type SecretEnvRow,
} from "./secretEnv.logic";

describe("parseSecretName", () => {
  it("extracts the name from a ${{ secrets.NAME }} template", () => {
    expect(parseSecretName("${{ secrets.jira_token }}")).toBe("jira_token");
    expect(parseSecretName("${{secrets.x}}")).toBe("x");
  });

  it("accepts a legacy bare secret name and returns it as-is", () => {
    // Bare names are tolerated on the wire (normalized to a template by the
    // schema), so the picker shows the same name for both forms.
    expect(parseSecretName("plain")).toBe("plain");
    expect(parseSecretName("SECRET")).toBe("SECRET");
    expect(parseSecretName("my-secret")).toBe("my-secret");
  });

  it("returns empty for junk that is neither a template nor a bare name", () => {
    // Inline interpolation is not a whole-value secret reference.
    expect(parseSecretName("u:${{ secrets.pw }}@host")).toBe("");
    // A leading digit / spaces are not a valid secret name.
    expect(parseSecretName("1bad")).toBe("");
    expect(parseSecretName("not a name")).toBe("");
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

describe("unknownSecretNames", () => {
  const rows: SecretEnvRow[] = [
    { envName: "A", secretName: "alpha" },
    { envName: "B", secretName: "beta" },
  ];

  it("returns the referenced names that are not in the available list", () => {
    const result = unknownSecretNames({ rows, secretNames: ["alpha"] });
    expect(result).toEqual(new Set(["beta"]));
  });

  it("returns an empty set when the list is undefined (still loading)", () => {
    expect(unknownSecretNames({ rows, secretNames: undefined })).toEqual(
      new Set(),
    );
  });

  it("returns an empty set when the list is empty (treated as unknown list)", () => {
    expect(unknownSecretNames({ rows, secretNames: [] })).toEqual(new Set());
  });

  it("returns an empty set when every referenced name is known", () => {
    expect(
      unknownSecretNames({ rows, secretNames: ["alpha", "beta", "gamma"] }),
    ).toEqual(new Set());
  });

  it("ignores blank / whitespace-only secret names", () => {
    const withBlank: SecretEnvRow[] = [
      { envName: "A", secretName: "" },
      { envName: "B", secretName: "  " },
      { envName: "C", secretName: "ghost" },
    ];
    expect(
      unknownSecretNames({ rows: withBlank, secretNames: ["alpha"] }),
    ).toEqual(new Set(["ghost"]));
  });

  it("de-duplicates a name referenced by multiple rows", () => {
    const dupes: SecretEnvRow[] = [
      { envName: "A", secretName: "ghost" },
      { envName: "B", secretName: "ghost" },
    ];
    expect(unknownSecretNames({ rows: dupes, secretNames: ["alpha"] })).toEqual(
      new Set(["ghost"]),
    );
  });

  it("trims whitespace before comparing against the list", () => {
    const padded: SecretEnvRow[] = [{ envName: "A", secretName: "  alpha  " }];
    expect(
      unknownSecretNames({ rows: padded, secretNames: ["alpha"] }),
    ).toEqual(new Set());
  });
});
