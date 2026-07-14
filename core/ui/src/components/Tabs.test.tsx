import "@checkstack/test-utils-frontend/setup";
import { describe, expect, it, mock, jest } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import { Tabs } from "./Tabs";

const items = [
  { id: "one", label: "One", icon: <svg data-testid="icon-one" /> },
  { id: "two", label: "Two" },
];

describe("Tabs", () => {
  it("changes the tab on click", () => {
    const onTabChange = mock();
    const { getByRole } = render(
      <Tabs items={items} activeTab="one" onTabChange={onTabChange} />,
    );
    fireEvent.click(getByRole("tab", { name: "Two" }));
    expect(onTabChange).toHaveBeenCalledWith("two");
  });

  it("prevents mouse-down focus so no highlight can flash before the click commits", () => {
    const { getByRole } = render(
      <Tabs items={items} activeTab="one" onTabChange={() => {}} />,
    );
    // fireEvent returns false when a handler called preventDefault - the
    // Safari fix: pressing (without releasing) must not focus the button.
    expect(fireEvent.mouseDown(getByRole("tab", { name: "Two" }))).toBe(false);
  });

  it("flashes the activated tab on click, then clears the flash", () => {
    // Drive the flash timer with fake timers instead of waiting on the real
    // 250ms setTimeout. A real-timer `waitFor` flaked under the parallel suite:
    // scheduler starvation could push the clear callback past the poll window.
    // Advancing fake time is deterministic and asserts the exact same behaviour.
    jest.useFakeTimers();
    try {
      const { getByRole } = render(
        <Tabs items={items} activeTab="one" onTabChange={() => {}} />,
      );
      const tab = getByRole("tab", { name: "Two" });
      expect(tab.className).not.toContain("ring-2 ring-primary/40");
      fireEvent.click(tab);
      expect(tab.className).toContain("ring-2 ring-primary/40");
      // Past the flash window (the component clears at 250ms); wrap the timer
      // flush in act() so the resulting state update is applied.
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(tab.className).not.toContain("ring-2 ring-primary/40");
    } finally {
      jest.useRealTimers();
    }
  });

  it("only transitions transform on the icon so its color never lags the label", () => {
    const { getByTestId } = render(
      <Tabs items={items} activeTab="one" onTabChange={() => {}} />,
    );
    const iconWrapper = getByTestId("icon-one").parentElement;
    // Regression guard for the Safari icon-lag fix: `transition-all` on this
    // span would re-transition the color inherited from the (already
    // transitioning) button.
    expect(iconWrapper?.className).toContain("transition-transform");
    expect(iconWrapper?.className).not.toContain("transition-all");
  });

  it("selects tabs with arrow keys", () => {
    const onTabChange = mock();
    const { getByRole } = render(
      <Tabs items={items} activeTab="one" onTabChange={onTabChange} />,
    );
    fireEvent.keyDown(getByRole("tab", { name: "One" }), {
      key: "ArrowRight",
    });
    expect(onTabChange).toHaveBeenCalledWith("two");
  });
});
