import { render } from "@testing-library/react";
import { LoadingSpinner } from "./LoadingSpinner";
import { describe, it, expect } from "bun:test";

describe("LoadingSpinner", () => {
  it("renders with correct accessibility attributes", () => {
    const { getByRole } = render(<LoadingSpinner />);

    // Should have role="status"
    const status = getByRole("status");
    expect(status).toBeDefined();

    // Should have "Loading..." text for screen readers
    expect(status.textContent).toContain("Loading...");
  });

  it("allows customizing the accessible label", () => {
    const { getByRole } = render(<LoadingSpinner label="Processing..." />);

    const status = getByRole("status");
    expect(status.textContent).toContain("Processing...");
  });
});
