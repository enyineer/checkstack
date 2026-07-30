import "@checkstack/test-utils-frontend/setup";
import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { SystemPreviewPicker } from "./SystemPreviewPicker";

/**
 * The system picker that makes custom-field templating previewable.
 *
 * Purely presentational, so it needs no client stubs - which also means there
 * was no excuse for it to have had no render coverage at all. The behaviours
 * below are the ones the editor depends on: it must render the SELECTION (not
 * just a placeholder), it must hand back the id, and "No system" must clear
 * rather than select a sentinel.
 */
describe("SystemPreviewPicker", () => {
  const systems = [
    { id: "sys-1", name: "Payments API" },
    { id: "sys-2", name: "Checkout Web" },
  ];

  it("renders nothing when there is nothing to preview against", () => {
    // Documented behaviour: an editor opened with no systems shows no control.
    const { container } = render(
      <SystemPreviewPicker systems={[]} selectedId={null} onSelect={() => {}} />,
    );

    expect(container.textContent).toBe("");
  });

  it("shows the picker once systems exist", () => {
    const { getByText } = render(
      <SystemPreviewPicker
        systems={systems}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    expect(getByText("System:")).toBeTruthy();
  });

  it("displays the SELECTED system's name, not a placeholder", () => {
    // The whole point of the feature: the editor shows which system the
    // template preview is resolving against.
    const { getByText } = render(
      <SystemPreviewPicker
        systems={systems}
        selectedId="sys-2"
        onSelect={() => {}}
      />,
    );

    expect(getByText("Checkout Web")).toBeTruthy();
  });

  it("falls back to the placeholder when nothing is selected", () => {
    const { getByText } = render(
      <SystemPreviewPicker
        systems={systems}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    expect(getByText("No system")).toBeTruthy();
  });

  it("offers every system as an option", () => {
    const { getByRole, getAllByRole } = render(
      <SystemPreviewPicker
        systems={systems}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    fireEvent.click(getByRole("combobox"));
    const labels = getAllByRole("option").map((o) => o.textContent);
    expect(labels).toContain("Payments API");
    expect(labels).toContain("Checkout Web");
    // Plus the explicit "clear" entry.
    expect(labels).toContain("No system");
  });

  it("reports the chosen system's ID", () => {
    const onSelect = mock(() => {});
    const { getByRole, getByText } = render(
      <SystemPreviewPicker
        systems={systems}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(getByRole("combobox"));
    fireEvent.click(getByText("Payments API"));

    expect(onSelect).toHaveBeenCalledWith("sys-1");
  });

  it("reports NULL for 'No system', never the internal sentinel", () => {
    // The Select primitive cannot hold an empty-string value, so the component
    // uses a sentinel internally. Leaking it would make the editor preview
    // against a system id that does not exist.
    const onSelect = mock(() => {});
    const { getByRole, getByText } = render(
      <SystemPreviewPicker
        systems={systems}
        selectedId="sys-1"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(getByRole("combobox"));
    fireEvent.click(getByText("No system"));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
