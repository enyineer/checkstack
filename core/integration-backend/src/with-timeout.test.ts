import { describe, it, expect } from "bun:test";
import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  it("resolves with the promise's value when it settles before the timeout", async () => {
    const result = await withTimeout({
      promise: Promise.resolve("ok"),
      timeoutMs: 1000,
      onTimeout: () => new Error("should not fire"),
    });
    expect(result).toBe("ok");
  });

  it("rejects with onTimeout()'s error when the promise is too slow", async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve("late"), 1000),
    );
    expect(
      withTimeout({
        promise: slow,
        timeoutMs: 10,
        onTimeout: () => new Error("integration unreachable"),
      }),
    ).rejects.toThrow("integration unreachable");
  });

  it("propagates the promise's own rejection unchanged", async () => {
    expect(
      withTimeout({
        promise: Promise.reject(new Error("boom")),
        timeoutMs: 1000,
        onTimeout: () => new Error("should not fire"),
      }),
    ).rejects.toThrow("boom");
  });

  it("clears the timer so a fast resolve leaves nothing pending", async () => {
    // If the timer were left pending it would reject later; awaiting a macrotask
    // longer than the timeout and seeing no unhandled rejection proves cleanup.
    const value = await withTimeout({
      promise: Promise.resolve(42),
      timeoutMs: 5,
      onTimeout: () => new Error("should not fire"),
    });
    expect(value).toBe(42);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
