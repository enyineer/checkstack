import { describe, expect, it } from "bun:test";
import { resolveRoute } from "@checkstack/common";
import { tracestreamRoutes } from "@checkstack/tracestream-common";
import { buildViewTraceHref } from "./view-trace-link";

describe("buildViewTraceHref", () => {
  it("targets the stream detail route with the traces tab and trace params", () => {
    // Derive the expected base from the route definition so a change to the
    // route follows here automatically instead of dead-linking silently.
    const base = resolveRoute(tracestreamRoutes.routes.detail, {
      streamId: "stream-1",
    });
    expect(buildViewTraceHref({ streamId: "stream-1", traceId: "abc123" })).toBe(
      `${base}?tab=traces&trace=abc123`,
    );
  });

  it("puts the stream id on the path and the trace id in the query", () => {
    const href = buildViewTraceHref({ streamId: "stream-9", traceId: "def456" });
    expect(href).toContain("stream-9");
    expect(href).toContain("tab=traces");
    expect(href).toContain("trace=def456");
  });

  it("encodes a trace id with url-unsafe characters in the query string", () => {
    const base = resolveRoute(tracestreamRoutes.routes.detail, {
      streamId: "s",
    });
    expect(buildViewTraceHref({ streamId: "s", traceId: "id with space" })).toBe(
      `${base}?tab=traces&trace=id+with+space`,
    );
  });
});
