import { describe, expect, it } from "bun:test";
import { statusPageContract } from "@checkstack/status-page-common";
import {
  PUBLIC_HOST_PROCEDURES,
  buildPublicHostApiPaths,
} from "./public-api-paths";

/**
 * A custom-domain host 404s every `/api` path outside this allow-list, so an
 * omission breaks that procedure ON CUSTOM DOMAINS ONLY - silently, because the
 * in-app `/statuspage/view/<slug>` route is unaffected. Nothing else in the
 * suite would notice.
 */
describe("public-host API allow-list", () => {
  it("includes the mention resolver the public pages call", () => {
    // Without this, `#` references resolve in the app and render as plain text
    // on every customer domain - the exact failure this list makes invisible.
    expect(PUBLIC_HOST_PROCEDURES).toContain("resolvePublicMentions");
  });

  it("includes the page read and both detail reads", () => {
    for (const name of [
      "getPublishedStatusPage",
      "getPublishedIncident",
      "getPublishedMaintenance",
    ] as const) {
      expect(PUBLIC_HOST_PROCEDURES).toContain(name);
    }
  });

  it("names only procedures that actually exist on the contract", () => {
    // A renamed procedure must break here rather than 404 on a real domain.
    for (const name of PUBLIC_HOST_PROCEDURES) {
      expect(statusPageContract).toHaveProperty(name);
    }
  });

  it("builds platform-shaped /api/<pluginId>/<procedure> paths", () => {
    expect(buildPublicHostApiPaths({ pluginId: "statuspage" })).toEqual([
      "/api/statuspage/getPublishedStatusPage",
      "/api/statuspage/getPublishedIncident",
      "/api/statuspage/getPublishedMaintenance",
      "/api/statuspage/resolvePublicMentions",
    ]);
  });

  it("exposes nothing that mutates", () => {
    // The list gates an ANONYMOUS surface: every entry must be a read.
    for (const name of PUBLIC_HOST_PROCEDURES) {
      expect(name.startsWith("get") || name.startsWith("resolve")).toBe(true);
    }
  });
});
