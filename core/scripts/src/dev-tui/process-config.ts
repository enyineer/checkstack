import type { ProcessId } from "./types.ts";

/** Static definition of one supervised process. */
export interface ProcessDef {
  readonly id: ProcessId;
  /** Human-readable name shown in the sidebar. */
  readonly label: string;
  /** Executable to spawn. */
  readonly command: string;
  /** Arguments passed to the executable. */
  readonly args: readonly string[];
  /**
   * Working directory for the process, RELATIVE to the runner's root cwd (the
   * repo root). Undefined runs at the root. Each long-running dev task runs
   * directly in its own package dir so it streams that package's RAW output
   * (e.g. winston `HH:MM:SS warn:` lines) - never through bun's `--filter`
   * multi-task runner, which buffers + frames output and would defeat the
   * per-line level detection feeding the Alerts panel.
   */
  readonly cwd?: string;
  /**
   * Whether this is a one-shot task (docker compose up -d) vs a long-running
   * watcher. One-shot tasks become "ready" on a zero exit code; long-running
   * ones become "ready" on a readiness marker and "stopped"/"errored" on exit.
   */
  readonly oneShot: boolean;
}

/**
 * The three supervised processes, in sidebar order. The runner spawns each
 * command DIRECTLY (no `bun run --filter`): deps via docker at the repo root,
 * and each dev watcher via its own package's `dev` script in that package's
 * dir. Running the package script directly streams its raw output, which the
 * per-line level detection (and the Alerts panel) depends on; bun's `--filter`
 * runner instead buffers/frames output through its task dashboard.
 */
export const PROCESS_DEFS: readonly ProcessDef[] = [
  {
    id: "deps",
    label: "deps (docker)",
    command: "docker",
    args: ["compose", "-f", "docker-compose-dev.yml", "up", "-d"],
    oneShot: true,
  },
  {
    id: "backend",
    label: "backend",
    command: "bun",
    args: ["run", "dev"],
    cwd: "core/backend",
    oneShot: false,
  },
  {
    id: "frontend",
    label: "frontend",
    command: "bun",
    args: ["run", "dev"],
    cwd: "core/frontend",
    oneShot: false,
  },
];

/** Runner mode: `dev` serves the unbundled Vite dev server; `preview` serves the
 *  production build via `vite preview`. */
export type DevMode = "dev" | "preview";

/**
 * Process definitions for a given mode. Only the frontend differs: in `preview`
 * it builds the production bundle and serves it with `vite preview` (the
 * `preview:prod` script) instead of running the dev server. It serves on the
 * same port the dev server uses so `BASE_URL` (which points at that origin)
 * stays same-origin and the SPA's credentialed `/api` calls are not CORS-blocked
 * - exactly the prod serving path, minus a separate backend deployment.
 */
export function getProcessDefs(mode: DevMode = "dev"): readonly ProcessDef[] {
  if (mode !== "preview") {
    return PROCESS_DEFS;
  }
  return PROCESS_DEFS.map((def) =>
    def.id === "frontend"
      ? { ...def, label: "frontend (preview)", args: ["run", "preview:prod"] }
      : def,
  );
}
