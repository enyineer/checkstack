import "@checkstack/test-utils-frontend/setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { TraceWaterfall } from "./TraceWaterfall";
import type { WaterfallSpan } from "./TraceWaterfall.logic";

const T0 = 1_700_000_000_000;

const spans: WaterfallSpan[] = [
  {
    spanId: "root",
    parentSpanId: null,
    name: "POST /checkout",
    serviceName: "api",
    kind: "server",
    startTs: T0,
    durationMs: 200,
    statusCode: "error",
  },
  {
    spanId: "child",
    parentSpanId: "root",
    name: "SELECT users",
    serviceName: "postgres",
    kind: "client",
    startTs: T0 + 40,
    durationMs: 60,
    statusCode: "ok",
  },
];

/**
 * happy-dom has no layout engine: patch a positive rect per test so measured
 * widths are non-zero, then RESTORE it in `afterEach` - a leaked prototype
 * override would break sibling chart tests that assert on an initially-unknown
 * width (the suites share one process).
 */
const originalGetRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { ...originalGetRect.call(this), width: 800, height: 400 } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetRect;
  cleanup();
});

// happy-dom has no layout engine, so the row virtualizer mounts no rows; the
// tree/flatten/collapse/click behaviour is covered exhaustively in
// `TraceWaterfall.logic.test.ts`. Here we only assert the non-virtualized
// chrome (span-count summary, collapse toggle, empty state) renders.
describe("TraceWaterfall", () => {
  it("renders the toolbar span count and duration summary", () => {
    const { getByText } = render(<TraceWaterfall spans={spans} />);
    expect(getByText(/2 spans/)).not.toBeNull();
  });

  it("offers a collapse-all toggle when there are parent spans", () => {
    const { getByText } = render(<TraceWaterfall spans={spans} />);
    expect(getByText("Collapse all")).not.toBeNull();
  });

  it("renders an explicit empty state with no spans", () => {
    const { getByText } = render(<TraceWaterfall spans={[]} />);
    expect(getByText(/no spans/i)).not.toBeNull();
  });
});
