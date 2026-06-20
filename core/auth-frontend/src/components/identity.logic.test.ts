import { describe, expect, test } from "bun:test";
import { deriveInitial } from "./identity.logic";

describe("deriveInitial", () => {
  test("uses the first letter of the name, uppercased", () => {
    expect(deriveInitial({ name: "ada lovelace", email: "ada@x.com" })).toBe(
      "A",
    );
  });

  test("falls back to the email when the name is empty or whitespace", () => {
    expect(deriveInitial({ name: "   ", email: "grace@x.com" })).toBe("G");
    expect(deriveInitial({ name: null, email: "linus@x.com" })).toBe("L");
  });

  test("falls back to a placeholder when neither name nor email is present", () => {
    expect(deriveInitial({ name: "", email: "" })).toBe("?");
    expect(deriveInitial({ name: null, email: undefined })).toBe("?");
  });

  test("trims leading whitespace before taking the initial", () => {
    expect(deriveInitial({ name: "  bob", email: null })).toBe("B");
  });
});
