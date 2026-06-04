import { describe, it, expect } from "bun:test";
import { MONACO_THEME_MAP, VARIABLE_TOKEN_COLOR } from "./editorTheme";

describe("MONACO_THEME_MAP", () => {
  it("maps light to vs", () => {
    expect(MONACO_THEME_MAP["light"]).toBe("vs");
  });

  it("maps dark to vs-dark", () => {
    expect(MONACO_THEME_MAP["dark"]).toBe("vs-dark");
  });

  it("covers both resolved theme values", () => {
    const keys = Object.keys(MONACO_THEME_MAP);
    expect(keys).toContain("light");
    expect(keys).toContain("dark");
    expect(keys).toHaveLength(2);
  });
});

describe("VARIABLE_TOKEN_COLOR", () => {
  it("provides distinct colors for light and dark", () => {
    expect(VARIABLE_TOKEN_COLOR["light"]).not.toBe(VARIABLE_TOKEN_COLOR["dark"]);
  });

  it("light color is a valid hex color", () => {
    expect(VARIABLE_TOKEN_COLOR["light"]).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("dark color is a valid hex color", () => {
    expect(VARIABLE_TOKEN_COLOR["dark"]).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("dark color matches the vs-dark variable token color", () => {
    expect(VARIABLE_TOKEN_COLOR["dark"]).toBe("#9cdcfe");
  });

  it("light color matches the vs light variable token color", () => {
    expect(VARIABLE_TOKEN_COLOR["light"]).toBe("#0070c1");
  });
});
