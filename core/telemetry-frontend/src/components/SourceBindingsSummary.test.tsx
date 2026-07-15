import "@checkstack/test-utils-frontend/setup";
import { describe, it, expect } from "bun:test";
import { render } from "@checkstack/test-utils-frontend";
import { SourceBindingsSummary } from "./SourceBindingsSummary";

describe("SourceBindingsSummary", () => {
  it("renders a badge per bound signal, id in the tooltip when no name resolved", () => {
    const { container } = render(
      <SourceBindingsSummary
        bindings={[
          { signal: "logs", streamId: "log-stream" },
          { signal: "metrics", streamId: "metric-stream" },
        ]}
      />,
    );
    const badges = container.querySelectorAll("[title]");
    expect(badges.length).toBe(2);
    const text = container.textContent ?? "";
    expect(text).toContain("Logs");
    expect(text).toContain("Metrics");
    expect(
      container.querySelector('[title="Logs → stream log-stream"]'),
    ).not.toBeNull();
  });

  it("shows the resolved stream name and puts it in the tooltip", () => {
    const { container } = render(
      <SourceBindingsSummary
        bindings={[{ signal: "logs", streamId: "log-stream" }]}
        bindingStreamNames={{ logs: "Payments logs" }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Logs");
    expect(text).toContain("Payments logs");
    expect(
      container.querySelector('[title="Logs → Payments logs"]'),
    ).not.toBeNull();
  });

  it("falls back to the stream id tooltip when a name did not resolve (null)", () => {
    const { container } = render(
      <SourceBindingsSummary
        bindings={[{ signal: "metrics", streamId: "metric-stream" }]}
        bindingStreamNames={{ metrics: null }}
      />,
    );
    expect(
      container.querySelector('[title="Metrics → stream metric-stream"]'),
    ).not.toBeNull();
  });

  it("shows a 'Not routed' hint when there are no bindings", () => {
    const { container } = render(<SourceBindingsSummary bindings={[]} />);
    expect(container.textContent).toContain("Not routed");
  });
});
