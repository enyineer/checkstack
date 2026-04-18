import { describe, it, expect } from "bun:test";
import { extractErrorMessage } from "./error-utils";

describe("extractErrorMessage", () => {
  it("should extract message from Error instances", () => {
    const error = new Error("something went wrong");
    expect(extractErrorMessage(error)).toBe("something went wrong");
  });

  it("should extract message from Error subclasses", () => {
    const error = new TypeError("invalid type");
    expect(extractErrorMessage(error)).toBe("invalid type");
  });

  it("should return string errors directly", () => {
    expect(extractErrorMessage("network failure")).toBe("network failure");
  });

  it("should return the default fallback for non-Error, non-string values", () => {
    expect(extractErrorMessage(42)).toBe("An error occurred");
    expect(extractErrorMessage(undefined)).toBe("An error occurred");
    // eslint-disable-next-line unicorn/no-null
    expect(extractErrorMessage(null)).toBe("An error occurred");
    expect(extractErrorMessage({ code: 500 })).toBe("An error occurred");
  });

  it("should return custom fallback when provided", () => {
    expect(extractErrorMessage(42, "Custom fallback")).toBe("Custom fallback");
  });
});
