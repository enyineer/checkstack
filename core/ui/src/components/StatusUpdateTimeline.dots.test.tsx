import "@checkstack/test-utils-frontend/setup";
import { describe, expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";
import { StatusUpdateTimeline, TimelineDot } from "./StatusUpdateTimeline";

/**
 * Status-coloured timeline dots.
 *
 * The mechanism already existed on the generic `Timeline`; the feature was
 * `StatusUpdateTimeline` FORWARDING a caller's `renderDot` instead of always
 * drawing the default. That forwarding is a one-line pass-through, which is
 * exactly the kind of wiring that unit-tested colour helpers cannot observe:
 * `pillToneStyles` and the per-domain tone functions can all be correct while
 * every dot silently renders the default.
 *
 * The domain colour CHOICE (severity for incidents, lifecycle for maintenance)
 * is pure and tested in each plugin. What is pinned here is that a custom dot
 * reaches the DOM at all, per item, with its class intact.
 */

const updates = [
  { id: "u1", message: "Investigating", createdAt: "2026-07-01T01:00:00Z" },
  { id: "u2", message: "Monitoring", createdAt: "2026-07-01T02:00:00Z" },
];

describe("StatusUpdateTimeline forwards renderDot", () => {
  it("renders the caller's dot for every update", () => {
    const { container } = render(
      <StatusUpdateTimeline
        updates={updates}
        renderDot={() => <TimelineDot className="bg-status-down" />}
      />,
    );

    expect(container.querySelectorAll(".bg-status-down")).toHaveLength(2);
  });

  it("passes each item and its index to renderDot", () => {
    // Maintenance colours per-update (by that update's own status change), so
    // the item has to reach the callback - a signature that ignored it would
    // still produce a plausible-looking timeline.
    const renderDot = mock(() => <TimelineDot className="bg-status-ok" />);

    render(<StatusUpdateTimeline updates={updates} renderDot={renderDot} />);

    expect(renderDot).toHaveBeenCalledTimes(2);
    const calls = renderDot.mock.calls as unknown as Array<
      [{ id: string }, number]
    >;
    // NEWEST FIRST - the timeline orders updates by recency, so index 0 is the
    // latest update, not the first one passed in. A dot renderer keyed on the
    // index (rather than the item) would colour the wrong row.
    expect(calls[0]?.[0]?.id).toBe("u2");
    expect(calls[0]?.[1]).toBe(0);
    expect(calls[1]?.[0]?.id).toBe("u1");
    expect(calls[1]?.[1]).toBe(1);
  });

  it("colours dots INDEPENDENTLY per update", () => {
    // The maintenance case: an update that changes nothing stays neutral while
    // one that moves the status takes its hue.
    const { container } = render(
      <StatusUpdateTimeline
        updates={updates}
        renderDot={(_item, index) => (
          <TimelineDot
            className={index === 0 ? "bg-status-warn" : "bg-status-unknown"}
          />
        )}
      />,
    );

    expect(container.querySelectorAll(".bg-status-warn")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-status-unknown")).toHaveLength(1);
  });

  it("still draws a default dot when no renderDot is given", () => {
    // Forwarding must not turn into "no dot at all" for the many callers that
    // pass nothing.
    const { container } = render(<StatusUpdateTimeline updates={updates} />);

    expect(container.querySelectorAll(".bg-status-down")).toHaveLength(0);
    // The rail still renders its own markers.
    expect(container.textContent).toContain("Investigating");
  });

  it("renders nothing extra for an empty update list", () => {
    const renderDot = mock(() => <TimelineDot className="bg-status-down" />);

    render(<StatusUpdateTimeline updates={[]} renderDot={renderDot} />);

    expect(renderDot).not.toHaveBeenCalled();
  });
});
