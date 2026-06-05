import { describe, expect, it } from "bun:test";
import { matchesReady, READY_PATTERNS } from "./readiness.ts";

describe("matchesReady", () => {
  it("treats a vite Local URL as ready for the frontend", () => {
    expect(
      matchesReady({
        id: "frontend",
        line: "  ➜  Local:   http://localhost:5173/",
      }),
    ).toBe(true);
  });

  it("treats vite 'ready in' as ready for the frontend", () => {
    expect(
      matchesReady({ id: "frontend", line: "VITE v8.0.0  ready in 312 ms" }),
    ).toBe(true);
  });

  it("treats a backend listening message as ready", () => {
    expect(
      matchesReady({
        id: "backend",
        line: "21:02:49 info: server listening on http://localhost:3000",
      }),
    ).toBe(true);
  });

  it("treats a backend 'ready' message as ready", () => {
    expect(
      matchesReady({ id: "backend", line: "21:02:49 info: backend ready" }),
    ).toBe(true);
  });

  it("does not mark ordinary output as ready", () => {
    expect(
      matchesReady({ id: "backend", line: "21:02:49 info: loading plugin" }),
    ).toBe(false);
    expect(
      matchesReady({ id: "frontend", line: "transforming module foo.ts" }),
    ).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(
      matchesReady({ id: "backend", line: "Server LISTENING on 3000" }),
    ).toBe(true);
  });

  it("has a pattern set for every long-running process", () => {
    expect(READY_PATTERNS.backend.length).toBeGreaterThan(0);
    expect(READY_PATTERNS.frontend.length).toBeGreaterThan(0);
  });
});
