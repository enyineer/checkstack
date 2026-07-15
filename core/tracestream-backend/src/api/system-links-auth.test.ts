import { describe, it, expect } from "bun:test";
import { assertAddedSystemsReadable } from "./system-links-auth";

describe("assertAddedSystemsReadable", () => {
  it("passes when every added system is in the caller's readable set", () => {
    expect(() =>
      assertAddedSystemsReadable({
        addedSystemIds: ["sys-1", "sys-2"],
        readableSystemIds: ["sys-1", "sys-2", "sys-3"],
      }),
    ).not.toThrow();
  });

  it("throws FORBIDDEN when an added system is not readable", () => {
    expect(() =>
      assertAddedSystemsReadable({
        addedSystemIds: ["sys-1", "sys-hidden"],
        readableSystemIds: ["sys-1"],
      }),
    ).toThrow(/only link systems you can read/i);
  });

  it("passes vacuously for an empty added set", () => {
    expect(() =>
      assertAddedSystemsReadable({
        addedSystemIds: [],
        readableSystemIds: [],
      }),
    ).not.toThrow();
  });
});
