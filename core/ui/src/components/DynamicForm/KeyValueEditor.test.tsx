import { render, screen } from "@testing-library/react";
import { KeyValueEditor } from "./KeyValueEditor";
import { describe, it, expect, vi } from "bun:test";

describe("KeyValueEditor", () => {
  it("remove button should have aria-label", () => {
    const onChange = vi.fn();
    const value = [{ key: "foo", value: "bar" }];

    render(
      <KeyValueEditor
        id="test-kv"
        value={value}
        onChange={onChange}
      />
    );

    // Should find the remove button by label
    const removeButton = screen.getByLabelText("Remove item");
    expect(removeButton).toBeInTheDocument();
  });
});
