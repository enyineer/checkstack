// Registers Happy DOM globals + Testing Library cleanup. Imported directly so
// the test has a DOM under both the package-scoped and root test runners.
import "@checkstack/test-utils-frontend/setup";
import { describe, it, expect, mock } from "bun:test";
import { render } from "@checkstack/test-utils-frontend";
import type { SourceTypeDescriptor } from "@checkstack/telemetry-common";
import { SourceTypeCatalog } from "./SourceTypeCatalog";

const descriptor = (
  over: Partial<SourceTypeDescriptor> & { id: string },
): SourceTypeDescriptor => ({
  ownerPluginId: "demo",
  displayName: over.id,
  description: "",
  signals: ["logs"],
  modes: ["webhook"],
  configSchema: { type: "object", properties: {} },
  supportsSatellite: false,
  ...over,
});

describe("SourceTypeCatalog", () => {
  it("renders a card per type with its modes and signals", () => {
    const { container } = render(
      <SourceTypeCatalog
        sourceTypes={[
          descriptor({
            id: "demo.poller",
            displayName: "Poller",
            modes: ["pull"],
            signals: ["metrics"],
          }),
          descriptor({ id: "demo.hook", displayName: "Hook" }),
        ]}
        onSelect={() => {}}
      />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    const text = container.textContent ?? "";
    expect(text).toContain("Poller");
    expect(text).toContain("Hook");
    expect(text).toContain("pull");
    expect(text).toContain("metrics");
  });

  it("calls onSelect with the picked descriptor", () => {
    const onSelect = mock((_: SourceTypeDescriptor) => {});
    const { container } = render(
      <SourceTypeCatalog
        sourceTypes={[
          descriptor({ id: "demo.a", displayName: "Alpha" }),
          descriptor({ id: "demo.hook", displayName: "Hook" }),
        ]}
        onSelect={onSelect}
      />,
    );
    const hookButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Hook"),
    );
    hookButton?.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe("demo.hook");
  });
});
