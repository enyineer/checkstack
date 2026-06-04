import { describe, expect, it } from "bun:test";
import { createAltScreen } from "./alt-screen.ts";
import type { AltScreenStream } from "./alt-screen.ts";

const ENTER = "[?1049h";
const EXIT = "[?1049l";

function createCaptureStream(): AltScreenStream & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write(data: string): boolean {
      written.push(data);
      return true;
    },
  };
}

describe("createAltScreen", () => {
  it("writes the alternate-buffer enter sequence on enter()", () => {
    const stream = createCaptureStream();
    const alt = createAltScreen({ stream });
    alt.enter();
    expect(stream.written.join("")).toContain(ENTER);
    expect(alt.isActive).toBe(true);
  });

  it("writes the alternate-buffer exit sequence on leave()", () => {
    const stream = createCaptureStream();
    const alt = createAltScreen({ stream });
    alt.enter();
    alt.leave();
    expect(stream.written.join("")).toContain(EXIT);
    expect(alt.isActive).toBe(false);
  });

  it("always restores: every enter is matched by an exit sequence", () => {
    const stream = createCaptureStream();
    const alt = createAltScreen({ stream });
    alt.enter();
    alt.leave();
    const joined = stream.written.join("");
    expect(joined.indexOf(ENTER)).toBeLessThan(joined.indexOf(EXIT));
  });

  it("is idempotent: repeated enter()/leave() do not double-toggle", () => {
    const stream = createCaptureStream();
    const alt = createAltScreen({ stream });
    alt.enter();
    alt.enter();
    alt.leave();
    alt.leave();
    const enters = stream.written.filter((chunk) => chunk === ENTER).length;
    const exits = stream.written.filter((chunk) => chunk === EXIT).length;
    expect(enters).toBe(1);
    expect(exits).toBe(1);
  });

  it("does nothing on leave() if never entered (no stray exit sequence)", () => {
    const stream = createCaptureStream();
    const alt = createAltScreen({ stream });
    alt.leave();
    expect(stream.written.join("")).not.toContain(EXIT);
    expect(alt.isActive).toBe(false);
  });
});
