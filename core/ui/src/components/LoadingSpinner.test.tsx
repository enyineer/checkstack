import { render } from "@testing-library/react";
import { describe, expect, it } from "bun:test";
import { LoadingSpinner } from "./LoadingSpinner";
import React from "react";

describe("LoadingSpinner", () => {
  it("renders with default accessibility attributes", () => {
    const { getByRole } = render(<LoadingSpinner />);
    const spinner = getByRole("status");
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute("aria-label", "Loading...");
  });

  it("allows overriding aria-label", () => {
    const { getByRole } = render(<LoadingSpinner aria-label="Please wait" />);
    const spinner = getByRole("status");
    expect(spinner).toHaveAttribute("aria-label", "Please wait");
  });

  it("applies custom className", () => {
    const { getByTestId } = render(<LoadingSpinner className="custom-class" data-testid="spinner" />);
    const spinner = getByTestId("spinner");
    expect(spinner).toHaveClass("custom-class");
  });
});
