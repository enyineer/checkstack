import path from "node:path";
import type { Subprocess } from "bun";
import { extractErrorMessage } from "@checkstack/common";
import { BACKEND_PORT, BASE_URL, REPO_ROOT } from "./config.ts";

/**
 * Boot the real Checkstack backend as its own process against the throwaway
 * seed database, serving the built SPA same-origin.
 *
 * The backend is a Bun default-export server (`export default { port, fetch }`),
 * which Bun only auto-starts when the module is the entrypoint - so we spawn it
 * rather than import it (importing would run init without opening the port).
 * It reads DATABASE_URL at import time and runs boot-time migrations, so the
 * caller must pass the connection string for an already-created database.
 */
export interface BackendHandle {
  readonly process: Subprocess;
  stop(): Promise<void>;
}

export async function bootBackend({
  databaseUrl,
}: {
  databaseUrl: string;
}): Promise<BackendHandle> {
  const proc = Bun.spawn({
    cmd: ["bun", path.join("core", "backend", "src", "index.ts")],
    cwd: REPO_ROOT,
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(BACKEND_PORT),
      BASE_URL,
      INTERNAL_URL: BASE_URL,
      CHECKSTACK_FRONTEND_DIST: path.join(REPO_ROOT, "core", "frontend", "dist"),
      // Namespace shared infra (redis/BullMQ keys) so this throwaway instance
      // never collides with a running dev instance on the same redis.
      CHECKSTACK_INSTANCE_NAMESPACE: "screenshots",
      // Real onboarding + session auth (NOT dev-auth): the seeded admin is a
      // real, nicely-named user so the navbar avatar and profile screens look
      // production-real. LOG_LEVEL is quieted to keep the boot log readable.
      LOG_LEVEL: process.env.SHOTS_LOG_LEVEL ?? "warn",
    },
  });

  await waitForReady();
  return {
    process: proc,
    async stop() {
      proc.kill();
      await proc.exited;
    },
  };
}

/** Poll `/.checkstack/ready` until the backend reports plugins initialized. */
async function waitForReady({
  timeoutMs = 180_000,
  intervalMs = 1000,
}: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `${BASE_URL}/.checkstack/ready`;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (error) {
      lastError = extractErrorMessage(error);
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(
    `Backend did not become ready at ${url} within ${timeoutMs}ms (last: ${lastError})`,
  );
}
