import { describe, expect, it } from "bun:test";
import {
  deriveTestErrorMessage,
  deriveTestRejectionMessage,
} from "./userChannelCard.logic";

describe("deriveTestErrorMessage", () => {
  it("returns null for a successful test", () => {
    expect(deriveTestErrorMessage({ success: true })).toBeNull();
  });

  it("ignores an error field on a successful result", () => {
    expect(
      deriveTestErrorMessage({ success: true, error: "stale" }),
    ).toBeNull();
  });

  it("surfaces the backend error verbatim on failure", () => {
    const error = "connect ECONNREFUSED 10.0.0.5:443 while calling webhook";
    expect(deriveTestErrorMessage({ success: false, error })).toBe(error);
  });

  it("preserves a long multi-line error untruncated (the whole point)", () => {
    const error = `HTTP 500 from provider\n${"x".repeat(500)}`;
    expect(deriveTestErrorMessage({ success: false, error })).toBe(error);
  });

  it("falls back to a message when a failure omits error detail", () => {
    const message = deriveTestErrorMessage({ success: false });
    expect(message).not.toBeNull();
    expect(message).toContain("no error detail");
  });
});

describe("deriveTestRejectionMessage", () => {
  it("uses the Error message when the mutation rejects with an Error", () => {
    expect(deriveTestRejectionMessage(new Error("Unauthorized"))).toBe(
      "Unauthorized",
    );
  });

  it("surfaces a string rejection verbatim", () => {
    expect(deriveTestRejectionMessage("boom")).toBe("boom");
  });

  it("falls back to a generic message for an opaque rejection", () => {
    expect(deriveTestRejectionMessage({ weird: true })).toBe(
      "Failed to send the test notification.",
    );
  });
});
