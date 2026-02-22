import { render } from "@testing-library/react";
import { describe, expect, it } from "bun:test";
import { Button } from "./Button";
import React from "react";

describe("Button", () => {
  it("renders correctly", () => {
    const { getByRole } = render(<Button>Click me</Button>);
    const button = getByRole("button", { name: "Click me" });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("shows loading spinner and disables when loading is true", () => {
    const { getByRole, container } = render(<Button loading>Submit</Button>);
    const button = getByRole("button", { name: "Submit" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    // Check for spinner via class or SVG
    // We can use container.querySelector to find the spinner
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("respects disabled prop regardless of loading", () => {
    const { getByRole } = render(<Button disabled>Disabled</Button>);
    const button = getByRole("button", { name: "Disabled" });
    expect(button).toBeDisabled();
  });
});
