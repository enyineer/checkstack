import React from "react";
import { render } from "@testing-library/react";
import { LoadingSpinner } from "./LoadingSpinner";
import { describe, it, expect } from "bun:test";

describe("LoadingSpinner", () => {
  it("renders with correct accessibility attributes", () => {
    const { getByRole } = render(<LoadingSpinner />);
    const spinner = getByRole("status");
    expect(spinner).toBeDefined();
    expect(spinner.getAttribute("aria-label")).toBe("Loading");
    expect(spinner.textContent).toContain("Loading...");
  });

  it("renders with py-12 by default (block mode)", () => {
    const { container } = render(<LoadingSpinner />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("py-12");
    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).not.toContain("inline-flex");
  });

  it("renders inline correctly", () => {
    const { container } = render(<LoadingSpinner inline />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).not.toContain("py-12");
    expect(wrapper.className).toContain("inline-flex");
  });
});
