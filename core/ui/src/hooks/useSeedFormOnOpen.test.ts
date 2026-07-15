import { describe, expect, it } from "bun:test";
import { shouldSeedOnOpen } from "./useSeedFormOnOpen";

/**
 * Regression suite for the "form resets while editing" bug in dialog-hosted
 * editors (catalog SystemEditor / EnvironmentEditor / GroupEditor).
 *
 * Before this hook existed, each dialog had:
 *
 *   useEffect(() => {
 *     if (open) setName(initialData?.name ?? "");
 *   }, [open, initialData]);
 *
 * The parent passes `initialData` as a fresh object literal on every render,
 * so a realtime query invalidation (a webhook/signal refetching the record
 * while the dialog is open) rebuilt that prop, re-fired the effect, and wiped
 * the user's in-progress edits.
 *
 * The hook seeds only on the open transition. Its decision is delegated to the
 * pure `shouldSeedOnOpen` function tested below, which gives full coverage of
 * the logic without a DOM.
 */

describe("shouldSeedOnOpen", () => {
  it("seeds on the closed -> open transition", () => {
    expect(shouldSeedOnOpen({ open: true, wasOpen: false })).toBe(true);
  });

  it("does NOT re-seed while the dialog stays open (the bug it guards)", () => {
    // A refetch rebuilds the seed prop while open === true and wasOpen === true.
    expect(shouldSeedOnOpen({ open: true, wasOpen: true })).toBe(false);
  });

  it("does not seed while closed", () => {
    expect(shouldSeedOnOpen({ open: false, wasOpen: false })).toBe(false);
  });

  it("does not seed on the open -> closed transition", () => {
    expect(shouldSeedOnOpen({ open: false, wasOpen: true })).toBe(false);
  });
});
