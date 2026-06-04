import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import { App, ShutdownScreen } from "./App.tsx";
import { SPINNER_FRAMES } from "../tui/index.ts";
import { createFakeSupervisor } from "./fake-supervisor.ts";
import { runPlainStreaming } from "./plain-runner.ts";

describe("App initial frame (DOM-free smoke test)", () => {
  it("renders the chrome without throwing and starts the supervisor", () => {
    const supervisor = createFakeSupervisor();
    const frame = renderToString(<App supervisor={supervisor} />, {
      columns: 100,
    });

    // App name + footer hints + every process label render in the first frame.
    expect(frame).toContain("checkstack dev");
    expect(frame).toContain("backend");
    expect(frame).toContain("frontend");
    expect(frame).toContain("deps");
    expect(frame).toContain("alerts");
    expect(frame).toContain("quit");

    // The mount effect kicks off the supervisor.
    expect(supervisor.started).toBe(true);
  });
});

describe("ShutdownScreen", () => {
  it("shows the shutdown heading + a spinner while services stop", () => {
    const frame = renderToString(
      <ShutdownScreen
        width={80}
        height={20}
        frame={0}
        statuses={{ deps: "ready", backend: "starting", frontend: "starting" }}
      />,
    );
    expect(frame).toContain("Shutting down checkstack dev");
    // Long-running services are listed and still spinning (not yet stopped).
    expect(frame).toContain("backend");
    expect(frame).toContain("frontend");
    expect(frame).toContain(SPINNER_FRAMES[0]);
    // The one-shot deps process is left running, so it is not listed.
    expect(frame).not.toContain("✓");
  });

  it("marks a stopped service with a check", () => {
    const frame = renderToString(
      <ShutdownScreen
        width={80}
        height={20}
        frame={0}
        statuses={{ deps: "ready", backend: "stopped", frontend: "starting" }}
      />,
    );
    expect(frame).toContain("✓");
    expect(frame).toContain("stopped");
  });

  it("treats a non-zero exit during shutdown as stopped, not an error", () => {
    // We killed the process on purpose; dev servers (e.g. Vite) often exit 143/1
    // on SIGTERM, which the supervisor records as 'errored'. During teardown
    // that is expected - show a check, never a cross.
    const frame = renderToString(
      <ShutdownScreen
        width={80}
        height={20}
        frame={0}
        statuses={{ deps: "ready", backend: "stopped", frontend: "errored" }}
      />,
    );
    expect(frame).not.toContain("✗");
    // Both long-running services are shown as stopped (two checks).
    expect(frame.match(/✓/g) ?? []).toHaveLength(2);
  });
});

describe("runPlainStreaming (non-TTY fallback)", () => {
  it("starts the supervisor and prefixes each line with its source", () => {
    const supervisor = createFakeSupervisor();
    const out: string[] = [];
    runPlainStreaming({
      supervisor,
      write: (text) => out.push(text),
    });

    expect(supervisor.started).toBe(true);

    supervisor.emitLine({
      source: "backend",
      level: "info",
      text: "21:02:49 info: hello",
      seq: 1,
    });
    expect(out.join("")).toContain("[backend] 21:02:49 info: hello");
  });

  it("marks warn/error lines with a leading bang so they stay greppable", () => {
    const supervisor = createFakeSupervisor();
    const out: string[] = [];
    runPlainStreaming({ supervisor, write: (text) => out.push(text) });

    supervisor.emitLine({
      source: "backend",
      level: "warn",
      text: "sandbox not ready",
      seq: 1,
    });
    expect(out.some((chunk) => chunk.startsWith("!"))).toBe(true);
  });

  it("emits status transitions", () => {
    const supervisor = createFakeSupervisor();
    const out: string[] = [];
    runPlainStreaming({ supervisor, write: (text) => out.push(text) });

    supervisor.emitStatus({ id: "frontend", status: "ready" });
    expect(out.join("")).toContain("[frontend] status: ready");
  });

  it("shuts down the supervisor and invokes the completion callback", async () => {
    const supervisor = createFakeSupervisor();
    const out: string[] = [];
    let completed = false;
    const shutdown = runPlainStreaming({
      supervisor,
      write: (text) => out.push(text),
      onShutdownComplete: () => {
        completed = true;
      },
    });

    shutdown();
    // Allow the shutdown microtask to resolve.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(supervisor.didShutdown).toBe(true);
    expect(completed).toBe(true);
    expect(out.join("")).toContain("shutting down");
  });
});
