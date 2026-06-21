import { describe, expect, it } from "bun:test";
import { shouldBlockNavigation } from "./useUnsavedChanges";

describe("shouldBlockNavigation", () => {
  it("blocks when dirty and navigating to a different path", () => {
    expect(
      shouldBlockNavigation({
        isDirty: true,
        currentPathname: "/edit/1",
        nextPathname: "/list",
      }),
    ).toBe(true);
  });

  it("does not block when the form is clean", () => {
    expect(
      shouldBlockNavigation({
        isDirty: false,
        currentPathname: "/edit/1",
        nextPathname: "/list",
      }),
    ).toBe(false);
  });

  it("does not block a same-path transition (e.g. a search-param change)", () => {
    expect(
      shouldBlockNavigation({
        isDirty: true,
        currentPathname: "/edit/1",
        nextPathname: "/edit/1",
      }),
    ).toBe(false);
  });
});
