import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";
import { describe, it, expect, vi } from "bun:test";

describe("FormField", () => {
  it("array items remove button should have aria-label", () => {
    const onChange = vi.fn();
    const propSchema = {
      type: "array",
      items: {
        type: "string",
      },
    };

    render(
      <FormField
        id="test-array"
        label="Tags"
        propSchema={propSchema}
        value={["tag1"]}
        onChange={onChange}
      />
    );

    // Should find the remove button by label
    const removeButton = screen.getByLabelText("Remove Tags #1");
    expect(removeButton).toBeInTheDocument();
  });
});
