import type { ProcessDef } from "../../dev-tui/process-config.ts";

export interface BuildPreviewProcessDefsInput {
  /** Random free port the preview backend listens on. */
  readonly backendPort: number;
  /** Random free port the preview frontend (vite) serves on. */
  readonly vitePort: number;
  /** DATABASE_URL pointing at the ephemeral preview database copy. */
  readonly previewDatabaseUrl: string;
  /** Instance namespace for shared-infra isolation (e.g. "preview"). */
  readonly namespace: string;
  /**
   * Isolated CHECKSTACK_DATA_DIR for the preview's script-package store, seeded
   * from the dev instance so its package trees are already built (no cold
   * `bun install --offline` reconcile). See {@link previewDataDir}.
   */
  readonly dataDir: string;
}

/**
 * Build the supervised process defs for the preview instance. Mirrors the dev
 * backend/frontend, but each carries an `env` override so it runs as a SECONDARY
 * instance:
 *
 * - backend: its own PORT, BASE_URL pointing at the preview vite origin,
 *   INTERNAL_URL pointing at its OWN port (so intra-instance server-to-server
 *   RPC targets this preview backend, not the primary dev backend on :3000),
 *   the preview DATABASE_URL, and CHECKSTACK_INSTANCE_NAMESPACE so it namespaces
 *   shared redis/BullMQ state (PR A). It still loads `../../.env` for secrets;
 *   real env wins over the env-file, so these overrides take effect.
 * - frontend: vite on its own port with `--strictPort`, and
 *   CHECKSTACK_DEV_BACKEND_URL so its proxy targets the preview backend instead
 *   of the primary dev backend.
 *
 * `cwd` is RELATIVE to the supervisor's cwd, which for the preview instance is
 * the merged worktree root - so these run against the merged code, not the
 * primary checkout.
 */
export function buildPreviewProcessDefs({
  backendPort,
  vitePort,
  previewDatabaseUrl,
  namespace,
  dataDir,
}: BuildPreviewProcessDefsInput): ProcessDef[] {
  return [
    {
      id: "backend",
      label: `preview backend :${backendPort}`,
      command: "bun",
      args: ["--env-file=../../.env", "--watch", "src/index.ts"],
      cwd: "core/backend",
      oneShot: false,
      env: {
        PORT: String(backendPort),
        BASE_URL: `http://localhost:${vitePort}`,
        INTERNAL_URL: `http://localhost:${backendPort}`,
        DATABASE_URL: previewDatabaseUrl,
        CHECKSTACK_INSTANCE_NAMESPACE: namespace,
        CHECKSTACK_DATA_DIR: dataDir,
      },
    },
    {
      id: "frontend",
      label: `preview frontend :${vitePort}`,
      command: "bun",
      args: ["x", "vite", "--port", String(vitePort), "--strictPort"],
      cwd: "core/frontend",
      oneShot: false,
      env: {
        CHECKSTACK_DEV_BACKEND_URL: `http://localhost:${backendPort}`,
      },
    },
  ];
}
