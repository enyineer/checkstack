import React from "react";
import { render } from "@testing-library/react";
import { DateTimePicker } from "./DateTimePicker";
import { describe, it, expect, vi } from "bun:test";

describe("DateTimePicker", () => {
  it("renders with correct accessibility attributes", () => {
    const onChange = vi.fn();
    // Use a fixed date to avoid timezone issues, though rendering inputs shouldn't be affected
    const value = new Date("2023-10-15T14:30:00");

    const { getByLabelText } = render(
      <DateTimePicker
        value={value}
        onChange={onChange}
      />
    );

    // Should find the calendar trigger button
    expect(getByLabelText("Open calendar")).toBeTruthy();

    // Should find the date inputs
    expect(getByLabelText("Day")).toBeTruthy();
    expect(getByLabelText("Month")).toBeTruthy();
    expect(getByLabelText("Year")).toBeTruthy();

    // Should find the time inputs
    expect(getByLabelText("Hour")).toBeTruthy();
    expect(getByLabelText("Minute")).toBeTruthy();
  });
});
