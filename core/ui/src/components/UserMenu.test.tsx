/**
 * UserMenu DOM tests.
 *
 * core/ui preloads happy-dom + @testing-library/react via
 * `@checkstack/test-utils-frontend/setup` (see bunfig.toml), so these
 * render the real component and assert on the produced DOM.
 *
 * Radix Popover needs a few browser APIs that happy-dom does not provide
 * (ResizeObserver, pointer-capture, scrollIntoView); they are polyfilled
 * below as inert no-ops so the popover can open. Opening toggles React
 * state, so the trigger click is wrapped in act().
 *
 * useIsMobile defaults to false on the initial render, so the desktop
 * Popover path is exercised here. The popover portals its content to
 * document.body, which @testing-library exposes as the render result's
 * baseElement.
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { UserMenu } from "./UserMenu";
import { DropdownMenuItem } from "./Menu";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ??
    (ResizeObserverStub as unknown as typeof ResizeObserver);
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

const user = { name: "Nico Enking", email: "nico@example.com" };

/**
 * Renders the menu, opens the desktop popover, and returns the portalled
 * content root (document.body, exposed as baseElement).
 */
function renderOpenMenu(profileHref?: string) {
  const result = render(
    <UserMenu user={user} profileHref={profileHref}>
      <DropdownMenuItem>Bottom item</DropdownMenuItem>
    </UserMenu>,
  );
  const trigger = result.baseElement.querySelector("button");
  if (!trigger) throw new Error("trigger button not found");
  act(() => {
    trigger.click();
  });
  return result.baseElement;
}

describe("UserMenu - profileHref clickable header", () => {
  it("renders the header as a link to profileHref when provided", () => {
    const body = renderOpenMenu("/auth/profile");
    const link = body.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/auth/profile");
  });

  it("keeps the user's name and email as the accessible name (no aria-label override)", () => {
    const body = renderOpenMenu("/auth/profile");
    const link = body.querySelector("a");
    expect(link).not.toBeNull();
    // The visible name + email must remain part of the accessible name -
    // an aria-label would suppress them for screen readers.
    expect(link?.getAttribute("aria-label")).toBeNull();
    expect(link?.textContent).toContain("Nico Enking");
    expect(link?.textContent).toContain("nico@example.com");
    // Supplementary, visually-hidden hint that does not replace the name.
    expect(link?.textContent).toContain("Go to profile");
  });

  it("renders the header as a non-interactive label when profileHref is absent", () => {
    const body = renderOpenMenu(undefined);
    expect(body.querySelector("a")).toBeNull();
    // Name/email still shown, just not interactive.
    expect(body.textContent).toContain("Nico Enking");
    expect(body.textContent).toContain("nico@example.com");
  });
});

describe("UserMenu - desktop PopoverContent overflow fix", () => {
  it("bounds the popover height and enables vertical scroll so tall menus stay reachable", () => {
    const body = renderOpenMenu("/auth/profile");
    // The header link lives inside the PopoverContent; walk up to the
    // grid container and assert its constraints.
    const content = body.querySelector("a")?.closest(".grid");
    expect(content).not.toBeNull();
    expect(content?.className).toContain(
      "max-h-[var(--radix-popover-content-available-height)]",
    );
    expect(content?.className).toContain("overflow-y-auto");
    // Two-column grid layout is retained.
    expect(content?.className).toContain("sm:grid-cols-2");
  });
});
