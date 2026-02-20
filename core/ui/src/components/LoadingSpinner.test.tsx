import { render } from "@testing-library/react";
import { LoadingSpinner } from "./LoadingSpinner";
import { describe, it, expect } from "bun:test";

describe("LoadingSpinner", () => {
  it("renders with correct accessibility attributes", () => {
    const { getByRole, getByText } = render(<LoadingSpinner />);

    // Should have role="status"
    const spinner = getByRole("status");
    expect(spinner).toBeInTheDocument();

    // Should have visually hidden text
    const text = getByText("Loading...");
    expect(text).toBeInTheDocument();
    expect(text.className).toContain("sr-only");
  });

  it("applies size classes correctly", () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    // Check for size-specific class in the inner div (the spinner itself)
    // The spinner is the second child (first is the sr-only span if implemented correctly)
    // But currently it's the only child. After my change it will be the second.
    // So let's look for the element with animate-spin class.
    const spinnerElement = container.querySelector(".animate-spin");
    expect(spinnerElement?.className).toContain("w-4 h-4");
  });

  it("applies custom className to container", () => {
    const { container } = render(<LoadingSpinner className="custom-class" />);
    expect(container.firstChild?.className).toContain("custom-class");
  });
});
