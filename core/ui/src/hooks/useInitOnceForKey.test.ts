import { describe, expect, it } from "bun:test";
import { shouldInitForKey } from "./useInitOnceForKey";

/**
 * Regression suite for the form-preservation bug in the healthcheck editor.
 *
 * Before this hook existed, the page had:
 *
 *   useEffect(() => {
 *     if (existingConfig) setFormState({ … });
 *   }, [existingConfig]);
 *
 * That fires on every refetch — including the refetches triggered by the
 * realtime `HEALTH_CHECK_RUN_COMPLETED` signal — so the user's in-progress
 * edits got wiped every time a healthcheck run completed anywhere on the
 * platform.
 *
 * The hook delegates its decision to the pure `shouldInitForKey` function
 * tested below. The hook is a thin React wrapper around two refs and a
 * `useEffect` — testing the decision function gives full coverage of the
 * logic without needing a DOM.
 */

describe("shouldInitForKey", () => {
  it("returns true the first time value+key are defined and no key has been initialised", () => {
    expect(
      shouldInitForKey({
        value: { name: "A" },
        key: "id-1",
        initialisedKey: undefined,
      }),
    ).toBe(true);
  });

  it("returns false when value is undefined (query still loading)", () => {
    expect(
      shouldInitForKey({
        value: undefined,
        key: "id-1",
        initialisedKey: undefined,
      }),
    ).toBe(false);
  });

  it("returns false when value is null", () => {
    expect(
      shouldInitForKey({
        value: null,
        key: "id-1",
        initialisedKey: undefined,
      }),
    ).toBe(false);
  });

  it("returns false when key is undefined (no discriminator yet)", () => {
    expect(
      shouldInitForKey({
        value: { name: "A" },
        key: undefined,
        initialisedKey: undefined,
      }),
    ).toBe(false);
  });

  it("returns false when key is null (record-not-found path)", () => {
    expect(
      shouldInitForKey({
        value: { name: "A" },
        key: null,
        initialisedKey: undefined,
      }),
    ).toBe(false);
  });

  it("returns false on a background refetch (same key already initialised)", () => {
    // THE regression case: react-query refetched the same record after an
    // invalidation, handing us a new `value` object reference. The
    // `initialisedKey` already matches the new key, so we must not re-fire.
    expect(
      shouldInitForKey({
        value: { name: "A (refetched)" },
        key: "id-1",
        initialisedKey: "id-1",
      }),
    ).toBe(false);
  });

  it("returns true when the key changes (user navigated to a different record)", () => {
    expect(
      shouldInitForKey({
        value: { name: "B" },
        key: "id-2",
        initialisedKey: "id-1",
      }),
    ).toBe(true);
  });

  it("returns true when we're returning to a previously-seen key from a different one", () => {
    // The hook only stores the LAST initialised key, so flipping between
    // two records re-initialises each time. That's the correct behaviour:
    // each visit shows fresh server data.
    expect(
      shouldInitForKey({
        value: { name: "A" },
        key: "id-1",
        initialisedKey: "id-2",
      }),
    ).toBe(true);
  });

  it("treats numeric keys correctly (different number → re-init)", () => {
    expect(
      shouldInitForKey({ value: "any", key: 1, initialisedKey: 1 }),
    ).toBe(false);
    expect(
      shouldInitForKey({ value: "any", key: 2, initialisedKey: 1 }),
    ).toBe(true);
  });

  it("treats string vs number keys as different (no implicit coercion)", () => {
    // If a caller starts passing IDs as numbers after passing strings (or
    // vice versa) we'd rather re-init than miss an update; strict !== handles it.
    expect(
      shouldInitForKey({ value: "any", key: "1", initialisedKey: 1 }),
    ).toBe(true);
  });
});
