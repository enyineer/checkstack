import { describe, expect, test } from "bun:test";
import {
  shouldFetchLinkedStreamStatuses,
  isLinkedStreamSignalsLoading,
} from "./linked-stream-signals.logic";

describe("shouldFetchLinkedStreamStatuses", () => {
  test("fetches for an authenticated caller with systems in view", () => {
    expect(
      shouldFetchLinkedStreamStatuses({
        systemIdCount: 3,
        isAuthenticated: true,
      }),
    ).toBe(true);
  });

  test("never fetches for an anonymous caller", () => {
    // Regression: the dashboard is reachable anonymously (catalog read is
    // public), but `listLinkedStreamStatuses` is authenticated-only. Firing it
    // anyway made the backend log an "Authentication required" rejection for
    // every stream plugin on every anonymous page load.
    expect(
      shouldFetchLinkedStreamStatuses({
        systemIdCount: 3,
        isAuthenticated: false,
      }),
    ).toBe(false);
  });

  test("does not fetch with no systems in view, authenticated or not", () => {
    expect(
      shouldFetchLinkedStreamStatuses({
        systemIdCount: 0,
        isAuthenticated: true,
      }),
    ).toBe(false);
    expect(
      shouldFetchLinkedStreamStatuses({
        systemIdCount: 0,
        isAuthenticated: false,
      }),
    ).toBe(false);
  });
});

describe("isLinkedStreamSignalsLoading", () => {
  test("reports loading while the session is still resolving", () => {
    // The query is disabled until the caller is known; reporting "settled" here
    // would let the dashboard render "all healthy" and then flip back to a
    // skeleton once the session lands and the real query starts.
    expect(
      isLinkedStreamSignalsLoading({ queryLoading: false, authLoading: true }),
    ).toBe(true);
  });

  test("reports loading while the query is in flight", () => {
    expect(
      isLinkedStreamSignalsLoading({ queryLoading: true, authLoading: false }),
    ).toBe(true);
  });

  test("settles once both the session and the query have resolved", () => {
    expect(
      isLinkedStreamSignalsLoading({ queryLoading: false, authLoading: false }),
    ).toBe(false);
  });
});
