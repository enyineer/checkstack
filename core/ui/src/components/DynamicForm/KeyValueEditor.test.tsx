import { render } from "@testing-library/react";
import { KeyValueEditor } from "./KeyValueEditor";
import { describe, it, expect, vi } from "bun:test";

describe("KeyValueEditor", () => {
  it("renders with correct accessibility attributes", () => {
    const onChange = vi.fn();
    const value = [{ key: "test-key", value: "test-value" }];

    const { getByLabelText } = render(
      <KeyValueEditor
        id="test-editor"
        value={value}
        onChange={onChange}
      />,
    );

    // Check for remove button with aria-label
    const removeButton = getByLabelText("Remove item");
    expect(removeButton).toBeInTheDocument();
    expect(removeButton.tagName).toBe("BUTTON");

    // Check for inputs with aria-label
    const keyInput = getByLabelText("Key");
    expect(keyInput).toBeInTheDocument();
    expect(keyInput.tagName).toBe("INPUT");
    expect(keyInput).toHaveValue("test-key");

    const valueInput = getByLabelText("Value");
    expect(valueInput).toBeInTheDocument();
    expect(valueInput.tagName).toBe("INPUT");
    expect(valueInput).toHaveValue("test-value");
  });

  it("renders custom placeholders as aria-labels", () => {
    const onChange = vi.fn();
    const value = [{ key: "custom-key", value: "custom-value" }];

    const { getByLabelText } = render(
      <KeyValueEditor
        id="custom-editor"
        value={value}
        onChange={onChange}
        keyPlaceholder="Custom Key Name"
        valuePlaceholder="Custom Value Name"
      />,
    );

    const keyInput = getByLabelText("Custom Key Name");
    expect(keyInput).toBeInTheDocument();

    const valueInput = getByLabelText("Custom Value Name");
    expect(valueInput).toBeInTheDocument();
  });
});
