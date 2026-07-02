import net from "node:net";

/** Ask the OS for one free ephemeral port by binding to port 0 and releasing. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port =
        typeof address === "object" && address ? address.port : undefined;
      srv.close(() => {
        if (port === undefined) {
          reject(new Error("Failed to acquire a free port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

/**
 * Pick `count` DISTINCT free TCP ports, none of which are in `exclude`. The
 * PR-preview instance uses this so its backend + frontend never collide with the
 * primary dev instance's default ports (3000 / 5173) or with each other.
 *
 * There is an inherent race between releasing a probed port and the child
 * binding it; for a local, single-user dev tool this is acceptable and matches
 * how the wider ecosystem picks dev ports. `--strictPort` on the frontend makes
 * any residual collision fail loudly rather than silently drifting to +1.
 */
export async function pickFreePorts({
  count,
  exclude = [],
}: {
  count: number;
  exclude?: readonly number[];
}): Promise<number[]> {
  const taken = new Set<number>(exclude);
  const chosen: number[] = [];
  let attempts = 0;
  while (chosen.length < count) {
    if (attempts++ > count + 50) {
      throw new Error("Could not find enough free ports");
    }
    const port = await findFreePort();
    if (taken.has(port)) continue;
    taken.add(port);
    chosen.push(port);
  }
  return chosen;
}

/** The primary dev instance's default ports, excluded from preview selection. */
export const DEFAULT_DEV_PORTS = [3000, 5173] as const;
