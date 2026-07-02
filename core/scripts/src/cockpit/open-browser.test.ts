import { describe, expect, it } from "bun:test";
import { extractServedUrl, attachBrowserAutoOpen } from "./open-browser.ts";
import type { Supervisor } from "../dev-tui/supervisor.ts";
import type { CapturedLine } from "../dev-tui/supervisor.ts";

describe("extractServedUrl", () => {
  it("extracts the vite Local url (ansi-decorated)", () => {
    expect(
      extractServedUrl("  [32m➜[39m  Local:   http://localhost:5173/"),
    ).toBe("http://localhost:5173/");
  });

  it("extracts a random preview port", () => {
    expect(extractServedUrl("  ➜  Local:   http://localhost:41234/")).toBe(
      "http://localhost:41234/",
    );
  });

  it("returns null for non-banner lines", () => {
    expect(extractServedUrl("  ➜  Network: use --host to expose")).toBeNull();
    expect(extractServedUrl("VITE v5.0.0  ready in 312 ms")).toBeNull();
  });
});

/** Minimal supervisor stub that lets a test push lines through onLine. */
function makeStubSupervisor(): {
  supervisor: Supervisor;
  emit: (line: CapturedLine) => void;
} {
  const listeners: ((line: CapturedLine) => void)[] = [];
  const supervisor = {
    start() {},
    restart() {},
    async shutdown() {},
    statusOf: () => "stopped" as const,
    onLine(listener: (line: CapturedLine) => void) {
      listeners.push(listener);
    },
    onStatus() {},
  } satisfies Supervisor;
  return {
    supervisor,
    emit: (line) => {
      for (const listener of listeners) listener(line);
    },
  };
}

describe("attachBrowserAutoOpen", () => {
  it("opens the frontend url once when its Local banner appears", () => {
    const { supervisor, emit } = makeStubSupervisor();
    const opened: string[] = [];
    attachBrowserAutoOpen({ supervisor, open: (url) => opened.push(url) });

    // Backend lines and non-banner frontend lines are ignored.
    emit({ source: "backend", level: "info", text: "Local: http://localhost:3000/", seq: 1 });
    emit({ source: "frontend", level: "info", text: "VITE ready in 200 ms", seq: 2 });
    expect(opened).toEqual([]);

    emit({ source: "frontend", level: "info", text: "  ➜  Local:   http://localhost:5173/", seq: 3 });
    // A restart reprints the banner; must NOT reopen.
    emit({ source: "frontend", level: "info", text: "  ➜  Local:   http://localhost:5173/", seq: 4 });

    expect(opened).toEqual(["http://localhost:5173/"]);
  });
});
