import { render } from "@testing-library/react";
import { LoadingSpinner } from "./LoadingSpinner";
import { describe, it, expect } from "bun:test";
import React from "react";

describe("LoadingSpinner", () => {
  it("renders with correct accessibility attributes", () => {
    const { getByRole } = render(<LoadingSpinner />);
    const spinner = getByRole("status");
    expect(spinner).toBeInTheDocument();

    // Check for visually hidden text
    expect(spinner).toHaveTextContent("Loading");
  });

  it("renders with custom label", () => {
    const { getByRole } = render(<LoadingSpinner label="Processing..." />);
    const spinner = getByRole("status");
    expect(spinner).toHaveTextContent("Processing...");
  });
});
