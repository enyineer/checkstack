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
    // A per-row decision reaches the DOM per row, rather than one verdict being
    // painted down the whole rail.
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

/**
 * The third `renderDot` argument: the status the record was IN when each update
 * was posted. A caller holding one item cannot work this out, which is why a
 * lifecycle-coloured dot (maintenance) previously fell back to a flat grey the
 * moment an update changed nothing.
 *
 * The pure carry-forward is covered in `StatusUpdateTimeline.logic.test.ts`;
 * what is pinned here is that it is computed over the timeline's OWN sort order
 * and reaches the callback per item.
 */
describe("StatusUpdateTimeline passes the status in effect to renderDot", () => {
  /** Deliberately passed OLDEST first, so the component has to sort. */
  const history = [
    {
      id: "u1",
      message: "Looking into it",
      createdAt: "2026-07-01T01:00:00Z",
      statusChange: "investigating",
    },
    { id: "u2", message: "No change here", createdAt: "2026-07-01T02:00:00Z" },
    {
      id: "u3",
      message: "Recovering",
      createdAt: "2026-07-01T03:00:00Z",
      statusChange: "monitoring",
    },
  ];

  /** Maps update id -> the status handed to renderDot for it. */
  function captureStatuses(updates: typeof history) {
    const seen = new Map<string, string | undefined>();
    render(
      <StatusUpdateTimeline
        updates={updates}
        renderDot={(item, _index, statusInEffect) => {
          seen.set(item.id, statusInEffect);
          return <TimelineDot className="bg-status-ok" />;
        }}
      />,
    );
    return seen;
  }

  it("gives an update its own status change", () => {
    const seen = captureStatuses(history);

    expect(seen.get("u1")).toBe("investigating");
    expect(seen.get("u3")).toBe("monitoring");
  });

  it("carries the PRECEDING status onto a changeless update", () => {
    // u2 sits between "investigating" (before) and "monitoring" (after). The
    // status when it was posted is the earlier one.
    const seen = captureStatuses(history);

    expect(seen.get("u2")).toBe("investigating");
  });

  it("resolves by recency, not by the caller's array order", () => {
    // The component sorts newest-first internally, so a caller handing over a
    // shuffled list must get the same answer - an index-keyed implementation
    // would silently attribute the wrong status here.
    const shuffled = [history[2]!, history[0]!, history[1]!];
    const seen = captureStatuses(shuffled);

    expect(seen.get("u1")).toBe("investigating");
    expect(seen.get("u2")).toBe("investigating");
    expect(seen.get("u3")).toBe("monitoring");
  });

  it("leaves an update older than every status change undefined", () => {
    // The caller falls back to the record's own tone; inventing one here would
    // claim a lifecycle the timeline cannot actually know.
    const seen = captureStatuses([
      { id: "u1", message: "Early note", createdAt: "2026-07-01T01:00:00Z" },
      {
        id: "u2",
        message: "Recovering",
        createdAt: "2026-07-01T02:00:00Z",
        statusChange: "monitoring",
      },
    ]);

    expect(seen.get("u1")).toBeUndefined();
    expect(seen.get("u2")).toBe("monitoring");
  });
});
