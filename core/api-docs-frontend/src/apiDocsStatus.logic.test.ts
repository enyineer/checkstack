import { describe, expect, it } from "bun:test";
import {
  accessToneForUserType,
  isExternallyAccessible,
} from "./apiDocsStatus.logic";

describe("accessToneForUserType", () => {
  it("maps externally accessible user types to ok", () => {
    expect(accessToneForUserType("public")).toBe("ok");
    expect(accessToneForUserType("authenticated")).toBe("ok");
  });

  it("maps internal-only user types to warn", () => {
    expect(accessToneForUserType("user")).toBe("warn");
    expect(accessToneForUserType("service")).toBe("warn");
  });

  it("maps unknown or missing user types to unknown", () => {
    expect(accessToneForUserType(undefined)).toBe("unknown");
    expect(accessToneForUserType("")).toBe("unknown");
    expect(accessToneForUserType("something-else")).toBe("unknown");
  });
});

describe("isExternallyAccessible", () => {
  it("is true only for public and authenticated", () => {
    expect(isExternallyAccessible("public")).toBe(true);
    expect(isExternallyAccessible("authenticated")).toBe(true);
  });

  it("is false for internal-only and unknown types", () => {
    expect(isExternallyAccessible("user")).toBe(false);
    expect(isExternallyAccessible("service")).toBe(false);
    expect(isExternallyAccessible(undefined)).toBe(false);
    expect(isExternallyAccessible("nope")).toBe(false);
  });
});
