import { render, waitFor } from "@testing-library/react";
import { AnimatedNumber } from "./AnimatedNumber";
import React from "react";
import { describe, it, expect } from "bun:test";

describe("AnimatedNumber", () => {
  it("renders correctly and updates to final value", async () => {
    const { getByText } = render(<AnimatedNumber value={100} duration={50} />);

    // Wait for animation to finish
    await waitFor(() => {
      expect(getByText("100.00")).toBeTruthy();
    }, { timeout: 2000 });
  });

  it("handles updates without re-mounting", async () => {
    const { rerender, getByText } = render(<AnimatedNumber value={0} duration={50} />);

    await waitFor(() => expect(getByText("0.00")).toBeTruthy());

    rerender(<AnimatedNumber value={100} duration={50} />);

    await waitFor(() => expect(getByText("100.00")).toBeTruthy());
  });

  it("renders N/A for undefined value", async () => {
    const { getByText } = render(<AnimatedNumber value={undefined} duration={50} />);
    await waitFor(() => expect(getByText("N/A")).toBeTruthy());
  });
});
