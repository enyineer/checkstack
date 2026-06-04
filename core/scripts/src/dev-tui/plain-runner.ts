import process from "node:process";
import { isAlertLevel } from "./log-level.ts";
import type { Supervisor } from "./supervisor.ts";

export interface RunPlainStreamingInput {
  supervisor: Supervisor;
  /** Sink for output (defaults to process.stdout). Injectable for smoke tests. */
  write?: (text: string) => void;
  /**
   * Called after a clean shutdown completes (e.g. to exit the process). The
   * entry point owns the actual `process.exit`; this module stays exit-free so
   * it can be smoke-tested without tearing down the test runner.
   */
  onShutdownComplete?: () => void;
}

/**
 * Non-TTY fallback: stream every process's output to stdout with a source
 * prefix, never entering ink's raw mode. Used when piped or in CI so the runner
 * degrades gracefully instead of crashing. Alerts (warn/error) are marked with
 * a leading bang so they remain greppable even without the pinned panel.
 *
 * Returns the registered SIGINT/SIGTERM handler so callers (tests) can trigger
 * a clean shutdown deterministically.
 */
export function runPlainStreaming({
  supervisor,
  write = (text: string): void => {
    process.stdout.write(text);
  },
  onShutdownComplete,
}: RunPlainStreamingInput): () => void {
  supervisor.onLine((line) => {
    const marker = isAlertLevel(line.level) ? "!" : " ";
    write(`${marker}[${line.source}] ${line.text}\n`);
  });

  supervisor.onStatus(({ id, status }) => {
    write(` [${id}] status: ${status}\n`);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    write("\n[dev-tui] shutting down backend + frontend (leaving docker deps up)\n");
    void supervisor.shutdown().then(() => {
      onShutdownComplete?.();
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  supervisor.start();

  return shutdown;
}
