import { stripAnsi } from "./text.ts";
import type { ProcessId } from "./types.ts";

/**
 * Readiness detection for the long-running dev processes. A process starts in
 * "starting" and flips to "ready" the first time one of its readiness markers
 * appears in its output. Patterns are kept conservative so ordinary log lines
 * do not trigger a false "ready".
 *
 * `deps` (docker compose) has no streaming readiness marker - its readiness is
 * driven by the compose command's exit code, not by matching a line - so it has
 * an empty pattern set here.
 */
export const READY_PATTERNS: Readonly<Record<ProcessId, readonly RegExp[]>> = {
  deps: [],
  backend: [
    // winston: "... info: server listening on http://localhost:3000"
    /\blistening\b/i,
    // a generic "<something> ready" banner
    /\bready\b/i,
    // a bound HTTP url is a strong readiness signal
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/i,
  ],
  frontend: [
    // vite dev server: "  ➜  Local:   http://localhost:5173/"
    /\blocal:\s*https?:\/\//i,
    // vite: "ready in 312 ms"
    /\bready in\b/i,
  ],
};

export interface MatchesReadyInput {
  id: ProcessId;
  /** A single raw output line (ANSI is stripped internally). */
  line: string;
}

/**
 * Whether a given output line indicates the named process has become ready.
 */
export function matchesReady({ id, line }: MatchesReadyInput): boolean {
  const plain = stripAnsi(line);
  return READY_PATTERNS[id].some((pattern) => pattern.test(plain));
}
