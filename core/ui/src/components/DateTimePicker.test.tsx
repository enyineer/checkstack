import { render, screen } from "@testing-library/react";
import { DateTimePicker } from "./DateTimePicker";
import { describe, it, expect, vi } from "bun:test";

describe("DateTimePicker", () => {
  it("calendar trigger button should have aria-label", () => {
    const onChange = vi.fn();
    const value = new Date();

    render(
      <DateTimePicker
        value={value}
        onChange={onChange}
      />
    );

    // Should find the button by label
    const button = screen.getByLabelText("Open calendar");
    expect(button).toBeInTheDocument();
  });
});
