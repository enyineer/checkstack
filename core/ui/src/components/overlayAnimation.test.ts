import { describe, expect, it } from "bun:test";
import { OVERLAY_ENTER_ANIMATION } from "./overlayAnimation";

/**
 * Regression guard for the orphaned-scrim bug.
 *
 * The modal overlay (shared by Dialog and Sheet) is a full-screen,
 * `pointer-events: auto` element. If it carries a `data-[state=closed]`
 * EXIT animation, its removal becomes dependent on an `animationend` event
 * reaching Radix's `Presence`. When a second dialog/sheet opens while this
 * one is mid-close, that event can be missed, leaving the scrim orphaned in
 * the DOM where it swallows every later click (the "Save click hangs under a
 * dim screen" bug). The overlay must therefore animate IN only, so Radix can
 * unmount it synchronously on close.
 *
 * Happy DOM does not run CSS animations or fire `animationend`, so it cannot
 * reproduce the real-browser race at the render level. The end-to-end guard
 * is `core/e2e/tests/automation.spec.ts`. This test locks in the structural
 * invariant the fix relies on, so the bug can't be reintroduced by re-adding
 * an exit animation to the overlay class.
 */
describe("modal overlay animation", () => {
  it("animates in only and never out (prevents orphaned scrim)", () => {
    expect(OVERLAY_ENTER_ANIMATION).toContain("data-[state=open]:animate-in");
    expect(OVERLAY_ENTER_ANIMATION).not.toContain("animate-out");
    expect(OVERLAY_ENTER_ANIMATION).not.toContain("data-[state=closed]");
    expect(OVERLAY_ENTER_ANIMATION).not.toContain("fade-out");
  });
});
