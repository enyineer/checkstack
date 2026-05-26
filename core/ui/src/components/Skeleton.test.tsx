import { describe, expect, it, mock, beforeEach } from "bun:test";
import { render } from "@checkstack/test-utils-frontend";
import { usePerformance } from "./PerformanceProvider";
import { Skeleton } from "./Skeleton";

mock.module("./PerformanceProvider", () => ({
  usePerformance: mock(),
}));

const setLowPower = (isLowPower: boolean) => {
  (usePerformance as ReturnType<typeof mock>).mockReturnValue({
    isLowPower,
    isLoaded: true,
    manualLowPower: isLowPower,
    toggleManualLowPower: () => undefined,
  });
};

const expectElement = (node: ChildNode | null): HTMLElement => {
  if (!(node instanceof HTMLElement)) {
    throw new Error("expected first child to be an HTMLElement");
  }
  return node;
};

describe("Skeleton", () => {
  beforeEach(() => {
    setLowPower(false);
  });

  it("renders a muted block with the pulse animation by default", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const element = expectElement(container.firstChild);

    expect(element.className).toContain("bg-muted");
    expect(element.className).toContain("animate-pulse");
  });

  it("drops the pulse animation when isLowPower is true", () => {
    setLowPower(true);

    const { container } = render(<Skeleton className="h-4 w-32" />);
    const element = expectElement(container.firstChild);

    expect(element.className).toContain("bg-muted");
    expect(element.className).not.toContain("animate-pulse");
  });

  it("forwards additional className to the rendered element", () => {
    const { container } = render(<Skeleton className="custom-class" />);
    const element = expectElement(container.firstChild);

    expect(element.className).toContain("custom-class");
  });
});
