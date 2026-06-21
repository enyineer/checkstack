import { afterEach, beforeEach, describe, it, expect, jest } from "bun:test";
import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  // Fake timers make the timeout deterministic: tests advance the clock by an
  // exact amount instead of waiting real wall-clock milliseconds. This both
  // speeds the suite up and removes the flakiness of "wait a bit longer than
  // the timeout and hope" assertions.
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves with the promise's value when it settles before the timeout", async () => {
    const result = await withTimeout({
      promise: Promise.resolve("ok"),
      timeoutMs: 1000,
      onTimeout: () => new Error("should not fire"),
    });
    expect(result).toBe("ok");
  });

  it("rejects with onTimeout()'s error when the promise is too slow", async () => {
    // A promise that would only settle after 1000ms of fake time - far beyond
    // the 10ms ceiling, so the timeout wins.
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve("late"), 1000),
    );
    const raced = withTimeout({
      promise: slow,
      timeoutMs: 10,
      onTimeout: () => new Error("integration unreachable"),
    });

    // Advance past the timeout but not past the slow promise.
    jest.advanceTimersByTime(10);

    await expect(raced).rejects.toThrow("integration unreachable");
  });

  it("propagates the promise's own rejection unchanged", async () => {
    await expect(
      withTimeout({
        promise: Promise.reject(new Error("boom")),
        timeoutMs: 1000,
        onTimeout: () => new Error("should not fire"),
      }),
    ).rejects.toThrow("boom");
  });

  it("clears the timer so a fast resolve leaves nothing pending", async () => {
    const value = await withTimeout({
      promise: Promise.resolve(42),
      timeoutMs: 5,
      onTimeout: () => new Error("should not fire"),
    });
    expect(value).toBe(42);

    // If the timer were left pending, advancing well past the timeout would fire
    // the rejection (surfacing as an unhandled rejection). It must not - the
    // finally-block cleared it on the fast resolve.
    jest.advanceTimersByTime(1000);
  });
});
