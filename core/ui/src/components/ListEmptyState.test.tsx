import { describe, expect, it } from "bun:test";
import { render } from "@checkstack/test-utils-frontend";
import { ListEmptyState } from "./ListEmptyState";

describe("ListEmptyState", () => {
  it("renders the default 'No {resource} yet' headline", () => {
    const { getByText } = render(<ListEmptyState resource="checks" />);

    const headline = getByText("No checks yet");
    expect(headline).toBeDefined();
    expect(headline.textContent).toBe("No checks yet");
  });

  it("renders the description when supplied", () => {
    const { getByText } = render(
      <ListEmptyState
        resource="incidents"
        description="Plugins can open incidents when they detect downtime."
      />,
    );

    expect(getByText("No incidents yet")).toBeDefined();
    expect(
      getByText("Plugins can open incidents when they detect downtime."),
    ).toBeDefined();
  });

  it("renders provided actions", () => {
    const { getByRole } = render(
      <ListEmptyState
        resource="checks"
        actions={<button type="button">Create your first check</button>}
      />,
    );

    const button = getByRole("button", { name: "Create your first check" });
    expect(button).toBeDefined();
    expect(button.tagName).toBe("BUTTON");
  });
});
