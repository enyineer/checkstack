import { describe, expect, it } from "bun:test";
import {
  DESKTOP_POPOVER_CONTENT_CLASS,
  shouldRenderProfileHeaderLink,
} from "./UserMenu.logic";

describe("UserMenu - desktop popover overflow fix", () => {
  it("bounds the popover height to the available viewport space", () => {
    // The core of issue #252: without a max-height the menu overflows past
    // the viewport bottom on short screens and the lower items are unreachable.
    expect(DESKTOP_POPOVER_CONTENT_CLASS).toContain(
      "max-h-[var(--radix-popover-content-available-height)]",
    );
  });

  it("enables vertical scroll so clipped items stay reachable", () => {
    expect(DESKTOP_POPOVER_CONTENT_CLASS).toContain("overflow-y-auto");
  });

  it("retains the two-column grid layout", () => {
    expect(DESKTOP_POPOVER_CONTENT_CLASS).toContain("sm:grid-cols-2");
  });
});

describe("UserMenu - profile header link decision", () => {
  it("renders a link when a non-empty profileHref is provided", () => {
    expect(shouldRenderProfileHeaderLink("/profile")).toBe(true);
  });

  it("renders a non-interactive label when profileHref is omitted", () => {
    expect(shouldRenderProfileHeaderLink(undefined)).toBe(false);
  });

  it("treats an empty string as no link (avoids an href-less anchor)", () => {
    expect(shouldRenderProfileHeaderLink("")).toBe(false);
  });
});
