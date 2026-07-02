import { describe, expect, it } from "bun:test";
import { parseCockpitArgs, parsePrNumbers } from "./args.ts";

describe("parsePrNumbers", () => {
  it("parses a comma list, trimming and dropping invalid", () => {
    expect(parsePrNumbers("380, 381 ,x,0,-1")).toEqual([380, 381]);
  });
  it("returns empty for a blank string", () => {
    expect(parsePrNumbers("")).toEqual([]);
  });
});

describe("parseCockpitArgs", () => {
  it("defaults to the dev view in dev mode", () => {
    const args = parseCockpitArgs([]);
    expect(args).toEqual({
      devMode: "dev",
      view: "dev",
      prNumbers: undefined,
      wipe: false,
      fresh: false,
      namespace: "preview",
    });
  });

  it("selects prod-build serving on a `preview` positional", () => {
    expect(parseCockpitArgs(["preview"]).devMode).toBe("preview");
  });

  it("--prs selects the pr-preview view and parses numbers", () => {
    const args = parseCockpitArgs(["--prs", "380,381"]);
    expect(args.view).toBe("pr-preview");
    expect(args.prNumbers).toEqual([380, 381]);
  });

  it("parses --wipe, --fresh and --namespace", () => {
    const args = parseCockpitArgs(["--wipe", "--fresh", "--namespace", "pr-x"]);
    expect(args.wipe).toBe(true);
    expect(args.fresh).toBe(true);
    expect(args.namespace).toBe("pr-x");
  });

  it("stays on the dev view when --prs has no valid numbers", () => {
    expect(parseCockpitArgs(["--prs", "x,y"]).view).toBe("dev");
  });
});
